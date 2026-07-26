import { beforeEach, describe, expect, test } from "vitest";
import { bufferFor, dropBuffer } from "./ring";
import { recordBatch, _resetLedgerForTests } from "./merged";
import { MergedModel, NO_LEVELS, RingModel, type LogFilterOpts } from "./logModel";
import type { LogLevel, LogLine } from "./types";

let n = 0;
const uid = () => `lm${n++}`;

const mk = (raws: string[]): LogLine[] =>
  raws.map((raw) => ({ seq: 0, raw, stream: "out" as const, level: detect(raw) }));

const detect = (raw: string): LogLevel | undefined =>
  raw.includes("ERROR") ? "err" : raw.includes("WARN") ? "warn" : undefined;

/** mirrors ingestParsed: ring.push renumbers seqs, then the batch is recorded */
function push(id: string, raws: string[]): void {
  const ring = bufferFor(id);
  const lines = mk(raws);
  ring.push(lines);
  recordBatch(id, lines[0].seq, lines[lines.length - 1].seq);
}

const opts = (over: Partial<LogFilterOpts> = {}): LogFilterOpts => ({
  query: "",
  caseSensitive: false,
  regex: false,
  levels: NO_LEVELS,
  ...over,
});

beforeEach(() => _resetLedgerForTests());

describe("RingModel", () => {
  test("unfiltered view mirrors the ring; addresses are seqs", () => {
    const a = uid();
    push(a, ["one", "two", "three"]);
    const m = new RingModel(a);
    m.sync(opts());
    expect(m.length).toBe(3);
    expect(m.at(1)?.raw).toBe("two");
    expect(m.addrAt(2)).toBe(2);
    expect(m.indexOf(0)).toBe(0);
    expect(m.key(7)).toBe("7");
    expect(m.totalAppended).toBe(3);
    dropBuffer(a);
  });

  test("query filter narrows the view; indexOf maps through it", () => {
    const a = uid();
    push(a, ["apple", "banana", "apple pie"]);
    const m = new RingModel(a);
    m.sync(opts({ query: "apple" }));
    expect(m.length).toBe(2);
    expect(m.at(1)?.raw).toBe("apple pie");
    expect(m.indexOf(2)).toBe(1);
    expect(m.indexOf(1)).toBe(-1); // filtered out
    expect(m.isAlive(1)).toBe(true); // …but still in the ring
    expect(m.lineOf(1)?.raw).toBe("banana");
    dropBuffer(a);
  });

  test("level filter", () => {
    const a = uid();
    push(a, ["ok", "ERROR boom", "WARN hmm"]);
    const m = new RingModel(a);
    m.sync(opts({ levels: new Set(["err"]) }));
    expect(m.length).toBe(1);
    expect(m.at(0)?.raw).toBe("ERROR boom");
    dropBuffer(a);
  });

  test("search returns seqs from the unfiltered buffer", () => {
    const a = uid();
    push(a, ["x1", "y", "x2"]);
    const m = new RingModel(a);
    m.sync(opts({ query: "y" })); // active filter must not affect search
    expect(m.search("x", { caseSensitive: false, regex: false })).toEqual([0, 2]);
    dropBuffer(a);
  });

  test("expandRange is a numeric seq range; sortAddrs numeric", () => {
    const m = new RingModel(uid());
    expect(m.expandRange(4, 2)).toEqual([2, 3, 4]);
    expect(m.sortAddrs([5, 1, 3])).toEqual([1, 3, 5]);
  });

  test("eviction: isAlive false, indexOf -1 for evicted seqs", () => {
    const a = uid();
    bufferFor(a).setCap(100);
    push(a, Array.from({ length: 100 }, (_, i) => `l${i}`));
    push(a, Array.from({ length: 100 }, (_, i) => `m${i}`));
    const m = new RingModel(a);
    m.sync(opts());
    expect(m.isAlive(0)).toBe(false);
    expect(m.indexOf(0)).toBe(-1);
    const start = bufferFor(a).startSeq;
    expect(m.isAlive(start)).toBe(true);
    dropBuffer(a);
  });
});

describe("MergedModel", () => {
  test("interleaves in arrival order; addresses are (sourceId, seq)", () => {
    const a = uid(), b = uid();
    push(a, ["a0", "a1"]);
    push(b, ["b0"]);
    push(a, ["a2"]);
    const m = new MergedModel();
    m.sync([a, b], new Set(), opts());
    expect(m.length).toBe(4);
    expect(m.at(2)?.raw).toBe("b0");
    expect(m.addrAt(2)).toEqual({ sourceId: b, seq: 0 });
    expect(m.indexOf({ sourceId: a, seq: 2 })).toBe(3);
    expect(m.key({ sourceId: a, seq: 2 })).toBe(`${a}:2`);
    expect(m.totalAppended).toBe(4);
    dropBuffer(a); dropBuffer(b);
  });

  test("mute hides a source; unmute restores it", () => {
    const a = uid(), b = uid();
    push(a, ["a0"]);
    push(b, ["b0", "b1"]);
    const m = new MergedModel();
    m.sync([a, b], new Set([a]), opts());
    expect(m.length).toBe(2);
    expect(m.at(0)?.raw).toBe("b0");
    expect(m.indexOf({ sourceId: a, seq: 0 })).toBe(-1);
    expect(m.isAlive({ sourceId: a, seq: 0 })).toBe(true);
    m.sync([a, b], new Set(), opts());
    expect(m.length).toBe(3);
    dropBuffer(a); dropBuffer(b);
  });

  test("query + level filter over the merged stream", () => {
    const a = uid(), b = uid();
    push(a, ["ok", "ERROR a-boom"]);
    push(b, ["ERROR b-boom", "fine"]);
    const m = new MergedModel();
    m.sync([a, b], new Set(), opts({ levels: new Set(["err"]) }));
    expect(m.length).toBe(2);
    m.sync([a, b], new Set(), opts({ levels: new Set(["err"]), query: "b-boom" }));
    expect(m.length).toBe(1);
    expect(m.at(0)?.raw).toBe("ERROR b-boom");
    dropBuffer(a); dropBuffer(b);
  });

  test("incremental: filter picks up newly pushed batches without option change", () => {
    const a = uid();
    push(a, ["match 1", "skip"]);
    const m = new MergedModel();
    m.sync([a], new Set(), opts({ query: "match" }));
    expect(m.length).toBe(1);
    push(a, ["match 2"]);
    m.sync([a], new Set(), opts({ query: "match" }));
    expect(m.length).toBe(2);
    expect(m.at(1)?.raw).toBe("match 2");
    dropBuffer(a);
  });

  test("filter view survives eviction pruning without duplicates", () => {
    const a = uid();
    bufferFor(a).setCap(100);
    const m = new MergedModel();
    push(a, Array.from({ length: 100 }, (_, i) => `even-odd ${i}`));
    m.sync([a], new Set(), opts({ query: "even-odd" }));
    push(a, Array.from({ length: 100 }, (_, i) => `even-odd ${100 + i}`));
    m.sync([a], new Set(), opts({ query: "even-odd" }));
    // every view entry maps to a live, unique line
    const keys = new Set<string>();
    for (let i = 0; i < m.length; i++) {
      const addr = m.addrAt(i)!;
      expect(m.isAlive(addr)).toBe(true);
      keys.add(m.key(addr));
    }
    expect(keys.size).toBe(m.length);
    dropBuffer(a);
  });

  test("invalid regex matches nothing (filter and search)", () => {
    const a = uid();
    push(a, ["anything"]);
    const m = new MergedModel();
    m.sync([a], new Set(), opts({ query: "[", regex: true }));
    expect(m.length).toBe(0);
    expect(m.search("[", { caseSensitive: false, regex: true })).toEqual([]);
    dropBuffer(a);
  });

  test("search respects mute but ignores the active level filter", () => {
    const a = uid(), b = uid();
    push(a, ["needle a"]);
    push(b, ["needle b"]);
    const m = new MergedModel();
    m.sync([a, b], new Set([b]), opts({ levels: new Set(["err"]) }));
    const hits = m.search("needle", { caseSensitive: false, regex: false });
    expect(hits).toEqual([{ sourceId: a, seq: 0 }]);
    dropBuffer(a); dropBuffer(b);
  });

  test("expandRange spans sources in view order; sortAddrs restores stream order", () => {
    const a = uid(), b = uid();
    push(a, ["a0"]);
    push(b, ["b0"]);
    push(a, ["a1"]);
    const m = new MergedModel();
    m.sync([a, b], new Set(), opts());
    const range = m.expandRange({ sourceId: a, seq: 0 }, { sourceId: a, seq: 1 });
    expect(range).toEqual([
      { sourceId: a, seq: 0 },
      { sourceId: b, seq: 0 },
      { sourceId: a, seq: 1 },
    ]);
    const sorted = m.sortAddrs([{ sourceId: a, seq: 1 }, { sourceId: b, seq: 0 }]);
    expect(sorted.map((r) => r.sourceId)).toEqual([b, a]);
    dropBuffer(a); dropBuffer(b);
  });

  test("membership change resets and rebuilds", () => {
    const a = uid(), b = uid();
    push(a, ["a0"]);
    push(b, ["b0"]);
    const m = new MergedModel();
    m.sync([a], new Set(), opts());
    expect(m.length).toBe(1);
    m.sync([a, b], new Set(), opts());
    expect(m.length).toBe(2);
    dropBuffer(a); dropBuffer(b);
  });
});
