import type { ReactNode } from "react";

export function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <code>{children}</code>
    </div>
  );
}
