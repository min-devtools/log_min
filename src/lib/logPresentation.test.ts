import { describe, expect, it } from "vitest";
import { frameLocation, rawLogText, tokenizeLogLine } from "./logPresentation";
import type { Frame, SourceDef } from "./types";

/** map spans to [text, cls] pairs for readable assertions */
const toks = (text: string) => tokenizeLogLine(text).map((s) => [text.slice(s.start, s.end), s.cls]);

describe("tokenizeLogLine", () => {
  it("colors json keys, strings, numbers, bools and cycles bracket depth", () => {
    expect(toks('{"a":1,"ok":true,"deep":[{"x":null}]}')).toEqual([
      ["{", "tok-br-0"],
      ['"a"', "tok-key"],
      ["1", "tok-num"],
      ['"ok"', "tok-key"],
      ["true", "tok-bool"],
      ['"deep"', "tok-key"],
      ["[", "tok-br-1"],
      ["{", "tok-br-2"],
      ['"x"', "tok-key"],
      ["null", "tok-bool"],
      ["}", "tok-br-2"],
      ["]", "tok-br-1"],
      ["}", "tok-br-0"],
    ]);
  });

  it("colors logfmt keys, urls and plain numbers", () => {
    expect(toks("level=info port=3000 url=https://x.dev/a?b=1")).toEqual([
      ["level", "tok-key"],
      ["port", "tok-key"],
      ["3000", "tok-num"],
      ["url", "tok-key"],
      ["https://x.dev/a?b=1", "tok-url"],
    ]);
  });

  it("leaves plain prose untouched", () => {
    expect(tokenizeLogLine("server started successfully")).toEqual([]);
  });

  it("colors timestamps and uuids whole, not their digit fragments", () => {
    expect(toks("2026-07-17T04:05:16.123Z req=550e8400-e29b-41d4-a716-446655440000 took 42")).toEqual([
      ["2026-07-17T04:05:16.123Z", "tok-time"],
      ["req", "tok-key"],
      ["550e8400-e29b-41d4-a716-446655440000", "tok-uuid"],
      ["42", "tok-num"],
    ]);
    expect(toks("04:05:16,123 INFO done")).toEqual([["04:05:16,123", "tok-time"]]);
  });
});

describe("raw log presentation", () => {
  it("returns an error head exactly as the source emitted it", () => {
    const raw = "2026-07-17T01:23:45.678Z ERROR TypeError: boom userId=42";

    expect(rawLogText(raw)).toBe(raw);
  });

  it("returns a stack frame exactly as the source emitted it", () => {
    const raw = "    at async run (/work/src/main.ts:3:7)";

    expect(rawLogText(raw)).toBe(raw);
  });

  it("does not replace an empty source line with visible metadata", () => {
    expect(rawLogText("")).toBe("");
  });
});

describe("dock frame locations", () => {
  it("keeps file, line, column, parent path, and copy location separate", () => {
    const frame: Frame = {
      fn: "run",
      path: "/work/src/main.ts",
      line: 3,
      col: 7,
      isApp: true,
    };

    expect(frameLocation(frame)).toEqual({
      file: "main.ts",
      parent: "/work/src",
      position: "3:7",
      resolvedPath: "/work/src/main.ts",
      full: "/work/src/main.ts:3:7",
    });
  });

  it("resolves a relative application frame against a command cwd", () => {
    const frame: Frame = {
      fn: "handler",
      path: "src/handler.ts",
      line: 18,
      isApp: true,
    };
    const source: SourceDef = {
      id: "api",
      name: "API",
      kind: "cmd",
      command: "npm run dev",
      cwd: "/srv/api",
    };

    expect(frameLocation(frame, source).full).toBe("/srv/api/src/handler.ts:18");
  });

  it("does not turn a Node runtime pseudo-path into a project file path", () => {
    const frame: Frame = {
      fn: "processTicksAndRejections",
      path: "node:internal/process/task_queues",
      line: 95,
      col: 5,
      isApp: false,
    };
    const source: SourceDef = {
      id: "api",
      name: "API",
      kind: "cmd",
      command: "npm run dev",
      cwd: "/srv/api",
    };

    expect(frameLocation(frame, source).full).toBe("node:internal/process/task_queues:95:5");
  });
});
