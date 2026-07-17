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
