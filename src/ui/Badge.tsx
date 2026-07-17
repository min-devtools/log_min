import type { CSSProperties, ReactNode } from "react";

export type BadgeTone = "green" | "yellow" | "red" | "idle";

export function Badge({ children, style, tone }: { children: ReactNode; style?: CSSProperties; tone?: BadgeTone }) {
  return <span className={`badge${tone ? ` ${tone}` : ""}`} style={style}>{children}</span>;
}
