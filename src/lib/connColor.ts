import type { CSSProperties } from "react";

/**
 * The assignable connection colors. Values are token *names*, not hex — the actual color
 * lives in design-systems/tokens.css as `--conn-<name>`, so re-tuning the palette never has
 * to touch stored connection data. Order here is the swatch order in the picker: eight, so
 * the grid plus its "none" cell is a square 3×3.
 */
export const CONN_COLORS = [
  "red", "orange", "amber",
  "green", "blue", "purple",
  "pink", "slate",
] as const;

export type ConnColor = (typeof CONN_COLORS)[number];

export const isConnColor = (v: unknown): v is ConnColor => CONN_COLORS.includes(v as ConnColor);

/**
 * Inline style feeding `--conn` to `.tab` / `.conn-dot` / `.conn-swatch` / `.color-swatch`.
 * No color → no `--conn` at all, so every `var(--conn, …)` fallback applies and the tab looks
 * exactly as it did before colors existed. Guarded rather than trusting the type: a color
 * dropped from the palette can still be sitting in a persisted store, and emitting
 * `var(--conn-teal)` for a token that no longer exists would poison the whole declaration.
 */
export function connStyle(color?: ConnColor | null): CSSProperties | undefined {
  return isConnColor(color) ? ({ "--conn": `var(--conn-${color})` } as CSSProperties) : undefined;
}
