import { useEffect } from "react";
import { CONN_COLORS, connStyle, type ConnColor } from "../lib/connColor";

/** Modal grid of the eight collection colors. Picking one selects and closes in a single click. */
export function ColorPicker({
  value,
  onPick,
  onClose,
}: {
  value?: ConnColor | null;
  onPick: (color: ConnColor | null) => void;
  onClose: () => void;
}) {
  // capture phase so the picker eats Esc before app-level global shortcuts see it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const pick = (color: ConnColor | null) => {
    onPick(color);
    onClose();
  };

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="prompt-dialog" role="dialog" aria-modal="true" aria-label="Collection color">
        <strong>Collection color</strong>
        <p className="prompt-dialog-msg">Shows as the dot on every tab using this collection.</p>
        <div className="color-grid">
          {CONN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${value === c ? "selected" : ""}`}
              style={connStyle(c)}
              title={c}
              aria-label={c}
              onClick={() => pick(c)}
            />
          ))}
          <button
            type="button"
            className={`color-swatch none ${value ? "" : "selected"}`}
            title="No color"
            onClick={() => pick(null)}
          >
            none
          </button>
        </div>
      </div>
    </div>
  );
}
