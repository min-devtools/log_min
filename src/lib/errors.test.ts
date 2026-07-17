import { describe, expect, it } from "vitest";
import { ErrorIndex, copyTextForLines } from "./errors";
import { TraceAssembler } from "./trace";
import type { LogLine } from "./types";

function tagged(lines: string[], seqStart = 0): LogLine[] {
  const assembler = new TraceAssembler();
  return lines.map((raw, offset) => {
    const line: LogLine = { seq: seqStart + offset, raw, stream: "out" };
    assembler.feed(line);
    return line;
  });
}

function feed(index: ErrorIndex, lines: LogLine[]): void {
  for (const line of lines) index.feed(line);
}

describe("ErrorIndex", () => {
  it("turns a detected trace into a dock-ready group", () => {
    const index = new ErrorIndex();
    feed(index, tagged([
      "2026-07-17T01:02:03Z ERROR TypeError: Cannot read properties of undefined",
      "    at computeInvoice (src/billing/invoice.ts:87:19)",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
      "GET /health 200",
    ]));

    expect(index.snapshot()).toEqual({
      totalOccurrences: 1,
      groups: [expect.objectContaining({
        count: 1,
        message: "TypeError: Cannot read properties of undefined",
        firstSeq: 0,
        lastSeq: 2,
        topFrame: expect.objectContaining({ path: "src/billing/invoice.ts", line: 87, col: 19 }),
        frames: expect.arrayContaining([
          expect.objectContaining({ path: "src/billing/invoice.ts", isApp: true }),
          expect.objectContaining({ path: "node:internal/process/task_queues", isApp: false }),
        ]),
        rawLines: [
          "2026-07-17T01:02:03Z ERROR TypeError: Cannot read properties of undefined",
          "    at computeInvoice (src/billing/invoice.ts:87:19)",
          "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
        ],
      })],
    });
  });

  it("groups repeated fingerprints and keeps the latest complete trace", () => {
    const index = new ErrorIndex();
    feed(index, tagged([
      "TypeError: order 123 failed",
      "    at computeInvoice (src/billing/invoice.ts:87:19)",
      "normal line",
    ], 0));
    feed(index, tagged([
      "TypeError: order 999 failed",
      "    at computeInvoice (src/billing/invoice.ts:91:7)",
      "normal line",
    ], 10));

    const snapshot = index.snapshot();
    expect(snapshot.totalOccurrences).toBe(2);
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]).toMatchObject({
      count: 2,
      firstSeq: 0,
      lastSeq: 11,
      rawLines: [
        "TypeError: order 999 failed",
        "    at computeInvoice (src/billing/invoice.ts:91:7)",
      ],
    });
  });

  it("exposes an in-progress trace without counting it twice after completion", () => {
    const index = new ErrorIndex();
    const lines = tagged([
      "RangeError: too much recursion",
      "    at visit (src/tree.ts:44:9)",
      "next request",
    ]);

    index.feed(lines[0]);
    index.feed(lines[1]);
    expect(index.snapshot()).toMatchObject({ totalOccurrences: 1, groups: [{ count: 1 }] });

    index.feed(lines[2]);
    expect(index.snapshot()).toMatchObject({ totalOccurrences: 1, groups: [{ count: 1 }] });
  });

  it("groups standalone ERROR lines even when no stack frame follows", () => {
    const index = new ErrorIndex();
    index.feed({
      seq: 20,
      raw: "2026-07-17 10:33:03 [ERROR] getStatisticBaccarat -> Can not get data : FAIL",
      stream: "out",
      level: "err",
    });
    index.feed({
      seq: 21,
      raw: "2026-07-17 10:34:55 [ERROR] getStatisticBaccarat -> Can not get data : FAIL",
      stream: "out",
      level: "err",
    });

    const snapshot = index.snapshot();
    expect(snapshot.totalOccurrences).toBe(2);
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]).toMatchObject({
      count: 2,
      frames: [],
      lastSeq: 21,
      rawLines: ["2026-07-17 10:34:55 [ERROR] getStatisticBaccarat -> Can not get data : FAIL"],
    });
  });
});

describe("copyTextForLines", () => {
  it("copies the complete raw payload in display order", () => {
    expect(copyTextForLines(tagged([
      "TypeError: boom",
      "    at run (src/main.ts:3:7)",
    ]))).toBe("TypeError: boom\n    at run (src/main.ts:3:7)");
  });
});
