// ponytail: subsequence fuzzy match. ~24-ish candidates, no lib needed.
export interface FuzzyResult { indices: number[]; score: number }

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { indices: [], score: 0 };
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prevTi = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const boundary = ti === 0 || /[\s/:_-]/.test(t[ti - 1]);
      if (boundary) score += 8;
      if (ti === prevTi + 1 && indices.length > 0) score += 5;
      if (qi === 0 && ti < 3) score += 6;
      indices.push(ti);
      prevTi = ti;
      qi++;
    }
  }
  if (qi !== q.length) return null;
  score -= Math.round(t.length * 0.1);
  return { indices, score };
}

export type Highlighted = Array<{ text: string; mark: boolean }>;

export function highlight(text: string, indices: number[]): Highlighted {
  if (!indices.length) return [{ text, mark: false }];
  const set = new Set(indices);
  const out: Highlighted = [];
  let buf = "";
  let mark = false;
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== mark) {
      if (buf) out.push({ text: buf, mark });
      buf = "";
      mark = m;
    }
    buf += text[i];
  }
  if (buf) out.push({ text: buf, mark });
  return out;
}

// ponytail: self-check — run via `npx tsx src/lib/fuzzy.ts`. Skipped at import time.
function main() {
  const m = fuzzyMatch("stg", "Open Settings");
  if (!m) throw new Error("stg should match Open Settings");
  if (m.indices.join(",") !== "5,7,11") throw new Error("indices wrong: " + m.indices);
  if (fuzzyMatch("xyz", "Open Settings")) throw new Error("xyz must not match");
  const h = highlight("Open Settings", m.indices);
  if (h.filter((p) => p.mark).map((p) => p.text).join("") !== "Stg")
    throw new Error("highlight wrong: " + JSON.stringify(h));
  console.log("fuzzy ok:", m, JSON.stringify(h));
}
// runs only when executed directly via tsx/node (globalThis.process exists, argv[1] endsWith fuzzy.ts)
const g = globalThis as { process?: { argv?: string[] } };
if (typeof g.process?.argv?.[1] === "string" && g.process.argv[1].endsWith("fuzzy.ts")) {
  main();
}