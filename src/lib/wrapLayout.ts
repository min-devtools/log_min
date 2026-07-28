/** Font metrics measured from a real `.log-line.wrapped` probe — see useLogViewport.
 * Deriving these from the ui font size was wrong three ways at once: the row's
 * font is 0.9231rem (not 1rem), its line box is the inherited 1.45 (not 1.55),
 * and the mono advance ratio moves with whatever font the user picked in Settings. */
export interface RowMetrics {
  /** width of one mono character, px */
  charW: number;
  /** one wrapped text line's box height, px */
  lineH: number;
  /** the row's vertical padding, px */
  padY: number;
}

/** `.log-line.wrapped` side padding: 12 left + 64 right, the right side being the
 * fixed slot the out-of-flow copy/JSON buttons sit in. Same on every row by
 * design — see the CSS. Gutters (time / source prefix) come in via availWidth. */
const ROW_PADDING_PX = 76;

/** Fast first-pass estimate; TanStack Virtual replaces it with DOM measurement.
 * Accuracy matters more than it looks: every px of estimate→actual delta becomes
 * a scroll-offset correction the user sees as the view jumping under them. */
export function estimateLogRowHeight(raw: string, availWidth: number, m: RowMetrics): number {
  const usableWidth = Math.max(80, availWidth - ROW_PADDING_PX);
  const charactersPerLine = Math.max(8, Math.floor(usableWidth / m.charW));
  const expandedLength = raw.replace(/\t/g, "    ").length;
  const visualLines = Math.max(1, Math.ceil(expandedLength / charactersPerLine));
  return Math.round(visualLines * m.lineH + m.padY);
}
