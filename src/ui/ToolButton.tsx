import { forwardRef, type ButtonHTMLAttributes } from "react";
import { motion } from "motion/react";

/**
 * These HTML handlers collide with Motion's gesture props of the same name (different
 * signatures). Dropping them keeps the spread below type-safe instead of cast-silenced —
 * no caller uses them today, and one that tried would get Motion's pan events, not the
 * DOM's. Reach for a plain <button> if you need native drag.
 */
type MotionConflicting = "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, MotionConflicting> {
  variant?: "default" | "primary" | "danger";
  iconOnly?: boolean;
}

export const ToolButton = forwardRef<HTMLButtonElement, Props>(function ToolButton(
  { variant = "default", iconOnly = false, className = "", disabled, ...rest },
  ref,
) {
  const cls = ["tool-btn", variant !== "default" ? variant : "", iconOnly ? "icon-only" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <motion.button
      ref={ref}
      type="button"
      className={cls}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      {...rest}
    />
  );
});
