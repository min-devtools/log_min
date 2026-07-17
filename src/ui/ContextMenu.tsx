import { useEffect, useRef } from "react";
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
  }, [x, y]);

  return (
    <div ref={ref} className="index-context-menu" style={{ left: x, top: y }}>
      {items.map((item) => (
        <div
          key={item.label}
          className="context-item"
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          <Icon name={item.icon} size={15} />
          {item.strong ? <strong>{item.label}</strong> : <span>{item.label}</span>}
          {item.kbd ? <span className="kbd">{item.kbd}</span> : <span />}
        </div>
      ))}
    </div>
  );
}
