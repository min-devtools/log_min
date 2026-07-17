import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger";
  iconOnly?: boolean;
}

export function ToolButton({ variant = "default", iconOnly = false, className = "", ...rest }: Props) {
  const cls = ["tool-btn", variant !== "default" ? variant : "", iconOnly ? "icon-only" : "", className]
    .filter(Boolean)
    .join(" ");
  return <button type="button" className={cls} {...rest} />;
}
