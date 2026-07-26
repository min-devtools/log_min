import { useEffect } from "react";
import { useApp } from "../store";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function restoreLayoutSizes() {
  const left = Number(localStorage.getItem("logmin:left-w"));
  const right = Number(localStorage.getItem("logmin:right-w"));
  const queryTop = Number(localStorage.getItem("logmin:query-top"));
  if (left) document.body.style.setProperty("--left-w", `${Math.max(left, 298)}px`);
  if (right) document.body.style.setProperty("--right-w", `${Math.max(right, 406)}px`);
  if (queryTop) document.body.style.setProperty("--query-top", `${queryTop}px`);
}

export function startResize(
  event: React.PointerEvent,
  axis: "left" | "right" | "query",
) {
  event.preventDefault();
  const main = document.querySelector(".main");
  const query = document.querySelector(".query-view.active");
  const vertical = axis === "query";
  document.body.classList.add(vertical ? "resizing-y" : "resizing");
  const targetEl = event.currentTarget as HTMLElement;
  targetEl.setPointerCapture?.(event.pointerId);
  // delta-based: anchor to the pane's actual rendered height + pointer movement, so a
  // click with no drag doesn't snap --query-top to the pointer's absolute position
  const startY = event.clientY;
  const topPane = query?.firstElementChild as HTMLElement | undefined;
  const startTop = topPane ? topPane.getBoundingClientRect().height : 0;

  const stop = () => {
    document.body.classList.remove("resizing", "resizing-y", "resizing-x");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    try {
      targetEl.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore if pointer capture release fails
    }
  };

  const doCollapse = () => {
    stop();
    if (axis === "left") {
      useApp.setState({ leftCollapsed: true });
    } else if (axis === "right") {
      useApp.setState({ rightCollapsed: true });
    }
  };

  const move = (e: PointerEvent) => {
    if (axis === "left" && main) {
      const rect = main.getBoundingClientRect();
      const max = Math.min(430, rect.width - 760);
      const raw = e.clientX - rect.left;
      const next = clamp(raw, 298, max);
      document.body.style.setProperty("--left-w", `${Math.round(next)}px`);
      localStorage.setItem("logmin:left-w", String(Math.round(next)));

      const overshoot = 298 - raw;
      if (overshoot >= 150) {
        doCollapse();
        return;
      }
    }
    if (axis === "right" && main) {
      const rect = main.getBoundingClientRect();
      const max = Math.min(700, rect.width - 760);
      const raw = rect.right - e.clientX;
      const next = clamp(raw, 406, max);
      document.body.style.setProperty("--right-w", `${Math.round(next)}px`);
      localStorage.setItem("logmin:right-w", String(Math.round(next)));

      const overshoot = 406 - raw;
      if (overshoot >= 150) {
        doCollapse();
        return;
      }
    }
    if (axis === "query" && query && topPane) {
      const rect = query.getBoundingClientRect();
      const max = Math.max(300, rect.height - 190);
      const next = clamp(startTop + (e.clientY - startY), 240, max);
      document.body.style.setProperty("--query-top", `${Math.round(next)}px`);
      localStorage.setItem("logmin:query-top", String(Math.round(next)));
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
  window.addEventListener("pointercancel", stop, { once: true });
}

export function PanelResizeHandles() {
  useEffect(() => {
    restoreLayoutSizes();
  }, []);
  return (
    <>
      <div
        className="resize-handle vertical left"
        title="Resize left sidebar"
        aria-label="Resize left sidebar"
        onPointerDown={(e) => startResize(e, "left")}
      />
      <div
        className="resize-handle vertical right"
        title="Resize right inspector"
        aria-label="Resize right inspector"
        onPointerDown={(e) => startResize(e, "right")}
      />
    </>
  );
}
