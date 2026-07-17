import type { LogLine } from "./types";

/** seconds of per-second history retained per source */
export const INSIGHT_WINDOW = 60;
/** rolling lines/sec is averaged over this many seconds */
const RATE_WINDOW = 5;

interface Bucket {
  sec: number;
  lines: number;
  errors: number;
  warns: number;
}

export interface InsightSnapshot {
  /** cumulative warnings since start/clear (errors live in SourceRuntime) */
  totalWarns: number;
  lines60: number;
  errors60: number;
  warns60: number;
  linesPerSec: number;
}

/**
 * Bounded per-source ingest stats. Lives OUTSIDE the zustand store like
 * Ring/ErrorIndex; the Overview tab reads snapshots imperatively. The clock is
 * always a parameter so tests never sleep.
 */
export class InsightIndex {
  private buckets: Bucket[] = [];
  private totalWarns = 0;

  feed(lines: LogLine[], atMs: number): void {
    const sec = Math.floor(atMs / 1000);
    let bucket = this.buckets[this.buckets.length - 1];
    if (!bucket || bucket.sec !== sec) {
      bucket = { sec, lines: 0, errors: 0, warns: 0 };
      this.buckets.push(bucket);
      // drop expired buckets — the array never exceeds the 60s window
      const min = sec - INSIGHT_WINDOW + 1;
      let cut = 0;
      while (cut < this.buckets.length && this.buckets[cut].sec < min) cut++;
      if (cut) this.buckets.splice(0, cut);
    }
    for (const l of lines) {
      bucket.lines++;
      if (l.level === "err") bucket.errors++;
      else if (l.level === "warn") {
        bucket.warns++;
        this.totalWarns++;
      }
    }
  }

  snapshot(atMs: number): InsightSnapshot {
    const sec = Math.floor(atMs / 1000);
    const min = sec - INSIGHT_WINDOW + 1;
    let lines60 = 0;
    let errors60 = 0;
    let warns60 = 0;
    let rateLines = 0;
    for (const b of this.buckets) {
      if (b.sec < min || b.sec > sec) continue;
      lines60 += b.lines;
      errors60 += b.errors;
      warns60 += b.warns;
      if (b.sec > sec - RATE_WINDOW) rateLines += b.lines;
    }
    return { totalWarns: this.totalWarns, lines60, errors60, warns60, linesPerSec: rateLines / RATE_WINDOW };
  }

  clear(): void {
    this.buckets = [];
    this.totalWarns = 0;
  }
}

const indexes = new Map<string, InsightIndex>();

export function insightIndexFor(sourceId: string): InsightIndex {
  let index = indexes.get(sourceId);
  if (!index) {
    index = new InsightIndex();
    indexes.set(sourceId, index);
  }
  return index;
}

export function dropInsightIndex(sourceId: string): void {
  indexes.delete(sourceId);
}
