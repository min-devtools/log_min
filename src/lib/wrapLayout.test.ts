import { describe, expect, it } from "vitest";
import { estimateLogRowHeight, type RowMetrics } from "./wrapLayout";

// what a 13px ui font actually renders: .log-line is 0.9231rem mono on the
// inherited 1.45 line box, with 4px padding top and bottom
const M: RowMetrics = { charW: 12 * 0.6, lineH: 12 * 1.45, padY: 8 };
const ONE_LINE = Math.round(M.lineH + M.padY);

describe("estimateLogRowHeight", () => {
  it("keeps short lines at one text line plus padding", () => {
    expect(estimateLogRowHeight("GET /health 200", 900, M)).toBe(ONE_LINE);
  });

  it("allocates multiple visual lines for long output", () => {
    const short = estimateLogRowHeight("short", 420, M);
    const long = estimateLogRowHeight("x".repeat(420), 420, M);
    expect(long).toBeGreaterThan(short * 5);
  });

  it("accounts for tabs without allowing a zero-width viewport", () => {
    expect(estimateLogRowHeight("\t\tTypeError: boom", 40, M)).toBeGreaterThanOrEqual(ONE_LINE);
  });

  it("matches the real wrapped row height for a known column count", () => {
    // usable = 796 - 76 padding = 720px → floor(720 / 7.2) = exactly 100 columns
    expect(estimateLogRowHeight("x".repeat(100), 796, M)).toBe(ONE_LINE);
    expect(estimateLogRowHeight("x".repeat(101), 796, M)).toBe(Math.round(2 * M.lineH + M.padY));
  });
});
