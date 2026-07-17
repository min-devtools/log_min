import { describe, expect, it } from "vitest";
import { CONTEXT_AFTER, ErrorArchive, MAX_LINES, MAX_OCCURRENCES } from "./errorArchive";
import type { LogLine } from "./types";

const plain = (seq: number): LogLine => ({ seq, raw: `line ${seq}`, stream: "out" });
const err = (seq: number): LogLine => ({ seq, raw: `boom ${seq}`, stream: "err", level: "err" });
const traced = (seq: number, traceId: number): LogLine => ({ seq, raw: `at fn (${seq})`, stream: "out", traceId });

function feedRange(a: ErrorArchive, from: number, to: number): void {
  for (let s = from; s <= to; s++) a.feed(plain(s));
}

describe("ErrorArchive", () => {
  it("captures ±10 lines around a lone error", () => {
    const a = new ErrorArchive();
    feedRange(a, 0, 29);
    a.feed(err(30));
    feedRange(a, 31, 60);
    expect(a.size).toBe(1);
    const occ = a.all()[0];
    expect(occ.lines[0].seq).toBe(20);
    expect(occ.lines[occ.lines.length - 1].seq).toBe(30 + CONTEXT_AFTER);
    expect(occ.lines.find((l) => l.seq === 30)?.isError).toBe(true);
    expect(occ.open).toBe(false);
  });

  it("merges errors whose windows overlap into one outermost range", () => {
    const a = new ErrorArchive();
    feedRange(a, 0, 29);
    a.feed(err(30));
    feedRange(a, 31, 44);
    a.feed(err(45)); // 15 lines after → merge (≤20)
    feedRange(a, 46, 80);
    expect(a.size).toBe(1);
    const occ = a.all()[0];
    expect(occ.firstErrSeq).toBe(30);
    expect(occ.lastErrSeq).toBe(45);
    expect(occ.lines[0].seq).toBe(20);
    expect(occ.lines[occ.lines.length - 1].seq).toBe(55);
    // merged snippet is contiguous — no gaps, no duplicates
    for (let i = 1; i < occ.lines.length; i++) expect(occ.lines[i].seq).toBe(occ.lines[i - 1].seq + 1);
  });

  it("keeps far-apart errors as separate snippets", () => {
    const a = new ErrorArchive();
    feedRange(a, 0, 29);
    a.feed(err(30));
    feedRange(a, 31, 55);
    a.feed(err(56)); // 26 lines after → separate
    feedRange(a, 57, 80);
    expect(a.size).toBe(2);
  });

  it("captures a whole trace as one snippet", () => {
    const a = new ErrorArchive();
    feedRange(a, 0, 9);
    for (let s = 10; s <= 25; s++) a.feed(traced(s, 7));
    feedRange(a, 26, 50);
    expect(a.size).toBe(1);
    expect(a.all()[0].firstErrSeq).toBe(10);
    expect(a.all()[0].lastErrSeq).toBe(25);
  });

  it("never merges across a seq reset (buffer clear / restart)", () => {
    const a = new ErrorArchive();
    feedRange(a, 0, 99);
    a.feed(err(100));
    // clear: seqs restart
    a.feed(plain(0));
    a.feed(err(1));
    feedRange(a, 2, 20);
    expect(a.size).toBe(2);
    // second snippet must not contain stale high-seq tail lines
    expect(a.all()[1].lines.every((l) => l.seq <= 11)).toBe(true);
  });

  it("tags fingerprints onto the snippet containing the occurrence", () => {
    const a = new ErrorArchive();
    feedRange(a, 0, 9);
    a.feed(err(10));
    a.feed(err(11)); // adjacent, different error → same snippet
    feedRange(a, 12, 30);
    a.tagFingerprint("fpA", 10);
    a.tagFingerprint("fpB", 11);
    a.tagFingerprint("fpA", 10); // dedup
    expect(a.forFingerprint("fpA")).toHaveLength(1);
    expect(a.forFingerprint("fpB")).toHaveLength(1);
    expect(a.forFingerprint("fpA")[0].fingerprints).toEqual(["fpA", "fpB"]);
    expect(a.forFingerprint("missing")).toHaveLength(0);
  });

  it("bounds occurrences and snippet length", () => {
    const a = new ErrorArchive();
    let seq = 0;
    for (let i = 0; i < MAX_OCCURRENCES + 20; i++) {
      a.feed(err(seq));
      seq += 100; // far apart → separate snippets
    }
    expect(a.size).toBe(MAX_OCCURRENCES);

    const b = new ErrorArchive();
    for (let s = 0; s < MAX_LINES + 50; s++) b.feed({ seq: s, raw: "x", stream: "out", traceId: 1 });
    expect(b.all()[0].lines.length).toBe(MAX_LINES);
    expect(b.all()[0].truncated).toBe(true);
  });

  it("clear drops all snippets and keeps capturing afterwards", () => {
    const a = new ErrorArchive();
    a.feed(err(10));
    expect(a.size).toBe(1);
    a.clear();
    expect(a.size).toBe(0);
    a.feed(err(50));
    expect(a.size).toBe(1);
    expect(a.all()[0].firstErrSeq).toBe(50);
  });
});
