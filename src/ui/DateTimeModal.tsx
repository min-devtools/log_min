import { useMemo, useState } from "react";
import { ToolButton } from "./ToolButton";
import { Icon } from "./Icon";

const pad = (n: number) => String(n).padStart(2, "0");

/** local "YYYY-MM-DDTHH:mm:ss" — same shape datetime-local produces */
export function toLocalStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const PRESETS: { label: string; minus: number }[] = [
  { label: "now", minus: 0 },
  { label: "−15m", minus: 15 * 60_000 },
  { label: "−1h", minus: 3_600_000 },
  { label: "−24h", minus: 86_400_000 },
];

interface Props {
  value: string;
  onApply: (v: string) => void;
  onClose: () => void;
}

/** Themed calendar + time modal — replaces the native datetime-local editor. */
export function DateTimeModal({ value, onApply, onClose }: Props) {
  const initial = value ? new Date(value) : new Date();
  const base = Number.isNaN(initial.getTime()) ? new Date() : initial;
  const [viewYear, setViewYear] = useState(base.getFullYear());
  const [viewMonth, setViewMonth] = useState(base.getMonth());
  const [selected, setSelected] = useState<{ y: number; m: number; d: number }>({
    y: base.getFullYear(), m: base.getMonth(), d: base.getDate(),
  });
  const [time, setTime] = useState(`${pad(base.getHours())}:${pad(base.getMinutes())}:${pad(base.getSeconds())}`);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first offset
    const start = new Date(viewYear, viewMonth, 1 - lead);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), inMonth: d.getMonth() === viewMonth };
    });
  }, [viewYear, viewMonth]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const apply = () => {
    const [h = "0", mi = "0", s = "0"] = time.split(":");
    const d = new Date(selected.y, selected.m, selected.d, Number(h), Number(mi), Number(s));
    onApply(toLocalStamp(d));
  };

  const now = new Date();
  const isToday = (c: { y: number; m: number; d: number }) =>
    c.y === now.getFullYear() && c.m === now.getMonth() && c.d === now.getDate();
  const isSelected = (c: { y: number; m: number; d: number }) =>
    c.y === selected.y && c.m === selected.m && c.d === selected.d;

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="prompt-dialog" style={{ width: 460, padding: 20, gap: 12 }}>
        <strong>Start time</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ToolButton iconOnly title="Previous month" onClick={() => shiftMonth(-1)}><Icon name="arrow-left" /></ToolButton>
          <span className="dtp-title">{MONTHS[viewMonth]} {viewYear}</span>
          <ToolButton iconOnly title="Next month" onClick={() => shiftMonth(1)}><Icon name="arrow-right" /></ToolButton>
        </div>
        <div className="dtp-grid">
          {WEEKDAYS.map((w) => <span key={w} className="dtp-head">{w}</span>)}
          {cells.map((c, i) => (
            <button
              key={i}
              type="button"
              className={`dtp-day${c.inMonth ? "" : " muted"}${isSelected(c) ? " selected" : ""}${isToday(c) ? " today" : ""}`}
              onClick={() => {
                setSelected({ y: c.y, m: c.m, d: c.d });
                if (!c.inMonth) { setViewYear(c.y); setViewMonth(c.m); }
              }}
            >
              {c.d}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <input
            className="index-search"
            style={{ width: 140, font: "1rem var(--font-mono)" }}
            type="time"
            step={1}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <span style={{ flex: 1 }} />
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="path-chip"
              title={p.minus ? `Jump to ${p.label} ago and apply` : "Jump to now and apply"}
              onClick={() => onApply(toLocalStamp(new Date(Date.now() - p.minus)))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="prompt-dialog-foot">
          <ToolButton onClick={onClose}>Cancel</ToolButton>
          <ToolButton variant="primary" onClick={apply}><Icon name="check" /> Apply</ToolButton>
        </div>
      </div>
    </div>
  );
}
