import { describe, expect, it } from "vitest";
import { extractJson, filterJsonFields, jsonContainerPaths, jsonFields, shouldAutoRouteJson } from "./json";

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

  it("parses an Apache HTTP Wire payload wrapped in transport quotes", () => {
    const hit = extractJson('2026-07-17 DEBUG http-outgoing-1361 << "{"took":25,"hits":{"total":4}}"');

    expect(hit?.value).toEqual({ took: 25, hits: { total: 4 } });
  });

  it("returns null for prose and never-closed brackets", () => {
    expect(extractJson("server started {unclosed")).toBeNull();
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("jsonFields", () => {
  it("flattens nested objects and arrays into typed JSONPath rows", () => {
    const rows = jsonFields({
      action: "WIN",
      ok: true,
      response: { amount: 124565.68, tags: ["paid", null] },
    });

    expect(rows.map(({ path, depth, type, preview }) => ({ path, depth, type, preview }))).toEqual([
      { path: "$", depth: 0, type: "object", preview: "3 fields" },
      { path: "$.action", depth: 1, type: "string", preview: "WIN" },
      { path: "$.ok", depth: 1, type: "boolean", preview: "true" },
      { path: "$.response", depth: 1, type: "object", preview: "2 fields" },
      { path: "$.response.amount", depth: 2, type: "number", preview: "124565.68" },
      { path: "$.response.tags", depth: 2, type: "array", preview: "2 items" },
      { path: "$.response.tags[0]", depth: 3, type: "string", preview: "paid" },
      { path: "$.response.tags[1]", depth: 3, type: "null", preview: "null" },
    ]);
  });

  it("uses bracket notation for unsafe keys and retains full copy values", () => {
    const long = "x".repeat(120);
    const rows = jsonFields({ "request.id": long });
    const field = rows[1];

    expect(field.path).toBe('$["request.id"]');
    expect(field.preview).toBe(`${"x".repeat(77)}…`);
    expect(field.copyValue).toBe(long);
  });

  it("filters fields by path, type, or preview without changing their order", () => {
    const rows = jsonFields({ action: "BET", response: { status: "OK", amount: 42 } });

    expect(filterJsonFields(rows, "response").map((field) => field.path)).toEqual([
      "$.response",
      "$.response.status",
      "$.response.amount",
    ]);
    expect(filterJsonFields(rows, "number").map((field) => field.path)).toEqual(["$.response.amount"]);
    expect(filterJsonFields(rows, " ok ").map((field) => field.path)).toEqual(["$.response.status"]);
  });
});

describe("jsonContainerPaths", () => {
  it("returns every collapsible object and array path in tree order", () => {
    expect(jsonContainerPaths({
      hit: { id: "a", tags: ["one", { nested: true }] },
      count: 2,
      emptyObject: {},
      emptyArray: [],
    })).toEqual([
      "$",
      "$.hit",
      "$.hit.tags",
      "$.hit.tags[1]",
    ]);
  });

  it("returns no paths for primitive values", () => {
    expect(jsonContainerPaths("plain")).toEqual([]);
    expect(jsonContainerPaths(null)).toEqual([]);
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
