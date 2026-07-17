import type { ReactNode } from "react";

export function HealthPill({ health }: { health: "green" | "yellow" | "red" | "orange" }) {
  const dotClass = health === "yellow" || health === "orange" ? "hot" : health === "red" ? "red" : "";
  return (
    <span className={`health-pill ${health}`}>
      <span className={`index-dot ${dotClass}`} />
      {health}
    </span>
  );
}

export function TypePill({ children }: { children: ReactNode }) {
  return <span className="type-pill">{children}</span>;
}

export function FieldChip({ children }: { children: ReactNode }) {
  return <span className="field-chip">{children}</span>;
}

export function IndexDot({ health }: { health: "green" | "yellow" | "red" }) {
  return <span className={`index-dot ${health === "yellow" ? "hot" : health === "red" ? "red" : ""}`} />;
}
