import type { ReactNode } from "react";
import { tokenizeLogLine, type TokenSpan } from "./logPresentation";

/**
 * The one token formula both the live view and trace snippets share:
 * guessed tokens win (they carry clickable tok-path spans), ANSI colors only
 * lines the tokenizer has nothing for, the Syntax toggle kills both.
 */
export function lineTokens(raw: string, ansi: TokenSpan[] | undefined, syntax: boolean): TokenSpan[] {
  if (!syntax) return [];
  const guessed = tokenizeLogLine(raw);
  return guessed.length ? guessed : ansi ?? [];
}

/** [start,end) of every case-insensitive occurrence of `q` — sorted, non-overlapping, capped */
export function findMarks(text: string, q: string): [number, number][] {
  if (!q) return [];
  const hay = text.toLowerCase();
  const query = q.toLowerCase();
  const out: [number, number][] = [];
  for (let i = hay.indexOf(query); i >= 0 && out.length < 400; i = hay.indexOf(query, i + query.length)) {
    out.push([i, i + query.length]);
  }
  return out;
}

/**
 * syntax token spans + search <mark>s in one walk — shared by LogView and trace
 * snippets. With onPathClick, `tok-path` tokens become click-to-open links.
 */
export function renderSpans(
  text: string,
  tokens: TokenSpan[],
  marks: [number, number][],
  onPathClick?: (loc: string) => void,
): ReactNode {
  if (!tokens.length && !marks.length) return text;
  const nodes: ReactNode[] = [];
  let key = 0;
  const pushPiece = (from: number, to: number, cls?: string, loc?: string) => {
    const wrap = (piece: string) =>
      loc && onPathClick ? (
        <span
          key={key++}
          className={`${cls} tok-link`}
          title={`Double-click to open ${loc}`}
          // single click stays line-selection; only a double click opens the file
          onDoubleClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onPathClick(loc);
          }}
        >
          {piece}
        </span>
      ) : cls ? (
        <span key={key++} className={cls}>{piece}</span>
      ) : (
        piece
      );
    let cur = from;
    for (const [ms, me] of marks) {
      if (me <= cur || ms >= to) continue;
      const s = Math.max(ms, cur);
      const e = Math.min(me, to);
      if (s > cur) nodes.push(wrap(text.slice(cur, s)));
      nodes.push(<mark key={key++}>{text.slice(s, e)}</mark>);
      cur = e;
    }
    if (cur < to) nodes.push(wrap(text.slice(cur, to)));
  };
  let pos = 0;
  for (const t of tokens) {
    pushPiece(pos, t.start);
    pushPiece(t.start, t.end, t.cls, t.cls === "tok-path" ? text.slice(t.start, t.end) : undefined);
    pos = t.end;
  }
  pushPiece(pos, text.length);
  return nodes;
}

/** wraps every case-insensitive occurrence of `q` in `text` with <mark> */
export function highlightText(text: string, q: string): ReactNode {
  return renderSpans(text, [], findMarks(text, q));
}

/** total case-insensitive occurrences of `q` across `texts` — cheap count, no DOM */
export function countMatches(texts: string[], q: string): number {
  if (!q) return 0;
  const query = q.toLowerCase();
  let n = 0;
  for (const text of texts) {
    const hay = text.toLowerCase();
    for (let i = hay.indexOf(query); i >= 0; i = hay.indexOf(query, i + query.length)) n++;
  }
  return n;
}
