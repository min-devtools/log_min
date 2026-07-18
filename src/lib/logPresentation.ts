import { resolveFramePath } from "./editor";
import type { Frame, SourceDef } from "./types";

export interface FrameLocation {
  file: string;
  parent: string;
  position: string;
  resolvedPath: string;
  full: string;
}

/** The center pane is a faithful stream: never normalize detected log content. */
export function rawLogText(raw: string): string {
  return raw;
}

// ── display-only syntax tokens (strings · numbers · bools · urls · keys · brackets) ──

export interface TokenSpan {
  start: number;
  end: number;
  cls: string;
}

// uuid and timestamp come before key/number so ids and times win over their digit fragments;
// path (`pkg/file.go:16`, `src/app.ts:12:3`) comes first so its digits don't split into numbers
const TOKEN_RE =
  /(?<![\w./-])(\/?(?:[\w~$@.-]+\/)*[\w~$@.-]+\.[a-z]{1,5}:\d+(?::\d+)?)\b|("(?:\\.|[^"\\])*")(\s*:)?|('(?:\\.|[^'\\])*')|\b(true|false|null|none|undefined)\b|(https?:\/\/[^\s"'<>)\]}]+)|\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b|\b(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?)\b|([A-Za-z_][\w.-]*)(?==)|(-?\b\d+(?:\.\d+)?\b)|([{[(])|([)\]}])/gi;

/**
 * Cheap single-pass tokenizer for one log line — regex, not a parser; runs only
 * on rendered rows. Brackets cycle 3 depth colors, quoted keys before ":" and
 * logfmt keys before "=" get the key class. Long lines tokenize the head only.
 */
export function tokenizeLogLine(text: string, cap = 4_000): TokenSpan[] {
  const head = text.length > cap ? text.slice(0, cap) : text;
  const spans: TokenSpan[] = [];
  let depth = 0;
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(head); m; m = TOKEN_RE.exec(head)) {
    let cls: string;
    if (m[1]) cls = "tok-path";
    else if (m[2]) cls = m[3] ? "tok-key" : "tok-str";
    else if (m[4]) cls = "tok-str";
    else if (m[5]) cls = "tok-bool";
    else if (m[6]) cls = "tok-url";
    else if (m[7]) cls = "tok-uuid";
    else if (m[8]) cls = "tok-time";
    else if (m[9]) cls = "tok-key";
    else if (m[10]) cls = "tok-num";
    else if (m[11]) {
      cls = `tok-br-${depth % 3}`;
      depth++;
    } else {
      depth = Math.max(0, depth - 1);
      cls = `tok-br-${depth % 3}`;
    }
    // quoted key: color the string only, the ":" stays plain
    const end = m[3] ? m.index + m[2].length : m.index + m[0].length;
    spans.push({ start: m.index, end, cls });
  }
  return spans;
}

/** Shared display/copy model for source locations shown in the right dock. */
export function frameLocation(frame: Frame, source?: SourceDef): FrameLocation {
  const resolvedPath = resolveFramePath(frame, source);
  const file = resolvedPath.split(/[\\/]/).pop() || resolvedPath;
  const parent = resolvedPath.slice(0, Math.max(0, resolvedPath.length - file.length)).replace(/[\\/]$/, "");
  const position = `${frame.line}${frame.col !== undefined ? `:${frame.col}` : ""}`;
  return {
    file,
    parent,
    position,
    resolvedPath,
    full: `${resolvedPath}:${position}`,
  };
}
