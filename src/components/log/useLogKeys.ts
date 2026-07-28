import { useEffect } from "react";
import type { LogModel } from "../../lib/logModel";
import type { LogLine } from "../../lib/types";

export interface LogKeysOpts<A> {
  active: boolean;
  /** the Errors dock owns ⌘F for its own in-dock search while it's visible */
  yieldSearchToDock: boolean;
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  hasSelection: boolean;
  clearSelection: () => void;
  copySelection: () => void;
  /** literal Ctrl+L (terminal-style); omit to disable the shortcut */
  clearBuffer?: () => void;
  model: LogModel<A>;
  /** current selection anchor's view index, or -1 */
  anchorViewIndex: () => number;
  /** set selection + publish to the dock */
  selectAt: (line: LogLine, addr: A) => void;
  /** center + flash (F8 stepping) */
  jumpToIndex: (i: number) => void;
  /** minimal scroll (↑/↓ walking) */
  ensureIndexVisible: (i: number) => void;
  pauseFollow: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return (
    element.matches("input, textarea, select") ||
    element.isContentEditable ||
    Boolean(element.closest('[contenteditable="true"]'))
  );
}

/** shared keyboard layer: ⌘F, ⌘C, Ctrl+L, Esc, F8/⇧F8 error stepping, ↑/↓ walk */
export function useLogKeys<A>({
  active,
  yieldSearchToDock,
  searchOpen,
  openSearch,
  closeSearch,
  hasSelection,
  clearSelection,
  copySelection,
  clearBuffer,
  model,
  anchorViewIndex,
  selectAt,
  jumpToIndex,
  ensureIndexVisible,
  pauseFollow,
}: LogKeysOpts<A>): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inInput = isEditableTarget(e.target);
      if (inInput) return;
      const viewLen = model.length;
      if (mod && e.key.toLowerCase() === "f" && !yieldSearchToDock) {
        e.preventDefault();
        openSearch();
      }
      // highlighted text wins over line picks — let the native copy handle it
      if (mod && e.key.toLowerCase() === "c" && hasSelection && !inInput && !window.getSelection()?.toString()) {
        e.preventDefault();
        copySelection();
      }
      // literal Ctrl+L (not ⌘L) clears the buffer, terminal-style; errors are kept
      if (clearBuffer && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "l" && !inInput) {
        e.preventDefault();
        clearBuffer();
      }
      if (e.key === "Escape" && !inInput) {
        if (searchOpen) closeSearch();
        else if (hasSelection) clearSelection();
      }
      // F8 / ⇧F8 step to the next/previous error line (err level or trace head)
      if (!inInput && e.key === "F8" && viewLen > 0) {
        e.preventDefault();
        const dir: 1 | -1 = e.shiftKey ? -1 : 1;
        const cur = anchorViewIndex();
        let i = cur < 0 ? (dir === 1 ? 0 : viewLen - 1) : cur + dir;
        for (; i >= 0 && i < viewLen; i += dir) {
          const line = model.at(i);
          if (line && (line.level === "err" || line.traceStart)) {
            const addr = model.addrAt(i);
            if (addr !== undefined) {
              selectAt(line, addr);
              jumpToIndex(i);
            }
            break;
          }
        }
      }
      // ↑/↓ walk the (possibly filtered) view; the dock follows the selection
      if (!inInput && !mod && !e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && viewLen > 0) {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const cur = anchorViewIndex();
        const i = cur < 0 ? (dir === 1 ? 0 : viewLen - 1) : Math.max(0, Math.min(viewLen - 1, cur + dir));
        const line = model.at(i);
        const addr = model.addrAt(i);
        if (!line || addr === undefined) return;
        pauseFollow();
        selectAt(line, addr);
        ensureIndexVisible(i);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    active,
    yieldSearchToDock,
    searchOpen,
    openSearch,
    closeSearch,
    hasSelection,
    clearSelection,
    copySelection,
    clearBuffer,
    model,
    anchorViewIndex,
    selectAt,
    jumpToIndex,
    ensureIndexVisible,
    pauseFollow,
  ]);
}
