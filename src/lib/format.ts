export function escapeHtml(text: string): string {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Syntax-highlight a JSON string into HTML spans (classes match the design CSS). */
export function highlightJson(json: string): string {
  return escapeHtml(json).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|[{}\[\],]/gi,
    (match, quoted, colon, bool) => {
      if (quoted && colon) return `<span class="syntax-key">${quoted}</span><span class="syntax-colon">${colon}</span>`;
      if (quoted) return `<span class="syntax-string">${quoted}</span>`;
      if (bool) return `<span class="syntax-bool">${match}</span>`;
      if (match === "null") return `<span class="syntax-null">${match}</span>`;
      if (/^-?\d/.test(match)) return `<span class="syntax-number">${match}</span>`;
      return `<span class="syntax-punc">${match}</span>`;
    },
  );
}

export function getPath(source: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce<any>((value, key) => (value == null ? undefined : value[key]), source);
}

export function formatValue(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function valueClass(path: string, value: unknown): string {
  if (path.includes("email")) return "email";
  if (path.includes("total") || path.includes("price") || path.includes("amount")) return "money";
  if (path.includes("state") || path.includes("status")) return "state";
  if (path.includes("sku")) return "sku";
  if (typeof value === "number") return "number";
  return "keyword";
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log2(bytes) / 10));
  return `${(bytes / 2 ** (10 * i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDocCount(count: number): string {
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}b`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}m`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}k`;
  return String(count);
}

/** Coerce a form string into a typed JSON value (bool/number/string). */
export function typedValue(raw: string): string | number | boolean {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Naive line diff: marks lines only present on one side. */
export function diffLines(before: string, after: string): { left: string; right: string } {
  const a = before.split("\n");
  const b = after.split("\n");
  const aSet = new Set(a);
  const bSet = new Set(b);
  const left = a
    .map((l) => (bSet.has(l) ? escapeHtml(l) : `<span class="removed">${escapeHtml(l)}</span>`))
    .join("\n");
  const right = b
    .map((l) => (aSet.has(l) ? escapeHtml(l) : `<span class="added">${escapeHtml(l)}</span>`))
    .join("\n");
  return { left, right };
}
