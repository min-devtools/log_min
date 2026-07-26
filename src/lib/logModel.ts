import { buildLineMatcher, LiveFilter } from "./liveFilter";
import { bufferFor } from "./ring";
import { MergedIndex, type MergedRef } from "./merged";
import type { LogLevel, LogLine } from "./types";

export interface LogFilterOpts {
  /** filter query; "" = no text filter */
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  /** empty set = all levels */
  levels: ReadonlySet<LogLevel>;
}

export const NO_LEVELS: ReadonlySet<LogLevel> = new Set();

/**
 * The view-model contract the shared log engine (viewport/search/selection
 * hooks) is generic over. LogView addresses lines by seq within one ring;
 * CombinedView by (sourceId, seq) — `A` abstracts the difference.
 *
 * Models live in refs OUTSIDE React state (like Ring) and are re-synced once
 * per render pass; views re-render off the store's version counters.
 */
export interface LogModel<A> {
  /** lines in the current (possibly filtered) view */
  readonly length: number;
  /** line at view index i */
  at(i: number): LogLine | undefined;
  addrAt(i: number): A | undefined;
  /** view index of addr; -1 = evicted OR filtered out */
  indexOf(addr: A): number;
  /** line for addr ignoring the filter — copy and prune paths need it */
  lineOf(addr: A): LogLine | undefined;
  /** false only when the line left its ring (filter-independent) */
  isAlive(addr: A): boolean;
  /** stable row key */
  key(addr: A): string;
  /** monotonic count of lines ever appended — feeds the "N new lines" pill */
  readonly totalAppended: number;
  /** scan the UNFILTERED buffer (mute still applies for merged), capped */
  search(query: string, opts: { caseSensitive: boolean; regex: boolean }, cap?: number): A[];
  /** shift-select policy between two addresses (model-specific ordering) */
  expandRange(a: A, b: A): A[];
  /** buffer order for copying a pick set */
  sortAddrs(addrs: A[]): A[];
}

/** single-source model: seq addressing over one Ring + incremental LiveFilter */
export class RingModel implements LogModel<number> {
  private readonly ring;
  private readonly filter = new LiveFilter();
  private viewIdx: number[] | null = null;

  constructor(readonly sourceId: string) {
    this.ring = bufferFor(sourceId);
  }

  /** recompute the filtered view — call once per render pass before reads */
  sync(opts: LogFilterOpts): void {
    const active = !!opts.query || opts.levels.size > 0;
    this.viewIdx = active ? this.filter.update(this.ring, opts) : null;
  }

  /** the ring was cleared — seqs restart at 0 */
  resetFilter(): void {
    this.filter.reset();
  }

  get filtered(): boolean {
    return this.viewIdx !== null;
  }

  get length(): number {
    return this.viewIdx ? this.viewIdx.length : this.ring.length;
  }

  at(i: number): LogLine | undefined {
    return this.ring.at(this.viewIdx ? this.viewIdx[i] : i);
  }

  addrAt(i: number): number | undefined {
    return this.at(i)?.seq;
  }

  indexOf(seq: number): number {
    const ringIdx = this.ring.indexOfSeq(seq);
    if (ringIdx < 0) return -1;
    return this.viewIdx ? this.viewIdx.indexOf(ringIdx) : ringIdx;
  }

  lineOf(seq: number): LogLine | undefined {
    const i = this.ring.indexOfSeq(seq);
    return i < 0 ? undefined : this.ring.at(i);
  }

  isAlive(seq: number): boolean {
    return this.ring.indexOfSeq(seq) >= 0;
  }

  key(seq: number): string {
    return String(seq);
  }

  get totalAppended(): number {
    return this.ring.totalSeen;
  }

  search(query: string, opts: { caseSensitive: boolean; regex: boolean }, cap = 5_000): number[] {
    const out: number[] = [];
    for (const i of this.ring.search(query, opts, cap)) {
      const line = this.ring.at(i);
      if (line) out.push(line.seq);
    }
    return out;
  }

  /** numeric seq range — includes filtered-out lines, like LogView always did */
  expandRange(a: number, b: number): number[] {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const out: number[] = [];
    for (let s = lo; s <= hi; s++) out.push(s);
    return out;
  }

  sortAddrs(addrs: number[]): number[] {
    return [...addrs].sort((x, y) => x - y);
  }
}

/** MERGED_CAP mirror — MergedIndex owns the real cap; the filtered view is
 *  bounded separately because capped-out-of-rows refs may still be alive */
const VIEW_CAP = 100_000;

/**
 * Multi-source model: (sourceId, seq) addressing over a MergedIndex.
 * Filtering (mute + level + query) is incremental: each batch scans only the
 * newly appended refs; a rowsGeneration bump (eviction prune / reset) prunes
 * the view by line-existence and the WeakSet of seen refs prevents re-testing
 * old rows with the (potentially expensive) text matcher.
 */
export class MergedModel implements LogModel<MergedRef> {
  private readonly idx = new MergedIndex();
  private rows: readonly MergedRef[] = [];
  /** matching refs in rows order; null = no filter active */
  private view: MergedRef[] | null = null;
  private seen = new WeakSet<MergedRef>();
  private consumed = 0;
  private cfgKey = "";
  private gen = -1;
  private membersKey = "";
  private muted: ReadonlySet<string> = new Set();

  /** recompute rows + filtered view — call once per render pass before reads */
  sync(members: readonly string[], muted: ReadonlySet<string>, opts: LogFilterOpts): void {
    const mk = members.join("\n");
    if (mk !== this.membersKey) {
      // membership change invalidates every row ref — start over
      this.membersKey = mk;
      this.idx.reset();
    }
    this.rows = this.idx.update(new Set(members));
    this.muted = muted;

    const filterActive = muted.size > 0 || !!opts.query || opts.levels.size > 0;
    if (!filterActive) {
      this.view = null;
      this.cfgKey = "";
      this.consumed = this.rows.length;
      this.gen = this.idx.rowsGeneration;
      return;
    }
    const key = `${[...muted].sort().join()}|${opts.caseSensitive}|${opts.regex}|${[...opts.levels].sort().join()}|${opts.query}`;
    if (key !== this.cfgKey || this.view === null) {
      // option change: full rescan with the new predicate
      this.cfgKey = key;
      this.view = [];
      this.seen = new WeakSet();
      this.consumed = 0;
      this.gen = this.idx.rowsGeneration;
    } else if (this.gen !== this.idx.rowsGeneration) {
      // rows shrank under us — drop dead refs from the view, then walk the
      // whole array once; `seen` keeps that walk to cheap WeakSet hits
      this.gen = this.idx.rowsGeneration;
      this.view = this.view.filter((r) => this.lineOf(r) !== undefined);
      this.consumed = 0;
    }
    const test = buildLineMatcher(opts);
    for (let i = this.consumed; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (this.seen.has(r)) continue;
      this.seen.add(r);
      if (muted.has(r.sourceId)) continue;
      const line = this.lineOf(r);
      // test === null means invalid regex — matches nothing, like Ring.search
      if (line && test && test(line)) this.view.push(r);
    }
    this.consumed = this.rows.length;
    const over = this.view.length - VIEW_CAP;
    if (over > 0) this.view.splice(0, over);
  }

  get filtered(): boolean {
    return this.view !== null;
  }

  get length(): number {
    return this.view ? this.view.length : this.rows.length;
  }

  at(i: number): LogLine | undefined {
    const r = this.addrAt(i);
    return r ? this.lineOf(r) : undefined;
  }

  addrAt(i: number): MergedRef | undefined {
    return this.view ? this.view[i] : this.rows[i];
  }

  /** linear — runs only on user gestures (jump, selection), not per batch */
  indexOf(addr: MergedRef): number {
    const list = this.view ?? this.rows;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.sourceId === addr.sourceId && r.seq === addr.seq) return i;
    }
    return -1;
  }

  lineOf(addr: MergedRef): LogLine | undefined {
    const ring = bufferFor(addr.sourceId);
    const i = ring.indexOfSeq(addr.seq);
    return i < 0 ? undefined : ring.at(i);
  }

  isAlive(addr: MergedRef): boolean {
    return this.lineOf(addr) !== undefined;
  }

  key(addr: MergedRef): string {
    return `${addr.sourceId}:${addr.seq}`;
  }

  get totalAppended(): number {
    return this.idx.totalAppended;
  }

  search(query: string, opts: { caseSensitive: boolean; regex: boolean }, cap = 5_000): MergedRef[] {
    if (!query) return [];
    const test = buildLineMatcher({ query, caseSensitive: opts.caseSensitive, regex: opts.regex, levels: NO_LEVELS });
    if (!test) return [];
    const out: MergedRef[] = [];
    for (let i = 0; i < this.rows.length && out.length < cap; i++) {
      const r = this.rows[i];
      if (this.muted.has(r.sourceId)) continue;
      const line = this.lineOf(r);
      if (line && test(line)) out.push(r);
    }
    return out;
  }

  /** view-order range — seqs aren't comparable across sources */
  expandRange(a: MergedRef, b: MergedRef): MergedRef[] {
    let ia = this.indexOf(a);
    let ib = this.indexOf(b);
    if (ia < 0 || ib < 0) return [b];
    if (ia > ib) [ia, ib] = [ib, ia];
    const out: MergedRef[] = [];
    for (let i = ia; i <= ib; i++) {
      const r = this.addrAt(i);
      if (r) out.push(r);
    }
    return out;
  }

  /** one pass over the current view/rows keeps this O(n), not O(n·picks) */
  sortAddrs(addrs: MergedRef[]): MergedRef[] {
    const want = new Map(addrs.map((a) => [this.key(a), a] as const));
    const out: MergedRef[] = [];
    const list = this.view ?? this.rows;
    for (const r of list) {
      const hit = want.get(this.key(r));
      if (hit) {
        out.push(hit);
        want.delete(this.key(r));
      }
    }
    // picks that fell out of the window keep arbitrary (input) order at the end
    for (const a of want.values()) out.push(a);
    return out;
  }
}
