// Bundle Monaco locally (no CDN) and register only the JSON worker we need.
// This module is only pulled in via the lazy-loaded JsonEditor, so Monaco
// stays out of the main bundle.
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { loader } from "@monaco-editor/react";

export const MONACO_THEME = "logmin";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};

/** app theme var as 6-digit hex (no #) — Monaco token colors want bare hex */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) return fallback;
  const hex = m[1];
  return hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
}

const isLight = (hex: string) => {
  const n = parseInt(hex, 16);
  // quick perceived luminance — only decides Monaco's base theme
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)) / 255 > 0.5;
};

/** (Re)build the Monaco theme from the CSS vars of the active app theme. */
export function retintMonaco() {
  const bg = cssVar("--pane", "15141b");
  monaco.editor.defineTheme(MONACO_THEME, {
    base: isLight(bg) ? "vs" : "vs-dark",
    inherit: true,
    rules: [
      { token: "string.key.json", foreground: cssVar("--blue", "a277ff") },
      { token: "string.value.json", foreground: cssVar("--green", "61ffca") },
      { token: "number", foreground: cssVar("--orange", "ffca85") },
      { token: "keyword.json", foreground: cssVar("--purple", "f694ff") },
      { token: "delimiter", foreground: cssVar("--text-3", "6d6a7e") },
    ],
    colors: {
      "editor.background": `#${bg}`,
      "editor.foreground": `#${cssVar("--text", "edecee")}`,
      "editorCursor.foreground": `#${cssVar("--blue", "a277ff")}`,
      "editor.selectionBackground": `#${cssVar("--blue", "a277ff")}44`,
      "editor.inactiveSelectionBackground": `#${cssVar("--blue", "a277ff")}22`,
    },
  });
  monaco.editor.setTheme(MONACO_THEME);
}

retintMonaco();

loader.config({ monaco });

export { monaco };
