export interface KvPair {
  key: string;
  value: string;
}

/**
 * key=value · key = value · key: value (colon needs a space, so 12:30:45
 * timestamps and http:// urls never match). Values: quoted, balanced
 * [..]/{..}/(..) blocks (nested json stays whole), or one bare token.
 */
const RE_KEY = /([A-Za-z_][\w.-]*)\s*(?:=|:\s)\s*/g;
const RE_QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/y;
const RE_BARE = /[^\s,;|\]})]+/y;

const CLOSE: Record<string, string> = { "[": "]", "{": "}", "(": ")" };

/** slice from a bracket to its balanced close, skipping quoted strings */
function balanced(raw: string, start: number): string {
  const open = raw[start];
  const close = CLOSE[open];
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return raw.slice(start, i + 1);
  }
  return raw.slice(start); // unterminated — take the rest
}

const unquote = (s: string) =>
  (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
    ? s.slice(1, -1)
    : s;

export function extractKv(raw: string): KvPair[] {
  const out: KvPair[] = [];
  const seen = new Set<string>();
  RE_KEY.lastIndex = 0;
  for (let m = RE_KEY.exec(raw); m; m = RE_KEY.exec(raw)) {
    const at = RE_KEY.lastIndex;
    const c = raw[at];
    let value: string | undefined;
    if (c === '"' || c === "'") {
      RE_QUOTED.lastIndex = at;
      value = RE_QUOTED.exec(raw)?.[0];
    } else if (c in CLOSE) {
      value = balanced(raw, at);
    }
    if (value === undefined) {
      RE_BARE.lastIndex = at;
      value = RE_BARE.exec(raw)?.[0];
    }
    if (!value) continue;
    // consume the value so keys inside it don't produce garbage pairs
    RE_KEY.lastIndex = at + value.length;
    const pair = { key: m[1], value: unquote(value) };
    const id = `${pair.key} ${pair.value}`;
    if (seen.has(id) || !pair.value) continue;
    seen.add(id);
    out.push(pair);
  }
  return out;
}
