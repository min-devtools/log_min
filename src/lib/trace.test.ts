import { describe, expect, it } from "vitest";
import { TraceAssembler, detectLevel, fingerprint, parseFrame } from "./trace";
import type { LogLine } from "./types";

describe("detectLevel", () => {
  it("maps pino/bunyan numeric levels on json lines", () => {
    expect(detectLevel('{"level":50,"msg":"boom"}')).toBe("err");
    expect(detectLevel('{"level":60,"msg":"fatal"}')).toBe("err");
    expect(detectLevel('{"level":40,"msg":"careful"}')).toBe("warn");
    expect(detectLevel('{"level":30,"msg":"hello"}')).toBe("info");
    expect(detectLevel('{"level":20,"msg":"dbg"}')).toBe("debug");
  });

  it("still detects string levels in json and plain lines", () => {
    expect(detectLevel('{"level":"error","msg":"boom"}')).toBe("err");
    expect(detectLevel("2026-01-01 WARN something")).toBe("warn");
    expect(detectLevel("plain line")).toBeUndefined();
  });

  it("the first level tag wins — payload words don't override the line's tag", () => {
    expect(detectLevel("2026-07-17 [DEBUG] from org.apache.http.wire - << \"x\",\"error_code\":200")).toBe("debug");
    expect(detectLevel('[INFO] response {"message":"ERROR ignored"}')).toBe("info");
    expect(detectLevel("2026-01-01 ERROR while DEBUG dump")).toBe("err");
  });

  it("a word cut in half by the 200-char scan window is not a level", () => {
    // pad so the scan boundary lands right after "error" inside "error_code"
    const prefix = "2026-07-17 15:44:06,643 resId=none - << ";
    const pad = "x".repeat(200 - prefix.length - '"error'.length);
    const line = `${prefix}${pad}"error_code":200,"status":"OK"`;
    expect(detectLevel(line)).toBeUndefined();
  });
});

function feed(lines: string[]): LogLine[] {
  const asm = new TraceAssembler();
  const out: LogLine[] = lines.map((raw, i) => ({ seq: i, raw, stream: "out" as const }));
  for (const l of out) asm.feed(l);
  return out;
}

describe("parseFrame", () => {
  it("parses named, method, async, anonymous and bare frames", () => {
    expect(parseFrame("    at computeInvoice (src/billing/invoice.ts:87:19)")).toMatchObject({
      fn: "computeInvoice",
      path: "src/billing/invoice.ts",
      line: 87,
      col: 19,
      isApp: true,
    });
    expect(parseFrame("    at OrderService.create (/app/src/orders/service.ts:41:11)")).toMatchObject({
      fn: "OrderService.create",
      line: 41,
    });
    expect(parseFrame("    at async Promise.all (index 0)")).toBeNull();
    expect(parseFrame("    at async handler (/srv/api/routes.ts:12:3)")).toMatchObject({
      fn: "handler",
      path: "/srv/api/routes.ts",
    });
    expect(parseFrame("    at /Users/x/app/dist/main.js:10:2")).toMatchObject({
      fn: "",
      path: "/Users/x/app/dist/main.js",
    });
    expect(parseFrame("    at processTicksAndRejections (node:internal/process/task_queues:95:5)")).toMatchObject({
      isApp: false,
    });
    expect(parseFrame("    at Module._load (node_modules/tsx/dist/loader.js:5:1)")).toMatchObject({
      isApp: false,
    });
    expect(parseFrame("INFO normal log line")).toBeNull();
    expect(parseFrame("    at eval (<anonymous>:1:1)")).toBeNull();
  });
});

describe("TraceAssembler", () => {
  it("groups an error head with its frames", () => {
    const lines = feed([
      "GET /orders 200",
      "TypeError: Cannot read properties of undefined (reading 'total')",
      "    at computeInvoice (src/billing/invoice.ts:87:19)",
      "    at OrderService.create (src/orders/service.ts:41:11)",
      "GET /health 200",
    ]);
    expect(lines[0].traceId).toBeUndefined();
    expect(lines[1].traceStart).toBe(true);
    expect(lines[1].level).toBe("err");
    expect(lines[2].traceId).toBe(lines[1].traceId);
    expect(lines[2].frame?.isApp).toBe(true);
    expect(lines[3].traceId).toBe(lines[1].traceId);
    expect(lines[4].traceId).toBeUndefined();
  });

  it("adopts the previous line as head when frames appear without one", () => {
    const lines = feed([
      "14:02:11 ERROR request failed req=9912",
      "    at handler (/srv/api/routes.ts:12:3)",
    ]);
    expect(lines[0].traceStart).toBe(true);
    expect(lines[1].traceId).toBe(lines[0].traceId);
  });

  it("separates two consecutive traces", () => {
    const lines = feed([
      "TypeError: a",
      "    at f (src/a.ts:1:1)",
      "RangeError: b",
      "    at g (src/b.ts:2:2)",
    ]);
    expect(lines[0].traceId).not.toBe(lines[2].traceId);
    expect(lines[1].traceId).toBe(lines[0].traceId);
    expect(lines[3].traceId).toBe(lines[2].traceId);
  });

  it("detects error heads embedded after level prefixes", () => {
    const lines = feed([
      "2026-07-17T14:02:11.611Z ERROR UnhandledPromiseRejectionWarning: boom",
      "    at run (src/main.ts:3:3)",
    ]);
    expect(lines[0].traceStart).toBe(true);
  });
});

describe("fingerprint", () => {
  const frames = (line: number) => [
    { fn: "computeInvoice", path: "src/billing/invoice.ts", line, col: 1, isApp: true },
    { fn: "create", path: "src/orders/service.ts", line: line + 10, col: 1, isApp: true },
  ];

  it("ignores line numbers — editing code must not create a new group", () => {
    expect(fingerprint("TypeError: boom", frames(87))).toBe(fingerprint("TypeError: boom", frames(91)));
  });

  it("scrubs ids, uuids and urls from the message", () => {
    expect(
      fingerprint("Error: order 123 failed for 550e8400-e29b-41d4-a716-446655440000", frames(1)),
    ).toBe(fingerprint("Error: order 999 failed for 6ba7b810-9dad-11d1-80b4-00c04fd430c8", frames(1)));
  });

  it("differs when the failing app frame differs", () => {
    const other = [{ fn: "otherFn", path: "src/other.ts", line: 1, col: 1, isApp: true }];
    expect(fingerprint("Error: x", frames(1))).not.toBe(fingerprint("Error: x", other));
  });
});
