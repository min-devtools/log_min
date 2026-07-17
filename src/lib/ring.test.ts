import { describe, expect, it } from "vitest";
import { Ring } from "./ring";
import type { LogLine } from "./types";

const line = (raw: string): LogLine => ({ seq: 0, raw, stream: "out" });

const make = (...raws: string[]) => {
  const ring = new Ring();
  ring.push(raws.map(line));
  return ring;
};

describe("Ring.setCap", () => {
  const lines = (n: number, from = 0) => Array.from({ length: n }, (_, i) => line(`l${from + i}`));

  it("evicts down to the new cap immediately and keeps evicting on push", () => {
    const ring = new Ring();
    ring.push(lines(5000));
    ring.setCap(1000);
    expect(ring.capacity).toBe(1000);
    expect(ring.length).toBe(1000);
    expect(ring.startSeq).toBe(4000);
    // subsequent pushes respect the small cap without wiping the buffer
    ring.push(lines(500));
    expect(ring.length).toBeGreaterThanOrEqual(500);
    expect(ring.length).toBeLessThanOrEqual(1000);
    expect(ring.totalSeen).toBe(5500);
  });

  it("clamps to sane bounds", () => {
    const ring = new Ring();
    ring.setCap(1);
    expect(ring.capacity).toBe(100);
    ring.setCap(9_999_999);
    expect(ring.capacity).toBe(200_000);
    ring.setCap(0); // falsy → default
    expect(ring.capacity).toBe(200_000);
  });
});

describe("Ring.search", () => {
  const ring = make("GET /api 200", "get /health 200", "POST /api 500");

  it("substring is case-insensitive by default", () => {
    expect(ring.search("get")).toEqual([0, 1]);
  });

  it("substring honors caseSensitive", () => {
    expect(ring.search("GET", { caseSensitive: true })).toEqual([0]);
  });

  it("regex matches and honors caseSensitive", () => {
    expect(ring.search("^(GET|POST)\\b.*\\d{3}$", { regex: true })).toEqual([0, 1, 2]);
    expect(ring.search("^get", { regex: true, caseSensitive: true })).toEqual([1]);
  });

  it("invalid regex returns no matches instead of throwing", () => {
    expect(ring.search("([", { regex: true })).toEqual([]);
  });
});
