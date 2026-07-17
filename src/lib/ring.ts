import type { LogLine } from "./types";

export const RING_CAP = 200_000;
/** raw-text budget per source — 200k tiny objects can outweigh the log itself */
export const RING_BYTE_CAP = 64 * 1024 * 1024;
/** evict in chunks so we don't shift the array on every batch once full */
const EVICT_CHUNK = 4_096;

/**
 * Fixed-capacity line buffer per source. Lives OUTSIDE the zustand store —
 * 200k-element arrays must never be diffed by React. Views subscribe to the
 * store's per-source version counter and read from here imperatively.
 */
export class Ring {
  private buf: LogLine[] = [];
  /** total lines ever pushed (drives "142 380 lines" + eviction math) */
  totalSeen = 0;
  /** approx bytes of retained raw text (2 bytes/char is close enough) */
  private bytes = 0;

  get length(): number {
    return this.buf.length;
  }

  /** seq of the oldest retained line (0 when empty) */
  get startSeq(): number {
    return this.buf.length ? this.buf[0].seq : 0;
  }

  push(lines: LogLine[]): void {
    // renumber client-side: Rust seq restarts at 0 when a source restarts,
    // ring seq must stay contiguous across runs for O(1) index lookup
    for (const l of lines) {
      l.seq = this.totalSeen++;
      this.bytes += l.raw.length * 2;
    }
    // batches are ≤500 lines — spread is safe
    this.buf.push(...lines);
    // evict oldest: whichever cap (lines or bytes) is exceeded first
    let cut = this.buf.length > RING_CAP ? this.buf.length - RING_CAP + EVICT_CHUNK : 0;
    let freed = 0;
    for (let i = 0; i < cut; i++) freed += this.buf[i].raw.length * 2;
    while (this.bytes - freed > RING_BYTE_CAP && cut < this.buf.length) {
      freed += this.buf[cut].raw.length * 2;
      cut++;
    }
    if (cut > 0) {
      this.bytes -= freed;
      this.buf.splice(0, cut);
    }
  }

  at(i: number): LogLine | undefined {
    return this.buf[i];
  }

  slice(start: number, end: number): LogLine[] {
    return this.buf.slice(Math.max(0, start), end);
  }

  /** seqs are contiguous per source, so index lookup is O(1) */
  indexOfSeq(seq: number): number {
    if (!this.buf.length) return -1;
    const i = seq - this.buf[0].seq;
    return i >= 0 && i < this.buf.length ? i : -1;
  }

  /** substring or regex scan (case-insensitive by default); returns matching indexes (capped) */
  search(query: string, opts: { caseSensitive?: boolean; regex?: boolean } = {}, cap = 5_000): number[] {
    if (!query) return [];
    const out: number[] = [];
    if (opts.regex) {
      let re: RegExp;
      try {
        re = new RegExp(query, opts.caseSensitive ? "" : "i");
      } catch {
        return [];
      }
      for (let i = 0; i < this.buf.length && out.length < cap; i++) {
        if (re.test(this.buf[i].raw)) out.push(i);
      }
      return out;
    }
    const q = opts.caseSensitive ? query : query.toLowerCase();
    for (let i = 0; i < this.buf.length && out.length < cap; i++) {
      const raw = opts.caseSensitive ? this.buf[i].raw : this.buf[i].raw.toLowerCase();
      if (raw.includes(q)) out.push(i);
    }
    return out;
  }

  clear(): void {
    this.buf = [];
    this.totalSeen = 0;
    this.bytes = 0;
  }
}

const buffers = new Map<string, Ring>();

export function bufferFor(sourceId: string): Ring {
  let r = buffers.get(sourceId);
  if (!r) {
    r = new Ring();
    buffers.set(sourceId, r);
  }
  return r;
}

export function dropBuffer(sourceId: string): void {
  buffers.delete(sourceId);
}
