import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Icon, type IconName } from "./Icon";

export interface ContextMenuItem {
  icon: IconName;
  label: string;
  strong?: boolean;
  /** shortcut hint rendered right-aligned (e.g. "⌘D") */
  kbd?: string;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const focusItem = (index: number) => {
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!buttons?.length) return;
    buttons[(index + buttons.length) % buttons.length].focus();
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // clamp to viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 12}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 12}px`;
    requestAnimationFrame(() => focusItem(0));
  }, [x, y]);

  return (
    <motion.div
      ref={ref}
      role="menu"
      className="index-context-menu"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.93, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.93 }}
      transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
    >
      {items.map((item) => (
        <button
          type="button"
          role="menuitem"
          key={item.label}
          className="context-item"
          onClick={() => {
            item.onClick();
            onClose();
          }}
          onKeyDown={(event) => {
            const index = items.indexOf(item);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusItem(index + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              focusItem(index - 1);
            } else if (event.key === "Home") {
              event.preventDefault();
              focusItem(0);
            } else if (event.key === "End") {
              event.preventDefault();
              focusItem(items.length - 1);
            }
          }}
        >
          <Icon name={item.icon} size={15} />
          {item.strong ? <strong>{item.label}</strong> : <span>{item.label}</span>}
          {item.kbd ? <span className="kbd">{item.kbd}</span> : <span />}
        </button>
      ))}
    </motion.div>
  );
}
