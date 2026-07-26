import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ToolButton } from "../ui/ToolButton";
import { useApp } from "../store";

/** In-app replacement for window.prompt/confirm — those don't render in the Tauri webview. */
export function Dialog() {
  const dialog = useApp((s) => s.dialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog?.kind === "prompt") {
      setValue(dialog.defaultValue ?? "");
      requestAnimationFrame(() => inputRef.current?.select());
    }
    if (dialog?.kind === "confirm") {
      requestAnimationFrame(() => confirmRef.current?.focus());
    }
  }, [dialog]);

  // Enter confirms, Esc cancels — capture phase so an open dialog swallows the key
  // before app-level global shortcuts (⌘⌫ delete, Esc closes palette/search) see it.
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") dialog.resolve(null);
      else if (dialog.kind !== "prompt") dialog.resolve("1");
      else if (value.trim()) dialog.resolve(value);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [dialog, value]);

  const cancel = () => dialog?.resolve(null);
  const submit = () => {
    if (!dialog) return;
    if (dialog.kind === "prompt" && !value.trim()) return;
    dialog.resolve(dialog.kind === "prompt" ? value : "1");
  };

  return (
    <AnimatePresence>
      {dialog && (
        <motion.div
          key="dialog-backdrop"
          className="modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
        >
          <motion.div
            key="dialog-content"
            className="prompt-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            <strong>{dialog.title}</strong>
            {dialog.message && <p className="prompt-dialog-msg">{dialog.message}</p>}
            {dialog.kind === "prompt" && (
              <input
                ref={inputRef}
                className="side-search"
                style={{ width: "100%" }}
                value={value}
                spellCheck={false}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
            <div className="prompt-dialog-foot">
              <ToolButton onClick={cancel}>Cancel</ToolButton>
              <ToolButton
                ref={confirmRef}
                variant={dialog.danger ? "danger" : "primary"}
                disabled={dialog.kind === "prompt" && !value.trim()}
                onClick={submit}
              >
                {dialog.confirmLabel ?? (dialog.kind === "prompt" ? "Save" : "Confirm")}
              </ToolButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
