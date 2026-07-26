/**
 * Dev-only benchmark harness — active only under `vite dev` with `?bench` in the URL.
 *
 * Installs a minimal `window.__TAURI_INTERNALS__` shim so the app boots in a plain
 * browser (no Rust backend), captures `listen()` registrations, and exposes
 * `window.__bench` to seed/stream synthetic log batches through the REAL ingest
 * pipeline: emit("log:batch") → parse worker → ring buffer → store version bump.
 *
 * Never bundled in production: the only call site is guarded by `import.meta.env.DEV`,
 * so the module is tree-shaken out of release builds.
 */
import { useApp } from "../store";
import { bufferFor } from "./ring";
import type { BatchPayload, LogStream, SourceDef } from "./types";

type EventCallback = (event: { event: string; id: number; payload: unknown }) => void;

const callbacks = new Map<number, EventCallback>();
const listeners = new Map<string, Set<number>>();
let nextCallbackId = 1;

function stubInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "plugin:event|listen": {
      const event = args?.event as string;
      const handler = args?.handler as number;
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(handler);
      return Promise.resolve(null);
    }
    case "plugin:event|unlisten": {
      const handler = args?.eventId as number;
      for (const set of listeners.values()) set.delete(handler);
      callbacks.delete(handler);
      return Promise.resolve(null);
    }
    case "take_opened_files":
      return Promise.resolve([]);
    default:
      // persist/store/dialog paths all catch their own failures
      return Promise.reject(new Error(`bench shim: unhandled command ${cmd}`));
  }
}

function emit(event: string, payload: unknown): void {
  const ids = listeners.get(event);
  if (!ids) return;
  for (const id of ids) callbacks.get(id)?.({ event, id, payload });
}

// ─── deterministic synthetic log lines ────────────────────────────────────

/** mulberry32 — tiny seeded PRNG so every run generates the identical corpus */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROUTES = ["/api/v1/items", "/api/v1/users", "/healthz", "/api/v1/orders", "/metrics", "/api/v1/auth/refresh"];
const SERVICES = ["svc.worker", "svc.http", "svc.db", "svc.cache", "svc.queue"];

function makeLines(rand: () => number, firstSeq: number, count: number): BatchPayload["lines"] {
  const lines: { seq: number; raw: string; stream: LogStream }[] = [];
  let seq = firstSeq;
  while (lines.length < count) {
    const r = rand();
    const ts = `2026-07-26T10:${String(Math.floor(seq / 3600) % 60).padStart(2, "0")}:${String(Math.floor(seq / 60) % 60).padStart(2, "0")}.${String(seq % 1000).padStart(3, "0")}Z`;
    const svc = SERVICES[Math.floor(rand() * SERVICES.length)];
    const route = ROUTES[Math.floor(rand() * ROUTES.length)];
    const dur = (rand() * 180).toFixed(1);
    if (r < 0.55) {
      lines.push({ seq: seq++, raw: `${ts} INFO ${svc} request handled route=${route} status=200 dur=${dur}ms`, stream: "out" });
    } else if (r < 0.67) {
      lines.push({ seq: seq++, raw: `${ts} DEBUG ${svc} cache probe key=item:${Math.floor(rand() * 90000)} hit=${rand() > 0.4}`, stream: "out" });
    } else if (r < 0.77) {
      lines.push({ seq: seq++, raw: `${ts} WARN ${svc} slow query route=${route} dur=${(200 + rand() * 900).toFixed(1)}ms rows=${Math.floor(rand() * 5000)}`, stream: "out" });
    } else if (r < 0.82) {
      lines.push({ seq: seq++, raw: `${ts} ERROR ${svc} upstream timeout route=${route} attempt=${1 + Math.floor(rand() * 3)}`, stream: "err" });
    } else if (r < 0.92) {
      lines.push({ seq: seq++, raw: `{"ts":"${ts}","level":"info","svc":"${svc}","msg":"request","route":"${route}","status":200,"dur_ms":${dur},"trace":"${Math.floor(rand() * 1e9).toString(16)}"}`, stream: "out" });
    } else if (r < 0.95) {
      // large JSON → exercises the collapse-preview path
      const items = Array.from({ length: 40 }, (_, i) => `{"id":${i},"sku":"SKU-${Math.floor(rand() * 1e6)}","qty":${Math.floor(rand() * 9)},"price":${(rand() * 100).toFixed(2)}}`);
      lines.push({ seq: seq++, raw: `{"ts":"${ts}","level":"debug","svc":"${svc}","msg":"payload dump","items":[${items.join(",")}]}`, stream: "out" });
    } else if (r < 0.98) {
      lines.push({ seq: seq++, raw: `${ts} [32mOK[0m ${svc} [36m${route}[0m completed in [33m${dur}ms[0m`, stream: "out" });
    } else {
      lines.push({ seq: seq++, raw: `${ts} ERROR ${svc} unhandled rejection processing ${route}`, stream: "err" });
      lines.push({ seq: seq++, raw: `TypeError: Cannot read properties of undefined (reading 'id')`, stream: "err" });
      for (let f = 0; f < 5 && lines.length < count; f++) {
        lines.push({ seq: seq++, raw: `    at handle${f} (src/handlers/items.ts:${40 + f * 17}:${3 + f})`, stream: "err" });
      }
    }
  }
  return lines.slice(0, count) as BatchPayload["lines"];
}

// ─── public bench API ─────────────────────────────────────────────────────

const seqBySource = new Map<string, number>();
let liveTimer: number | null = null;

function feedBatch(sourceId: string, count: number, rand: () => number): void {
  const firstSeq = seqBySource.get(sourceId) ?? 0;
  const lines = makeLines(rand, firstSeq, count);
  seqBySource.set(sourceId, firstSeq + lines.length);
  emit("log:batch", { sourceId, firstSeq, lines, dropped: 0 } satisfies BatchPayload);
}

const bench = {
  emit,
  useApp,
  ring: bufferFor,
  /** create + open a synthetic source tab */
  ensureSource(id = "bench-src", name = "bench"): void {
    const def = { id, name, kind: "cmd", command: "bench: synthetic feed" } as SourceDef;
    useApp.getState().saveSource(def);
    useApp.getState().openSourceTab(id);
  },
  /** seed `total` deterministic lines through the real worker path, in chunks */
  async seed(sourceId = "bench-src", total = 20000, seedVal = 1337): Promise<number> {
    const rand = prng(seedVal);
    const chunk = 500;
    for (let fed = 0; fed < total; fed += chunk) {
      feedBatch(sourceId, Math.min(chunk, total - fed), rand);
      // let the worker/main-thread drain between chunks
      await new Promise((r) => setTimeout(r, 0));
    }
    const target = seqBySource.get(sourceId) ?? 0;
    // wait until the ring caught up (worker round-trip is async)
    for (let i = 0; i < 400; i++) {
      if (bufferFor(sourceId).totalSeen >= target) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return bufferFor(sourceId).length;
  },
  /** stream batches at `hz` with `perBatch` lines each — mimics live tailing */
  startLive(sourceId = "bench-src", hz = 30, perBatch = 60, seedVal = 4242): void {
    bench.stopLive();
    const rand = prng(seedVal);
    liveTimer = window.setInterval(() => feedBatch(sourceId, perBatch, rand), Math.round(1000 / hz));
  },
  stopLive(): void {
    if (liveTimer != null) window.clearInterval(liveTimer);
    liveTimer = null;
  },
};

declare global {
  interface Window {
    __bench?: typeof bench;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function installBenchHarness(): void {
  if (!new URLSearchParams(window.location.search).has("bench")) return;
  window.__TAURI_INTERNALS__ = {
    invoke: stubInvoke,
    transformCallback(cb: EventCallback): number {
      const id = nextCallbackId++;
      callbacks.set(id, cb);
      return id;
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    plugins: {},
  };
  window.__bench = bench;
}
