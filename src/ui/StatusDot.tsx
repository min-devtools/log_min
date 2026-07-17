export type DotTone = "green" | "orange" | "red" | "idle";

export function StatusDot({ tone = "green" }: { tone?: DotTone }) {
  return <span className={`status-dot${tone === "green" ? "" : ` ${tone}`}`} />;
}
