import { useEffect, useRef, useState } from "react";
import { ToolButton } from "../ui/ToolButton";
import { useApp } from "../store";

/** In-app replacement for window.prompt/confirm — those don't render in the Tauri webview. */
export function Dialog() {
  const dialog = useApp((s) => s.dialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog?.kind === "prompt") {
      setValue(dialog.defaultValue ?? "");
      requestAnimationFrame(() => inputRef.current?.select());
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

  if (!dialog) return null;

  const cancel = () => dialog.resolve(null);
  const submit = () => {
    if (dialog.kind === "prompt" && !value.trim()) return;
    dialog.resolve(dialog.kind === "prompt" ? value : "1");
  };

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="prompt-dialog" role="dialog" aria-modal="true" aria-label={dialog.title}>
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
            autoFocus={dialog.kind === "confirm"}
            variant={dialog.danger ? "danger" : "primary"}
            disabled={dialog.kind === "prompt" && !value.trim()}
            onClick={submit}
          >
            {dialog.confirmLabel ?? (dialog.kind === "prompt" ? "Save" : "Confirm")}
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
