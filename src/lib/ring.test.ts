import { describe, expect, it } from "vitest";
import { Ring } from "./ring";
import type { LogLine } from "./types";

const line = (raw: string): LogLine => ({ seq: 0, raw, stream: "out" });

const make = (...raws: string[]) => {
  const ring = new Ring();
  ring.push(raws.map(line));
  return ring;
};

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
