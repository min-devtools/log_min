import { describe, expect, it } from "vitest";
import { InsightIndex } from "./insight";
import type { LogLine } from "./types";

const line = (level?: LogLine["level"]): LogLine => ({ seq: 0, raw: "x", stream: "out", level });

describe("InsightIndex", () => {
  it("counts lines, errors, and warnings into the current window", () => {
    const ix = new InsightIndex();
    ix.feed([line(), line("err"), line("warn"), line("warn")], 10_000);
    const s = ix.snapshot(10_500);
    expect(s.lines60).toBe(4);
    expect(s.errors60).toBe(1);
    expect(s.warns60).toBe(2);
    expect(s.totalWarns).toBe(2);
  });

  it("keeps cumulative warns but expires windowed counts after 60s", () => {
    const ix = new InsightIndex();
    ix.feed([line("warn"), line("err")], 10_000);
    const s = ix.snapshot(10_000 + 61_000);
    expect(s.lines60).toBe(0);
    expect(s.errors60).toBe(0);
    expect(s.warns60).toBe(0);
    expect(s.totalWarns).toBe(1);
  });

  it("computes a rolling lines-per-second rate over the last 5 seconds", () => {
    const ix = new InsightIndex();
    // 10 lines/s for 5 consecutive seconds
    for (let t = 0; t < 5; t++) {
      ix.feed(Array.from({ length: 10 }, () => line()), 20_000 + t * 1000);
    }
    expect(ix.snapshot(24_500).linesPerSec).toBeCloseTo(10, 5);
    // 6s later the rate window is empty but the 60s window still counts them
    const later = ix.snapshot(24_500 + 6_000);
    expect(later.linesPerSec).toBe(0);
    expect(later.lines60).toBe(50);
  });

  it("drops buckets older than the window so memory stays bounded", () => {
    const ix = new InsightIndex();
    for (let t = 0; t < 200; t++) ix.feed([line()], t * 1000);
    // internal bucket array is private — bound is observable via snapshot correctness
    expect(ix.snapshot(199_500).lines60).toBe(60);
  });

  it("clear() resets everything", () => {
    const ix = new InsightIndex();
    ix.feed([line("warn")], 10_000);
    ix.clear();
    const s = ix.snapshot(10_000);
    expect(s.totalWarns).toBe(0);
    expect(s.lines60).toBe(0);
  });
});
