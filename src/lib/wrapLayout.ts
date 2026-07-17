/** Fast first-pass estimate; TanStack Virtual replaces it with DOM measurement. */
export function estimateLogRowHeight(raw: string, viewportWidth: number, fontSize: number): number {
  const rowHeight = Math.round(fontSize * 1.55);
  const usableWidth = Math.max(80, viewportWidth - 180);
  const monoCharacterWidth = Math.max(5, fontSize * 0.62);
  const charactersPerLine = Math.max(8, Math.floor(usableWidth / monoCharacterWidth));
  const expandedLength = raw.replace(/\t/g, "    ").length;
  const visualLines = Math.max(1, Math.ceil(expandedLength / charactersPerLine));
  return visualLines === 1 ? rowHeight : visualLines * rowHeight + 8;
}
