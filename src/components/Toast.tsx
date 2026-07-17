import { StatusDot } from "../ui/StatusDot";
import { useApp } from "../store";

export function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  const tone = toast.kind === "err" ? "red" : toast.kind === "warn" ? "orange" : "green";
  return (
    <div className="toast">
      <StatusDot tone={tone} />
      <div>
        <strong>{toast.title}</strong>
        <div className="toast-body">{toast.body}</div>
      </div>
    </div>
  );
}
