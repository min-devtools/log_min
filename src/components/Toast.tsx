import { motion, AnimatePresence } from "motion/react";
import { StatusDot } from "../ui/StatusDot";
import { useApp } from "../store";

export function Toast() {
  const toast = useApp((s) => s.toast);
  const clearToast = useApp((s) => s.clearToast);
  const tone = toast?.kind === "err" ? "red" : toast?.kind === "warn" ? "orange" : "green";

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key="toast-popup"
          className="toast"
          role="status"
          title="Click to dismiss"
          onClick={clearToast}
          style={{ cursor: "pointer" }}
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
        >
          <StatusDot tone={tone} />
          <div>
            <strong>{toast.title}</strong>
            <div className="toast-body">{toast.body}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
