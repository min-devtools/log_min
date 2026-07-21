export type JsonValueType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonField {
  path: string;
  depth: number;
  type: JsonValueType;
  preview: string;
  value: unknown;
}

const SAFE_PATH_KEY = /^[A-Za-z_$][\w$]*$/;
const PREVIEW_LENGTH = 78;

export function valueType(value: unknown): JsonValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value as "string" | "number" | "boolean";
}

export function valuePreview(value: unknown, type: JsonValueType): string {
  if (type === "object") return `${Object.keys(value as object).length} fields`;
  if (type === "array") return `${(value as unknown[]).length} items`;
  const text = value === null ? "null" : String(value);
  return text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1)}…`;
}

export function jsonChildPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return SAFE_PATH_KEY.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export function jsonFields(value: unknown): JsonField[] {
  const fields: JsonField[] = [];

  const visit = (current: unknown, path: string, depth: number) => {
    const type = valueType(current);
    fields.push({
      path,
      depth,
      type,
      preview: valuePreview(current, type),
      value: current,
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

export function jsonContainerPaths(value: unknown): string[] {
  return jsonFields(value)
    .filter((field) =>
      (field.type === "object" && field.preview !== "0 fields") ||
      (field.type === "array" && field.preview !== "0 items"),
    )
    .map((field) => field.path);
}

export function filterJsonFields(fields: JsonField[], query: string, caseSensitive = false): JsonField[] {
  const needle = caseSensitive ? query.trim() : query.trim().toLowerCase();
  if (!needle) return fields;
  return fields.filter((field) => {
    const hay = caseSensitive
      ? `${field.path}\n${field.type}\n${field.preview}`
      : `${field.path}\n${field.type}\n${field.preview}`.toLowerCase();
    return hay.includes(needle);
  });
}

export function findMarks(text: string, q: string, caseSensitive = false): [number, number][] {
  if (!q) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const query = caseSensitive ? q : q.toLowerCase();
  const out: [number, number][] = [];
  for (let i = hay.indexOf(query); i >= 0 && out.length < 400; i = hay.indexOf(query, i + query.length)) {
    out.push([i, i + query.length]);
  }
  return out;
}
