import { describe, expect, it } from "vitest";
import { extractJson } from "./json";

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
