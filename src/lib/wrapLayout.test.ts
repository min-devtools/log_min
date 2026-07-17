import { describe, expect, it } from "vitest";
import { estimateLogRowHeight } from "./wrapLayout";

describe("estimateLogRowHeight", () => {
  it("keeps short lines at the normal log row height", () => {
    expect(estimateLogRowHeight("GET /health 200", 900, 13)).toBe(Math.round(13 * 1.55));
  });

  it("allocates multiple visual lines for long output", () => {
    const short = estimateLogRowHeight("short", 420, 13);
    const long = estimateLogRowHeight("x".repeat(420), 420, 13);
    expect(long).toBeGreaterThan(short * 5);
  });

  it("accounts for tabs without allowing a zero-width viewport", () => {
    expect(estimateLogRowHeight("\t\tTypeError: boom", 40, 13)).toBeGreaterThanOrEqual(Math.round(13 * 1.55));
  });
});
