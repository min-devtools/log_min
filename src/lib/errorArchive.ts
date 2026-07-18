import type { LogLevel, LogLine, LogStream } from "./types";

export const CONTEXT_BEFORE = 10;
export const CONTEXT_AFTER = 10;
/** a new error ≤ this many lines after the previous one extends the same snippet */
export const MERGE_GAP = 20;
export const MAX_OCCURRENCES = 500;
export const MAX_LINES = 400;
/** tail must cover a backfill after a closed-but-mergeable occurrence */
const TAIL_SIZE = CONTEXT_BEFORE + MERGE_GAP;

export interface ArchivedLine {
  seq: number;
  raw: string;
  isError: boolean;
  stream: LogStream;
  level?: LogLevel;
  traceId?: number;
  /** terminal SGR spans — kept so snippets render with the same colors as the live view */
  ansi?: LogLine["ansi"];
}

export interface ErrorOccurrence {
  id: number;
  /** ErrorIndex fingerprints seen inside this snippet (adjacent errors may merge) */
  fingerprints: string[];
  firstErrSeq: number;
  lastErrSeq: number;
  /** wall-clock ms when the snippet opened */
  at: number;
  /** [firstErrSeq−10 … lastErrSeq+10], error/trace lines flagged */
  lines: ArchivedLine[];
  /** still waiting for the 10 lines after the last error */
  open: boolean;
  truncated: boolean;
}

/**
 * Per-source error snippets captured at ingest, independent of the ring:
 * they survive buffer clears, eviction, and source restarts (RAM only).
 * Lives OUTSIDE zustand like Ring/ErrorIndex/InsightIndex.
 */
export class ErrorArchive {
  private occurrences: ErrorOccurrence[] = [];
  private tail: ArchivedLine[] = [];
  private nextId = 1;

  feed(line: LogLine): void {
    const entry: ArchivedLine = {
      seq: line.seq,
      raw: line.raw,
      isError: line.traceId !== undefined || line.level === "err",
      stream: line.stream,
      level: line.level,
      traceId: line.traceId,
      ansi: line.ansi,
    };
    // seq went backwards → buffer was cleared / source restarted: old context is gone
    const prevTail = this.tail[this.tail.length - 1];
    if (prevTail && entry.seq <= prevTail.seq) {
      this.tail = [];
      const open = this.occurrences[this.occurrences.length - 1];
      if (open) open.open = false; // its "after" context can never arrive
    }

    const last = this.occurrences[this.occurrences.length - 1];
    if (entry.isError) {
      const mergeable =
        last && entry.seq > last.lastErrSeq && entry.seq - last.lastErrSeq <= MERGE_GAP;
      if (mergeable) {
        this.backfill(last, entry.seq);
        this.append(last, entry);
        last.lastErrSeq = entry.seq;
        last.open = true;
      } else {
        if (last) last.open = false; // a far error starts a new snippet; the old one is done
        this.occurrences.push({
          id: this.nextId++,
          fingerprints: [],
          firstErrSeq: entry.seq,
          lastErrSeq: entry.seq,
          at: Date.now(),
          lines: [...this.tail.filter((t) => t.seq >= entry.seq - CONTEXT_BEFORE), entry],
          open: true,
          truncated: false,
        });
        if (this.occurrences.length > MAX_OCCURRENCES) this.occurrences.shift();
      }
    } else if (last?.open && entry.seq > last.lastErrSeq) {
      this.append(last, entry);
      if (entry.seq - last.lastErrSeq >= CONTEXT_AFTER) last.open = false;
    }

    this.tail.push(entry);
    if (this.tail.length > TAIL_SIZE) this.tail.shift();
  }

  /** link an ErrorIndex occurrence (fingerprint + its last line seq) to its snippet */
  tagFingerprint(fingerprint: string, seq: number): void {
    for (let i = this.occurrences.length - 1; i >= 0; i--) {
      const occ = this.occurrences[i];
      if (seq >= occ.firstErrSeq && seq <= occ.lastErrSeq) {
        if (!occ.fingerprints.includes(fingerprint)) occ.fingerprints.push(fingerprint);
        return;
      }
      if (occ.lastErrSeq < seq - MERGE_GAP) return; // older snippets can't contain it
    }
  }

  /** snippets containing this fingerprint, newest first */
  forFingerprint(fingerprint: string): ErrorOccurrence[] {
    return this.occurrences.filter((o) => o.fingerprints.includes(fingerprint)).reverse();
  }

  /** every snippet, oldest first */
  all(): readonly ErrorOccurrence[] {
    return this.occurrences;
  }

  get size(): number {
    return this.occurrences.length;
  }

  /** drop every captured snippet (RAM cleanup); ingest continues normally */
  clear(): void {
    this.occurrences = [];
    this.tail = [];
  }

  /** re-archive lines missed while the last occurrence sat closed (merge over a gap) */
  private backfill(occ: ErrorOccurrence, uptoSeq: number): void {
    const lastArchived = occ.lines[occ.lines.length - 1];
    if (!lastArchived) return;
    for (const t of this.tail) {
      if (t.seq > lastArchived.seq && t.seq < uptoSeq) this.append(occ, t);
    }
  }

  private append(occ: ErrorOccurrence, entry: ArchivedLine): void {
    if (occ.lines.length >= MAX_LINES) {
      occ.truncated = true;
      return;
    }
    const last = occ.lines[occ.lines.length - 1];
    if (last && entry.seq <= last.seq) return; // dedup / ordering guard
    occ.lines.push(entry);
  }
}

const archives = new Map<string, ErrorArchive>();

export function archiveFor(sourceId: string): ErrorArchive {
  let a = archives.get(sourceId);
  if (!a) {
    a = new ErrorArchive();
    archives.set(sourceId, a);
  }
  return a;
}

export function dropArchive(sourceId: string): void {
  archives.delete(sourceId);
}
