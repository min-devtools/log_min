import { describe, expect, it } from "vitest";
import { Ring, RING_BYTE_CAP, RING_CAP } from "./ring";
import { detectLevel, TraceAssembler } from "./trace";
import type { LogLine } from "./types";

// vitest runs on node, but the app tsconfig has no node types — keep it loose
declare const process: {
  memoryUsage?: () => { heapUsed: number };
  stderr?: { write: (s: string) => void };
} | undefined;
declare const gc: (() => void) | undefined;

/** vitest's console interception eats console.log in some setups — write straight to stderr */
function report(msg: string): void {
  process?.stderr?.write(`${msg}\n`);
}

/**
 * M0 feasibility numbers (run: npm test -- perf). Not a regression gate —
 * thresholds are deliberately loose; the console output is the deliverable.
 */

function makeLines(n: number, offset = 0): LogLine[] {
  const out: LogLine[] = [];
  for (let i = 0; i < n; i++) {
    const k = (offset + i) % 20;
    let raw: string;
    if (k === 2) raw = "TypeError: Cannot read properties of undefined (reading 'total')";
    else if (k === 3) raw = "    at computeInvoice (src/billing/invoice.ts:87:19)";
    else if (k === 4) raw = "    at OrderService.create (src/orders/service.ts:41:11)";
    else if (k === 7) raw = `14:02:11.611 WARN retry 2/3 upstream=payments timeout=800ms req=${i}`;
    else raw = `14:02:11.301 INFO GET /orders/${i % 500} 200 12ms req=${i}`;
    out.push({ seq: 0, raw, stream: "out" });
  }
  return out;
}

describe("M0 feasibility", () => {
  it("ingest pipeline sustains >50k lines/s (detect + trace + ring)", () => {
    const N = 200_000;
    const lines = makeLines(N);
    const ring = new Ring();
    const asm = new TraceAssembler();
    const t0 = performance.now();
    for (let i = 0; i < N; i += 500) {
      const batch = lines.slice(i, i + 500);
      for (const l of batch) {
        l.level = detectLevel(l.raw);
        asm.feed(l);
      }
      ring.push(batch);
    }
    const ms = performance.now() - t0;
    const perSec = Math.round((N / ms) * 1000);
    report(`[M0] ingest: ${N} lines in ${ms.toFixed(0)}ms → ${perSec.toLocaleString()} lines/s`);
    expect(perSec).toBeGreaterThan(50_000);
    expect(ring.length).toBeLessThanOrEqual(RING_CAP);
  });

  it("200k retained lines stay under ~256MB heap", () => {
    if (typeof process === "undefined" || !process?.memoryUsage) return;
    if (typeof gc === "function") gc();
    const before = process.memoryUsage().heapUsed;
    const ring = new Ring();
    for (let i = 0; i < 200_000; i += 500) ring.push(makeLines(500, i));
    if (typeof gc === "function") gc();
    const deltaMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
    report(`[M0] RAM: 200k retained lines ≈ ${deltaMb.toFixed(1)} MB heap (ring.length=${ring.length})`);
    expect(deltaMb).toBeLessThan(256);
  });

  it("byte cap evicts giant-line bursts instead of ballooning", () => {
    const ring = new Ring();
    const huge = "x".repeat(100_000);
    for (let b = 0; b < 3; b++) {
      ring.push(Array.from({ length: 500 }, () => ({ seq: 0, raw: huge, stream: "out" as const })));
    }
    // 1500 × 100KB × 2B/char = ~300MB pushed; retained must respect 64MB cap
    expect(ring.length * huge.length * 2).toBeLessThanOrEqual(RING_BYTE_CAP + 500 * huge.length * 2);
    report(`[M0] burst: 1500×100KB pushed, retained ${ring.length} lines (cap ${RING_BYTE_CAP / 1024 / 1024}MB)`);
  });
});
