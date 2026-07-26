import { useCallback, useState } from "react";
import type { LogModel } from "../../lib/logModel";
import type { LogLine } from "../../lib/types";

export interface LogSelection<A> {
  /** last plain click, base for shift-ranges */
  anchor: A;
  /** picked addresses by model.key */
  picks: Map<string, A>;
}

/**
 * Line selection for a log view: plain click selects and routes the dock,
 * shift-click extends a copy range (no dock re-route), ⌘click toggles single
 * lines. Range/order policy is delegated to the model (seq range for a ring,
 * view order for the merged stream).
 */
export function useLogSelection<A>(
  model: LogModel<A>,
  publish: (line: LogLine | null, addr: A | null) => void,
) {
  const [selection, setSelection] = useState<LogSelection<A> | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
    publish(null, null);
  }, [publish]);

  const selectSingle = useCallback(
    (l: LogLine, addr: A) => {
      setSelection({ anchor: addr, picks: new Map([[model.key(addr), addr]]) });
      publish(l, addr);
    },
    [model, publish],
  );

  const onRowClick = useCallback(
    (l: LogLine, addr: A, e: React.MouseEvent) => {
      // dragging to select text also fires click on mouseup — keep the selection
      if (window.getSelection()?.toString()) return;
      const key = model.key(addr);
      if (e.shiftKey && selection) {
        // extending a copy range must not re-route the dock
        const picks = new Map(model.expandRange(selection.anchor, addr).map((a) => [model.key(a), a] as const));
        setSelection({ anchor: selection.anchor, picks });
      } else if ((e.metaKey || e.ctrlKey) && selection) {
        // ⌘click toggles a line in/out without touching the rest — and without re-routing
        const picks = new Map(selection.picks);
        if (picks.has(key)) picks.delete(key);
        else picks.set(key, addr);
        setSelection(picks.size ? { anchor: addr, picks } : null);
        if (!picks.size) publish(null, null);
      } else {
        const deselect = selection?.picks.size === 1 && selection.picks.has(key);
        if (deselect) {
          setSelection(null);
          publish(null, null);
        } else {
          selectSingle(l, addr);
        }
      }
    },
    [model, selection, publish, selectSingle],
  );

  /** picked lines in buffer order — evicted picks are skipped */
  const collectSelected = useCallback((): { line: LogLine; addr: A }[] => {
    if (!selection?.picks.size) return [];
    const sorted = model.sortAddrs([...selection.picks.values()]);
    const out: { line: LogLine; addr: A }[] = [];
    for (const addr of sorted) {
      const line = model.lineOf(addr);
      if (line) out.push({ line, addr });
    }
    return out;
  }, [model, selection]);

  return {
    selection,
    selectedCount: selection?.picks.size ?? 0,
    picks: selection?.picks ?? null,
    onRowClick,
    selectSingle,
    clearSelection,
    collectSelected,
  };
}
