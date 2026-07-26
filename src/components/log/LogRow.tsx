import { memo, type CSSProperties, type ReactNode } from "react";
import { lineMatches, lineTokens, renderSpans, searchMarks } from "../../lib/highlight";
import { rawLogText } from "../../lib/logPresentation";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import type { LogLine } from "../../lib/types";

export const COLLAPSE_LEN = 1200;
const PREVIEW_LEN = 200;

export const isJsonLike = (raw: string) => /^\s*[\[{]/.test(raw);
const previewText = (raw: string) => raw.slice(0, Math.min(raw.length, PREVIEW_LEN)) + "…";

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US").replace(/,/g, " ");
}

/** ms epoch → HH:MM:SS for the toggleable receive-time gutter */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** row height in px, derived from the app font size (mono line + padding) */
export function useRowHeight(): number {
  const uiFontSize = useApp((s) => s.uiFontSize);
  return Math.round(uiFontSize * 1.55);
}

/** token spans survive row unmount/remount — the virtual window churns rows on
 * every scroll reversal and follow-mode batch, and re-running the regex
 * tokenizer on remount was pure waste. Keyed by the immutable ring line object;
 * the string key covers every input that changes the rendered spans. */
const spanCache = new WeakMap<LogLine, { key: string; content: ReactNode }>();

export interface LogRowProps {
  line: LogLine;
  /** view-specific line address (seq | MergedRef), threaded back to callbacks.
   * Typed unknown so the memoized component stays non-generic; views cast. */
  addr: unknown;
  idx: number;
  wrap: boolean;
  /** wrap: translateY offset · non-wrap: absolute top, both px */
  start: number;
  rowH: number;
  syntax: boolean;
  selected: boolean;
  current: boolean;
  flash: boolean;
  collapsed: boolean;
  qRaw: string;
  caseSensitive: boolean;
  regexMode: boolean;
  /** receive-time gutter text; undefined hides the column (primitive → memo-safe) */
  time?: string;
  /** combined view's source-name gutter (primitives → memo-safe) */
  prefixText?: string;
  prefixColorVar?: string;
  prefixWidthCh?: number;
  measure?: (node: HTMLDivElement | null) => void;
  onRowClick: (l: LogLine, addr: unknown, e: React.MouseEvent) => void;
  onToggleExpand: (l: LogLine, addr: unknown) => void;
  onInspect: (l: LogLine, addr: unknown) => void;
  onCopyRaw: (raw: string) => void;
  /** must be identity-stable — cached spans capture a wrapper around it */
  openLoc?: (loc: string, line: LogLine, addr: unknown) => void;
}

/** memoized row: batches land at 30Hz and every scroll tick re-renders the view —
 * unchanged rows must skip both the re-render and the regex tokenize pass */
export const LogRow = memo(function LogRow({
  line,
  addr,
  idx,
  wrap,
  start,
  rowH,
  syntax,
  selected,
  current,
  flash,
  collapsed,
  qRaw,
  caseSensitive,
  regexMode,
  time,
  prefixText,
  prefixColorVar,
  prefixWidthCh,
  measure,
  onRowClick,
  onToggleExpand,
  onInspect,
  onCopyRaw,
  openLoc,
}: LogRowProps) {
  const displayText = collapsed ? previewText(line.raw) : line.raw;
  const isMatch = qRaw ? lineMatches(line.raw, qRaw, caseSensitive, regexMode) : false;
  // token spans + search <mark>s — the expensive part; cached in spanCache so the
  // work survives remounts (openLoc is ref-stable, so it can stay out of the key)
  const cacheKey = `${collapsed ? "c" : "f"}|${syntax ? 1 : 0}|${caseSensitive ? 1 : 0}|${regexMode ? 1 : 0}|${isMatch ? qRaw : ""}`;
  const cached = spanCache.get(line);
  let content: ReactNode;
  if (cached && cached.key === cacheKey) {
    content = cached.content;
  } else {
    const text = rawLogText(displayText);
    content = renderSpans(
      text,
      lineTokens(text, line.ansi, syntax),
      isMatch ? searchMarks(text, qRaw, caseSensitive, regexMode) : [],
      // the wrapper is created once at cache-fill and captures THIS immutable
      // line — correct forever as long as openLoc itself stays ref-stable
      openLoc ? (loc: string) => openLoc(loc, line, addr) : undefined,
    );
    spanCache.set(line, { key: cacheKey, content });
  }
  const style: CSSProperties = wrap
    ? { transform: `translateY(${start}px)`, minHeight: rowH }
    : { top: start, height: rowH };
  return (
    <div
      ref={measure}
      data-index={measure ? idx : undefined}
      className={[
        "log-line",
        wrap ? "wrapped" : "",
        line.level ? `lv-${line.level}` : "",
        selected ? "selected" : "",
        isMatch ? "match" : "",
        isMatch && current ? "current" : "",
        flash ? "flash" : "",
        collapsed ? "collapsed" : "",
      ].filter(Boolean).join(" ")}
      style={style}
      onClick={(e) => onRowClick(line, addr, e)}
    >
      {time !== undefined && <span className="log-time">{time}</span>}
      {prefixText !== undefined && (
        <span
          className="combined-prefix"
          title={prefixText}
          style={{ color: prefixColorVar, width: prefixWidthCh ? `${prefixWidthCh}ch` : undefined }}
        >
          {prefixText}
        </span>
      )}
      {collapsed ? (
        <span
          className="log-raw collapsed-preview"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(line, addr);
          }}
        >
          {content}
          <span className="collapse-badge">{(line.raw.length / 1024).toFixed(1)} KB JSON</span>
        </span>
      ) : (
        <span className="log-raw">{content}</span>
      )}
      {(line.raw[0] === "{" || line.raw[0] === "[") && (
        <button
          type="button"
          className="log-copy log-json"
          title="Inspect this line's JSON in the dock"
          aria-label="Inspect this line's JSON in the dock"
          onClick={(e) => {
            e.stopPropagation();
            onInspect(line, addr);
          }}
        >
          <Icon name="braces" size={12} />
        </button>
      )}
      <button
        type="button"
        className="log-copy"
        title="Copy complete raw line"
        aria-label="Copy complete raw line"
        onClick={(e) => {
          e.stopPropagation();
          onCopyRaw(line.raw);
        }}
      >
        <Icon name="copy" size={12} />
      </button>
    </div>
  );
});
