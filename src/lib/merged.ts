import { bufferFor } from "./ring";

/** one entry per parsed batch, in arrival order — the only cross-source ordering that exists */
interface LedgerEntry {
  sourceId: string;
  startSeq: number;
  endSeq: number;
}

/** ~20k batches ≈ several rings' worth of lines; entries are 3 numbers, so this is tiny */
const LEDGER_CAP = 20_000;
/** default row budget per combined view — same ceiling philosophy as RING_CAP */
const MERGED_CAP = 100_000;

const ledger: LedgerEntry[] = [];
/** entries dropped from the head so far — consumers hold ABSOLUTE positions */
let trimmed = 0;
/** bumped whenever the ledger is mutated mid-array (purgeSource) — live indexes
 *  self-reset on the next update() rather than trying to patch their positions */
let generation = 0;

export function recordBatch(sourceId: string, startSeq: number, endSeq: number): void {
  ledger.push({ sourceId, startSeq, endSeq });
  const over = ledger.length - LEDGER_CAP;
  if (over > 0) {
    ledger.splice(0, over);
    trimmed += over;
  }
}

/** a cleared ring restarts seqs at 0 — its old ledger entries would duplicate them */
export function purgeSource(sourceId: string): void {
  for (let i = ledger.length - 1; i >= 0; i--) if (ledger[i].sourceId === sourceId) ledger.splice(i, 1);
  generation++;
}

export function ledgerGeneration(): number {
  return generation;
}

export function _resetLedgerForTests(): void {
  ledger.length = 0;
  trimmed = 0;
}

export interface MergedRef {
  sourceId: string;
  seq: number;
}

/**
 * Per-view merged line index. Expands ledger entries for member sources into
 * per-line refs, incrementally per update; rows whose lines the ring evicted
 * are pruned. Lives OUTSIDE the store for the same reason Ring does.
 */
export class MergedIndex {
  private rows: MergedRef[] = [];
  /** absolute ledger position consumed so far */
  private pos = 0;
  /** last seen ring startSeq per member — change means eviction happened */
  private starts = new Map<string, number>();
  private readonly cap: number;
  /** ledger generation as of our last scan — a mismatch means purgeSource
   *  spliced the ledger out from under our absolute positions */
  private gen = generation;
  /** monotonic count of refs ever appended — feeds "N new lines" pills */
  totalAppended = 0;
  /** bumped whenever rows shrink or reset — incremental consumers holding
   *  positions into the rows array must re-anchor */
  rowsGeneration = 0;

  constructor(cap = MERGED_CAP) {
    this.cap = cap;
  }

  update(members: ReadonlySet<string>): readonly MergedRef[] {
    if (generation !== this.gen) {
      this.reset();
      this.gen = generation;
    }
    const end = trimmed + ledger.length;
    for (let i = Math.max(this.pos, trimmed); i < end; i++) {
      const e = ledger[i - trimmed];
      if (!members.has(e.sourceId)) continue;
      const ring = bufferFor(e.sourceId);
      if (e.endSeq < ring.startSeq && ring.length > 0) continue; // fully evicted — skip without expanding
      for (
        let seq = Math.max(e.startSeq, ring.length ? ring.startSeq : e.startSeq);
        seq <= e.endSeq;
        seq++
      ) {
        this.rows.push({ sourceId: e.sourceId, seq });
        this.totalAppended++;
      }
    }
    this.pos = end;

    let evicted = false;
    for (const id of members) {
      const start = bufferFor(id).startSeq;
      if (this.starts.get(id) !== start) {
        this.starts.set(id, start);
        evicted = true;
      }
    }
    if (evicted || this.rows.length > this.cap) {
      this.rows = this.rows.filter((r) => bufferFor(r.sourceId).indexOfSeq(r.seq) >= 0);
      const over = this.rows.length - this.cap;
      if (over > 0) this.rows.splice(0, over);
      this.rowsGeneration++;
    }
    return this.rows;
  }

  reset(): void {
    this.rows = [];
    this.pos = 0;
    this.starts.clear();
    this.rowsGeneration++;
  }
}
