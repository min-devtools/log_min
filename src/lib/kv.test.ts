import { describe, expect, it } from "vitest";
import { extractKv } from "./kv";

describe("extractKv", () => {
  it("captures a=b and field: value forms", () => {
    expect(extractKv("a=b")).toEqual([{ key: "a", value: "b" }]);
    expect(extractKv("field: value")).toEqual([{ key: "field", value: "value" }]);
    expect(extractKv("a = b")).toEqual([{ key: "a", value: "b" }]);
  });

  it("mixes forms and strips quotes", () => {
    expect(extractKv('user_id=42 status: ok msg="hello world"')).toEqual([
      { key: "user_id", value: "42" },
      { key: "status", value: "ok" },
      { key: "msg", value: "hello world" },
    ]);
  });

  it("ignores timestamps and urls", () => {
    expect(extractKv("2026-07-17 12:30:45 INFO done")).toEqual([]);
    const pairs = extractKv("GET url=https://x.com/a?z=1 took=3ms");
    expect(pairs).toEqual([
      { key: "url", value: "https://x.com/a?z=1" },
      { key: "took", value: "3ms" },
    ]);
  });

  it("captures bracketed values whole — arrays and json objects", () => {
    const line =
      'searchES -> indices=[battle-1, battle-2] query={"size":15,"bool":{"must":[{"term":{"v":5}}]}} took=3ms';
    expect(extractKv(line)).toEqual([
      { key: "indices", value: "[battle-1, battle-2]" },
      { key: "query", value: '{"size":15,"bool":{"must":[{"term":{"v":5}}]}}' },
      { key: "took", value: "3ms" },
    ]);
  });

  it("an unterminated bracket takes the rest of the line", () => {
    expect(extractKv("q={\"a\":1")).toEqual([{ key: "q", value: '{"a":1' }]);
  });

  it("bare values inside a bracketed block don't swallow the closing bracket", () => {
    expect(extractKv("http-outgoing-48 [ACTIVE] [content length: 6333; pos: 6333; completed: true]")).toEqual([
      { key: "length", value: "6333" },
      { key: "pos", value: "6333" },
      { key: "completed", value: "true" },
    ]);
  });

  it("dedups repeated pairs, keeps order", () => {
    expect(extractKv("a=1, b=2, a=1")).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
  });
});
