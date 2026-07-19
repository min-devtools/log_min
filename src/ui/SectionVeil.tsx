/** Canonical section loading state (design-system .section-veil).
 *  Parent must be `position: relative`. */
export function SectionVeil({ on, label = "Loading…" }: { on: boolean; label?: string }) {
  return (
    <div className={`section-veil${on ? " on" : ""}`} aria-hidden={!on}>
      <span className="veil-spinner" />
      <span>{label}</span>
    </div>
  );
}
