import { describe, expect, it } from "vitest";
import { extractJson, shouldAutoRouteJson } from "./json";

describe("extractJson", () => {
  it("parses a whole-line json object", () => {
    expect(extractJson('{"level":30,"msg":"ok"}')?.value).toEqual({ level: 30, msg: "ok" });
  });

  it("finds json embedded after a plain-text prefix", () => {
    const hit = extractJson('2026-07-17 INFO payload {"a":[1,2],"b":"x}y"} tail');
    expect(hit?.value).toEqual({ a: [1, 2], b: "x}y" });
  });

  it("skips a truncated leading fragment and parses the next balanced block", () => {
    // wire logs cut mid-object: first "{" never closes cleanly as valid JSON
    const hit = extractJson('<< "r","cat":"w"},{"key":"k1","doc_count":2}');
    expect(hit?.value).toEqual({ key: "k1", doc_count: 2 });
  });

  it("returns null for prose and never-closed brackets", () => {
    expect(extractJson("server started {unclosed")).toBeNull();
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("shouldAutoRouteJson", () => {
  it("routes whole-line and prefixed objects to JSON", () => {
    expect(shouldAutoRouteJson('{"level":30,"msg":"ok"}')).toBe(true);
    expect(shouldAutoRouteJson('2026-07-17 INFO payload {"a":1} tail')).toBe(true);
  });

  it("routes arrays only when they dominate the line", () => {
    expect(shouldAutoRouteJson('[{"a":1},{"b":2}]')).toBe(true);
    expect(shouldAutoRouteJson("retry [3] failed after 5 attempts")).toBe(false);
  });

  it("never routes prose, empty objects, or non-JSON", () => {
    expect(shouldAutoRouteJson("no json here")).toBe(false);
    expect(shouldAutoRouteJson("use {} braces for blocks")).toBe(false);
    expect(shouldAutoRouteJson("server started {unclosed")).toBe(false);
  });
});
