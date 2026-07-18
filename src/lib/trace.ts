import type { Frame, LogLevel, LogLine } from "./types";

// ─── level detection (cheap regex; runs inside parseWorker off the UI thread) ────

/** first level keyword in the head wins — a payload word can't override the line's own tag */
const RE_LEVEL =
  /\b(?:(ERROR|ERR|FATAL|PANIC|SEVERE|CRITICAL)|(WARN|WARNING)|(DEBUG|TRACE|VERBOSE)|(INFO|NOTICE))\b/i;
/** pino/bunyan numeric levels: 10 trace · 20 debug · 30 info · 40 warn · 50 error · 60 fatal */
const RE_JSON_LEVEL = /"level"\s*:\s*(\d+)/;

export function detectLevel(raw: string): LogLevel | undefined {
  // scan only the head of the line — levels live near the front, and long
  // lines (json blobs) shouldn't cost a full regex pass. Drop a token the
  // window cut in half: "error_code" sliced to "error" is not a level.
  const head = raw.length > 200 ? raw.slice(0, 200).replace(/[\w$]+$/, "") : raw;
  if (head.charCodeAt(0) === 0x7b /* { */) {
    const m = RE_JSON_LEVEL.exec(head);
    if (m) {
      const n = Number(m[1]);
      return n >= 50 ? "err" : n >= 40 ? "warn" : n >= 30 ? "info" : "debug";
    }
  }
  const m = RE_LEVEL.exec(head);
  if (!m) return undefined;
  return m[1] ? "err" : m[2] ? "warn" : m[3] ? "debug" : "info";
}

/**
 * Node/TS + Go stack-trace detection. Python/JVM/Rust land later.
 * Stateful per source: feed() marks lines in place (traceId/traceStart/frame).
 */

const MAX_FRAMES = 150;
/** indented continuation lines absorbed into one error block before it force-closes */
const MAX_ABSORBED = 300;

/** `at fn (path:line:col)` · `at path:line:col` · `at async fn (…)` · trailing `{` when the error has own props */
const RE_FRAME =
  /^\s+at\s+(?:async\s+)?(?:new\s+)?(?:([^\s(]+(?:\s+\[as\s+[^\]]+\])?)\s+\()?([^()]+?):(\d+):(\d+)\)?\s*\{?\s*$/;

/** `TypeError: …`, `CustomFooException: …`, unhandled-rejection banners */
const RE_ERROR_HEAD =
  /\b((?:[A-Z][A-Za-z0-9]*)?(?:Error|Exception)|UnhandledPromiseRejection\w*)\b(?::\s|\s\(|$)/;

const NON_APP =
  /^(node:|internal\/|native\b)|node_modules\/|\/go\/pkg\/mod\/|^\/usr\/local\/go\/|\/libexec\/src\//;

/** `Caused by: …`, `[cause]: …`, `cause: …`, `originalError: …` — a nested cause, not a new top-level error */
const RE_CAUSE_CONTINUATION = /^\s*(?:caused by|\[cause\]|originalerror|cause)\s*:/i;

// ── Go panics: `panic: msg` head, then a blank line, `goroutine N [state]:`,
// and two lines per frame — `pkg.fn(args)` followed by `\t/path/file.go:8 +0x7c` ──
const RE_GO_HEAD = /^(?:panic|fatal error):\s/;
const RE_GO_GOROUTINE = /^goroutine \d+ \[[^\]]*\]:$/;
const RE_GO_FILE = /^\t(.+\.go):(\d+)(?:\s+\+0x[0-9a-f]+)?\s*$/;
/** `main.main()` · `pkg.(*T).Method(0x…)` · `created by pkg.fn in goroutine N` */
const RE_GO_FN = /^(\S.*)\)$|^created by (\S+)/;

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
  /** indented continuation lines swallowed so far (MAX_ABSORBED guard) */
  absorbed: number;
}

export class TraceAssembler {
  private open: OpenTrace | null = null;
  private prev: LogLine | null = null;
  /** inside a Go panic block — frames are two-line pairs, blank lines don't close */
  private goMode = false;
  /** the `pkg.fn(args)` line waiting for its `\tfile.go:line` partner */
  private goFn: string | null = null;

  /** mark lines in place as they stream in; called per line, in order */
  feed(line: LogLine): void {
    if (this.goMode && this.open) {
      if (this.feedGo(line)) return;
      // not part of the panic block anymore — fall through to the normal path
      this.goMode = false;
      this.goFn = null;
    }

    if (RE_GO_HEAD.test(line.raw)) {
      this.open = { id: nextTraceId++, frames: 0, absorbed: 0 };
      this.goMode = true;
      this.goFn = null;
      line.traceId = this.open.id;
      line.traceStart = true;
      line.level = "err";
      this.prev = line;
      return;
    }

    const frame = parseFrame(line.raw);

    if (frame) {
      if (!this.open) {
        // frames appeared without a head we recognized — adopt the previous
        // line as the message (common: level-prefixed line, then the trace)
        this.open = { id: nextTraceId++, frames: 0, absorbed: 0 };
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
      // a recognized cause-chain marker while a trace is open is the SAME
      // error's cause, not a new one — keep it in the trace instead of
      // splitting the chain into disconnected fragments.
      // ponytail: a nested cause buried inside a property dump (past a
      // `name:`/`retriable:` line that already closed the trace) still
      // starts fresh — fully parsing Node's util.inspect object dump is out
      // of scope here.
      const continuation = this.open !== null && RE_CAUSE_CONTINUATION.test(line.raw);
      if (!continuation) this.open = { id: nextTraceId++, frames: 0, absorbed: 0 };
      line.traceId = this.open!.id;
      if (!continuation) line.traceStart = true;
      line.level = "err";
      this.prev = line;
      return;
    }

    // indented continuation of an error block — zap/logrus multi-line payloads,
    // Node error property dumps (`  name: '…'`) — joins the block instead of
    // closing it or becoming its own one-line error group
    if (
      /^[ \t]/.test(line.raw) &&
      line.raw.trim() !== "" &&
      (this.open !== null || this.prev?.level === "err") &&
      (this.open?.absorbed ?? 0) < MAX_ABSORBED
    ) {
      if (!this.open) {
        // the previous err-leveled line becomes the block's head (same
        // retro-adoption path the frame branch uses — patchPrev ships it)
        this.open = { id: nextTraceId++, frames: 0, absorbed: 0 };
        this.prev!.traceId = this.open.id;
        this.prev!.traceStart = true;
      }
      this.open.absorbed++;
      line.traceId = this.open.id;
      this.prev = line;
      return;
    }

    // any other line closes the open trace
    this.open = null;
    this.prev = line;
  }

  /** returns true when the line was consumed as part of the open Go panic block */
  private feedGo(line: LogLine): boolean {
    const raw = line.raw;
    const file = RE_GO_FILE.exec(raw);
    if (file) {
      this.open!.frames++;
      if (this.open!.frames <= MAX_FRAMES) {
        line.traceId = this.open!.id;
        line.frame = {
          fn: this.goFn ?? "",
          path: file[1],
          line: Number(file[2]),
          isApp: !NON_APP.test(file[1]),
        };
      }
      this.goFn = null;
      this.prev = line;
      return true;
    }
    // the blank separator after the head and goroutine banners stay inside the block
    if (raw.trim() === "" || RE_GO_GOROUTINE.test(raw)) {
      line.traceId = this.open!.id;
      this.goFn = null;
      this.prev = line;
      return true;
    }
    const fn = RE_GO_FN.exec(raw);
    if (fn) {
      // ponytail: while a panic block is open, any line ending in ")" reads as a
      // Go fn line — a plain log line ending in ")" gets absorbed, but the block
      // closes on its own next line, so mis-grouping stays local
      this.goFn = fn[2] ?? fn[1].replace(/\(.*$/, "");
      line.traceId = this.open!.id;
      this.prev = line;
      return true;
    }
    // indented continuation — a multi-line panic message ("connection refused"
    // detail lines before the goroutine banner) stays in the block
    if (/^[ \t]/.test(raw) && this.open!.absorbed < MAX_ABSORBED) {
      this.open!.absorbed++;
      line.traceId = this.open!.id;
      this.prev = line;
      return true;
    }
    return false;
  }
}
