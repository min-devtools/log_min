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
          {t.icon && <Icon name={t.icon} size={13} />}
          {t.label}
        </motion.button>
      ))}
    </div>
  );
}
