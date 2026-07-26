import { useId } from "react";
import { motion } from "motion/react";
import type { IconName } from "./Icon";
import { Icon } from "./Icon";

export interface MiniTab {
  id: string;
  label: string;
  icon?: IconName;
  title?: string;
}

export function MiniTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: MiniTab[];
  active: string;
  onChange: (id: string) => void;
}) {
  // layoutId is app-global — namespace it so two mounted MiniTabs never fight
  const ns = useId();
  return (
    <div className="mini-tabs">
      {tabs.map((t) => (
        <motion.button
          key={t.id}
          type="button"
          whileTap={{ scale: 0.96 }}
          className={`${t.id === active ? "active" : ""}`}
          title={t.title ?? t.label}
          aria-label={t.label}
          onClick={() => onChange(t.id)}
        >
          {t.id === active && (
            // the active surface glides between tabs (FLIP, transform-only)
            <motion.span
              className="mini-tab-pill"
              layoutId={`mini-tab-pill-${ns}`}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
          {t.icon && <Icon name={t.icon} size={13} />}
          <span className="mini-tab-label">{t.label}</span>
        </motion.button>
      ))}
    </div>
  );
}
