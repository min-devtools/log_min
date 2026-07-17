/** Find the first parseable JSON object/array embedded in a log line.
 * Lines are often prefixes + JSON + suffixes (log4j wire logs, pino, …),
 * and the leading fragment may be truncated — so try each opener in turn. */
export function extractJson(text: string, maxTries = 20): { value: unknown; start: number; end: number } | null {
  let tries = 0;
  for (let i = 0; i < text.length && tries < maxTries; i++) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    tries++;
    const end = scanBalanced(text, i);
    if (end < 0) continue;
    try {
      return { value: JSON.parse(text.slice(i, end + 1)), start: i, end: end + 1 };
    } catch {
      /* unbalanced-in-strings garbage — try the next opener */
    }
  }
  return null;
}

/** index of the bracket closing text[start], honoring strings/escapes; -1 if never closed */
function scanBalanced(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Should a click on this line auto-open the dock's JSON tab?
 * Only when the line is *about* the JSON: a non-empty object anywhere, or an
 * array covering most of the line — a bare `[3]` inside prose stays in Inspect. */
export function shouldAutoRouteJson(raw: string): boolean {
  const hit = extractJson(raw);
  if (!hit || typeof hit.value !== "object" || hit.value === null) return false;
  if (!Array.isArray(hit.value)) return Object.keys(hit.value).length > 0;
  return hit.end - hit.start >= raw.trim().length * 0.5;
}

export type JsonFieldType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonField {
  path: string;
  depth: number;
  type: JsonFieldType;
  preview: string;
  copyValue: string;
}

const SAFE_PATH_KEY = /^[A-Za-z_$][\w$]*$/;
const PREVIEW_LENGTH = 78;

function fieldType(value: unknown): JsonFieldType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value as "string" | "number" | "boolean";
}

function fieldPreview(value: unknown, type: JsonFieldType): string {
  if (type === "object") return `${Object.keys(value as object).length} fields`;
  if (type === "array") return `${(value as unknown[]).length} items`;
  const text = value === null ? "null" : String(value);
  return text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1)}…`;
}

function copyValue(value: unknown, type: JsonFieldType): string {
  if (type === "string") return value as string;
  if (type === "object" || type === "array") return JSON.stringify(value, null, 2);
  return value === null ? "null" : String(value);
}

export function jsonChildPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return SAFE_PATH_KEY.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

/** Pre-order, flat field model for a narrow inspector pane. */
export function jsonFields(value: unknown): JsonField[] {
  const fields: JsonField[] = [];

  const visit = (current: unknown, path: string, depth: number) => {
    const type = fieldType(current);
    fields.push({
      path,
      depth,
      type,
      preview: fieldPreview(current, type),
      get copyValue() { return copyValue(current, type); },
    });

    if (Array.isArray(current)) {
      current.forEach((child, index) => visit(child, jsonChildPath(path, index), depth + 1));
    } else if (current !== null && typeof current === "object") {
      Object.entries(current as Record<string, unknown>)
        .forEach(([key, child]) => visit(child, jsonChildPath(path, key), depth + 1));
    }
  };

  visit(value, "$", 0);
  return fields;
}

export function filterJsonFields(fields: JsonField[], query: string): JsonField[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return fields;
  return fields.filter((field) =>
    `${field.path}\n${field.type}\n${field.preview}`.toLowerCase().includes(needle),
  );
}

/** JSONPaths that can be independently folded in the tree viewer. */
export function jsonContainerPaths(value: unknown): string[] {
  return jsonFields(value)
    .filter((field) =>
      (field.type === "object" && field.preview !== "0 fields") ||
      (field.type === "array" && field.preview !== "0 items"),
    )
    .map((field) => field.path);
}
