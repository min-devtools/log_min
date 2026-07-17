import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboOption {
  value: string;
  hint?: string;
}

interface Props {
  value: string;
  options: ComboOption[];
  placeholder?: string;
  onChange: (value: string) => void;
  id?: string;
  /** commit whatever the user typed on blur instead of reverting to `value` */
  freeText?: boolean;
}

/** Searchable dropdown: type to filter, ↑↓ + Enter, click to pick. */
export function Combobox({ value, options, placeholder, onChange, id, freeText }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [typed, setTyped] = useState(false);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // reflect external value while closed
  useEffect(() => {
    if (!open) setText(value);
  }, [value, open]);

  // on focus: full list; only filter once the user actually types
  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    const all =
      typed && q
        ? options.filter((o) => `${o.value} ${o.hint ?? ""}`.toLowerCase().includes(q))
        : options;
    return all.slice(0, 100);
  }, [options, text, typed]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="combobox" ref={rootRef}>
      <input
        id={id}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        onFocus={(e) => {
          setOpen(true);
          setTyped(false);
          setCursor(0);
          e.target.select();
        }}
        onBlur={() => {
          if (freeText && typed && text.trim() && text !== value) onChange(text.trim());
          setOpen(false);
          setTyped(false);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setTyped(true);
          setOpen(true);
          setCursor(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setCursor((c) => Math.min(filtered.length - 1, c + 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          }
          if (e.key === "Enter" && open && filtered[cursor]) {
            e.preventDefault();
            pick(filtered[cursor].value);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setText(value);
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="combobox-list" ref={listRef}>
          {filtered.length === 0 && <div className="combobox-empty">no matching fields</div>}
          {filtered.map((o, i) => (
            <div
              key={o.value}
              data-idx={i}
              className={`combobox-item ${i === cursor ? "active" : ""} ${o.value === value ? "selected" : ""}`}
              // mousedown fires before input blur — keeps the click working
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
              onMouseEnter={() => setCursor(i)}
            >
              <span className="combobox-value">{o.value}</span>
              {o.hint && <span className="combobox-hint">{o.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
