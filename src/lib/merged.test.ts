import { beforeEach, describe, expect, test } from "vitest";
import { bufferFor, dropBuffer } from "./ring";
import { MergedIndex, purgeSource, recordBatch, _resetLedgerForTests } from "./merged";
import type { LogLine } from "./types";

let n = 0;
const uid = () => `m${n++}`;

const mk = (count: number, tag: string): LogLine[] =>
  Array.from({ length: count }, (_, i) => ({ seq: 0, raw: `${tag}${i}`, stream: "out" as const }));

/** mirrors ingestParsed: ring.push renumbers seqs, then the batch is recorded */
function push(id: string, count: number, tag = "x"): void {
  const ring = bufferFor(id);
  const lines = mk(count, tag);
  ring.push(lines);
  recordBatch(id, lines[0].seq, lines[lines.length - 1].seq);
}

beforeEach(() => _resetLedgerForTests());

describe("MergedIndex", () => {
  test("interleaves batches across sources in arrival order", () => {
    const a = uid(), b = uid();
    push(a, 2, "a"); // a0 a1
    push(b, 1, "b"); // b0
    push(a, 1, "a-late-");
    const idx = new MergedIndex();
    const rows = idx.update(new Set([a, b]));
    expect(rows.map((r) => r.sourceId)).toEqual([a, a, b, a]);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 0, 2]);
    dropBuffer(a); dropBuffer(b);
  });

  test("ignores non-member sources", () => {
    const a = uid(), other = uid();
    push(a, 1);
    push(other, 5);
    const rows = new MergedIndex().update(new Set([a]));
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe(a);
    dropBuffer(a); dropBuffer(other);
  });

  test("update is incremental — second call appends only new batches", () => {
    const a = uid();
    const idx = new MergedIndex();
    push(a, 2);
    expect(idx.update(new Set([a]))).toHaveLength(2);
    push(a, 3);
    expect(idx.update(new Set([a]))).toHaveLength(5);
    dropBuffer(a);
  });

  test("prunes rows whose lines were evicted from the ring", () => {
    const a = uid();
    bufferFor(a).setCap(100);
    const idx = new MergedIndex();
    push(a, 100);
    idx.update(new Set([a]));
    push(a, 100); // ring evicts in chunks; older seqs leave the ring
    const rows = idx.update(new Set([a]));
    const start = bufferFor(a).startSeq;
    expect(rows.every((r) => r.seq >= start)).toBe(true);
    expect(rows).toHaveLength(bufferFor(a).length);
    dropBuffer(a);
  });

  test("caps its own row count", () => {
    const a = uid();
    const idx = new MergedIndex(50);
    push(a, 200);
    const rows = idx.update(new Set([a]));
    expect(rows.length).toBeLessThanOrEqual(50);
    // the newest lines survive the trim
    expect(rows[rows.length - 1].seq).toBe(199);
    dropBuffer(a);
  });

  test("survives ledger trimming without re-adding or corrupting", () => {
    const a = uid();
    bufferFor(a).setCap(100);
    const idx = new MergedIndex();
    for (let i = 0; i < 25_000; i++) push(a, 1); // exceeds LEDGER_CAP, forces trim
    const rows = idx.update(new Set([a]));
    expect(rows).toHaveLength(bufferFor(a).length);
    expect(rows[rows.length - 1].seq).toBe(24_999);
    dropBuffer(a);
  });

  test("reset clears rows and re-reads the surviving ledger", () => {
    const a = uid();
    const idx = new MergedIndex();
    push(a, 3);
    idx.update(new Set([a]));
    idx.reset();
    expect(idx.update(new Set([a]))).toHaveLength(3);
    dropBuffer(a);
  });

  test("purgeSource removes a source's entries and live indexes rebuild cleanly", () => {
    const a = uid(), b = uid();
    push(a, 3, "a");
    push(b, 2, "b");
    const idx = new MergedIndex();
    expect(idx.update(new Set([a, b]))).toHaveLength(5);

    bufferFor(a).clear();
    purgeSource(a);
    push(a, 2, "a2"); // fresh ring — seqs restart at 0, 1

    const rows = idx.update(new Set([a, b]));
    expect(rows).toHaveLength(4); // b's 2 + a's 2 new — no stale a entries
    const seen = new Set(rows.map((r) => `${r.sourceId}:${r.seq}`));
    expect(seen.size).toBe(rows.length); // no duplicate (sourceId, seq) pairs
    dropBuffer(a); dropBuffer(b);
  });

  test("skips fully-evicted ledger entries without expanding them", () => {
    const a = uid();
    bufferFor(a).setCap(100);
    const idx = new MergedIndex();
    push(a, 100);
    push(a, 100);
    push(a, 100);
    const rows = idx.update(new Set([a]));
    expect(bufferFor(a).startSeq).toBeGreaterThan(0);
    expect(rows).toHaveLength(bufferFor(a).length);
    dropBuffer(a);
  });
});
