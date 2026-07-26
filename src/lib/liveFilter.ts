import type { LogLevel, LogLine } from "./types";

export interface LiveFilterOpts {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  /** empty set = all levels */
  levels: ReadonlySet<LogLevel>;
}

interface RingLike {
  length: number;
  startSeq: number;
  at(i: number): LogLine | undefined;
}

/**
 * Incremental live filter: keeps matching seqs across batches so each batch
 * scans only the NEW lines instead of rescanning the whole 200k ring.
 * Option changes or a cleared buffer trigger one full rescan.
 */
export class LiveFilter {
  private key = "";
  private seqs: number[] = [];
  private nextSeq = 0;

  /** must be called when the ring is cleared — seqs restart at 0, which a
   * same-size refill would otherwise make indistinguishable from no change */
  reset(): void {
    this.key = "";
  }

  /** matching ring indexes for the ring's current contents */
  update(ring: RingLike, opts: LiveFilterOpts): number[] {
    const key = `${opts.caseSensitive}:${opts.regex}:${[...opts.levels].sort().join()}:${opts.query}`;
    const start = ring.startSeq;
    const end = start + ring.length;
    if (key !== this.key || this.nextSeq > end) {
      // options changed, or seqs restarted (buffer cleared) — full rescan
      this.key = key;
      this.seqs = [];
      this.nextSeq = start;
    }
    if (this.seqs.length && this.seqs[0] < start) {
      let cut = 0;
      while (cut < this.seqs.length && this.seqs[cut] < start) cut++;
      this.seqs.splice(0, cut);
    }
    if (this.nextSeq < start) this.nextSeq = start;
    const test = buildMatcher(opts);
    if (test) {
      for (let seq = this.nextSeq; seq < end; seq++) {
        const line = ring.at(seq - start);
        if (line && test(line)) this.seqs.push(seq);
      }
    }
    this.nextSeq = end;
    return this.seqs.map((s) => s - start);
  }
}

/** line predicate for the options; null = invalid regex (matches nothing) */
export function buildLineMatcher(opts: LiveFilterOpts): ((line: LogLine) => boolean) | null {
  return buildMatcher(opts);
}

function buildMatcher(opts: LiveFilterOpts): ((line: LogLine) => boolean) | null {
  const { query, levels } = opts;
  let textTest: ((raw: string) => boolean) | null = null;
  if (query) {
    if (opts.regex) {
      let re: RegExp;
      try {
        re = new RegExp(query, opts.caseSensitive ? "" : "i");
      } catch {
        return null;
      }
      textTest = (raw) => re.test(raw);
    } else if (opts.caseSensitive) {
      textTest = (raw) => raw.includes(query);
    } else {
      const q = query.toLowerCase();
      textTest = (raw) => raw.toLowerCase().includes(q);
    }
  }
  return (line) =>
    (!levels.size || (line.level !== undefined && levels.has(line.level))) &&
    (!textTest || textTest(line.raw));
}
