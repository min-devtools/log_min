import type { Frame, LogLevel, LogLine } from "./types";

// ─── level detection (M1: cheap regex; the parser worker lands in M2) ────

const RE_ERR = /\b(ERROR|ERR|FATAL|PANIC|SEVERE|CRITICAL)\b/i;
const RE_WARN = /\b(WARN|WARNING)\b/i;
const RE_DEBUG = /\b(DEBUG|TRACE|VERBOSE)\b/i;
const RE_INFO = /\b(INFO|NOTICE)\b/i;
/** pino/bunyan numeric levels: 10 trace · 20 debug · 30 info · 40 warn · 50 error · 60 fatal */
const RE_JSON_LEVEL = /"level"\s*:\s*(\d+)/;

export function detectLevel(raw: string): LogLevel | undefined {
  // scan only the head of the line — levels live near the front, and long
  // lines (json blobs) shouldn't cost a full regex pass
  const head = raw.length > 200 ? raw.slice(0, 200) : raw;
  if (head.charCodeAt(0) === 0x7b /* { */) {
    const m = RE_JSON_LEVEL.exec(head);
    if (m) {
      const n = Number(m[1]);
      return n >= 50 ? "err" : n >= 40 ? "warn" : n >= 30 ? "info" : "debug";
    }
  }
  if (RE_ERR.test(head)) return "err";
  if (RE_WARN.test(head)) return "warn";
  if (RE_DEBUG.test(head)) return "debug";
  if (RE_INFO.test(head)) return "info";
  return undefined;
}

/**
 * Node/TS stack-trace detection — M1 scope. Python/JVM/Rust/Go land later.
 * Stateful per source: feed() marks lines in place (traceId/traceStart/frame).
 */

const MAX_FRAMES = 150;

/** `at fn (path:line:col)` · `at path:line:col` · `at async fn (…)` */
const RE_FRAME =
  /^\s+at\s+(?:async\s+)?(?:new\s+)?(?:([^\s(]+(?:\s+\[as\s+[^\]]+\])?)\s+\()?([^()]+?):(\d+):(\d+)\)?\s*$/;

/** `TypeError: …`, `CustomFooException: …`, unhandled-rejection banners */
const RE_ERROR_HEAD =
  /\b((?:[A-Z][A-Za-z0-9]*)?(?:Error|Exception)|UnhandledPromiseRejection\w*)\b(?::\s|\s\(|$)/;

const NON_APP = /^(node:|internal\/|native\b)|node_modules\//;

export function parseFrame(raw: string): Frame | null {
  const m = RE_FRAME.exec(raw);
  if (!m) return null;
  const path = m[2].trim();
  // guard against `at foo (<anonymous>)` and eval frames
  if (path.startsWith("<") || path.includes("<anonymous>")) return null;
  return {
    fn: m[1] ?? "",
    path,
    line: Number(m[3]),
    col: Number(m[4]),
    isApp: !NON_APP.test(path),
  };
}

export function isErrorHead(raw: string): boolean {
  return RE_ERROR_HEAD.test(raw);
}

/** stable digits/uuid/url scrub so fingerprints survive dynamic values */
function scrub(s: string): string {
  return s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\d+/g, "#");
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * fingerprint = error class+scrubbed message + top-3 app frames (fn + path,
 * deliberately NO line numbers — editing code must not create a new group)
 */
export function fingerprint(message: string, frames: Frame[]): string {
  const top = frames.filter((f) => f.isApp).slice(0, 3).map((f) => `${f.fn}@${f.path}`);
  return hash(scrub(message) + "|" + top.join("|"));
}

let nextTraceId = 1;

interface OpenTrace {
  id: number;
  frames: number;
}

export class TraceAssembler {
  private open: OpenTrace | null = null;
  private prev: LogLine | null = null;

  /** mark lines in place as they stream in; called per line, in order */
  feed(line: LogLine): void {
    const frame = parseFrame(line.raw);

    if (frame) {
      if (!this.open) {
        // frames appeared without a head we recognized — adopt the previous
        // line as the message (common: level-prefixed line, then the trace)
        this.open = { id: nextTraceId++, frames: 0 };
        if (this.prev) {
          this.prev.traceId = this.open.id;
          this.prev.traceStart = true;
          this.prev.level = "err";
        }
      }
      this.open.frames++;
      if (this.open.frames <= MAX_FRAMES) {
        line.traceId = this.open.id;
        line.frame = frame;
      }
      this.prev = line;
      return;
    }

    if (isErrorHead(line.raw)) {
      // a new error head always starts a fresh trace
      this.open = { id: nextTraceId++, frames: 0 };
      line.traceId = this.open.id;
      line.traceStart = true;
      line.level = "err";
      this.prev = line;
      return;
    }

    // any other line closes the open trace
    this.open = null;
    this.prev = line;
  }
}
