/** Unified loading line (design-system). Parent must be positioned.
 *  No `value` → indeterminate slide; `value` (0..1) → determinate width. */
export function LoadingBar({
  active,
  value,
  bottom,
}: {
  active: boolean;
  value?: number;
  bottom?: boolean;
}) {
  const determinate = typeof value === "number";
  return (
    <div
      className={`loading-bar${active ? " on" : ""}${determinate ? " determinate" : ""}${bottom ? " bottom" : ""}`}
      style={determinate ? ({ "--progress": Math.min(1, Math.max(0, value)) } as React.CSSProperties) : undefined}
      aria-hidden
    >
      <span />
    </div>
  );
}
