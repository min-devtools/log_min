import { useEffect } from "react";
import { motion } from "motion/react";
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
    <motion.div
      key="color-picker-backdrop"
      className="modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        key="color-picker-content"
        className="prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Collection color"
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
      >
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
      </motion.div>
    </motion.div>
  );
}
