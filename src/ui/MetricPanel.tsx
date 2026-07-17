import type { CSSProperties, ReactNode } from "react";

export function Metric({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

export function Panel({ title, children, style }: { title?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="panel" style={style}>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

export function BarLine({ label, percent, value, color }: { label: string; percent: number; value: string; color?: string }) {
  return (
    <div className="health-line">
      <span>{label}</span>
      <div className="bar">
        <span style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color }} />
      </div>
      <span>{value}</span>
    </div>
  );
}
