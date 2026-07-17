import { useMemo } from "react";
import { highlightJson } from "../lib/format";

interface Props {
  value: unknown;
  className?: string;
}

/** Pre-rendered, syntax-highlighted JSON block (classes come from the design CSS). */
export function JsonView({ value, className = "json-tree" }: Props) {
  const html = useMemo(() => {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return highlightJson(text ?? "");
  }, [value]);
  return <pre className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
