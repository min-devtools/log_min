import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Frame, SourceDef } from "./types";

export type EditorApp = "vscode" | "cursor" | "zed" | "idea" | "copy";

export const EDITOR_LABELS: Record<EditorApp, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  zed: "Zed",
  idea: "JetBrains (IDEA)",
  copy: "Copy path only",
};

export function loadEditorApp(): EditorApp {
  const v = localStorage.getItem("log:editor-app");
  return v && v in EDITOR_LABELS ? (v as EditorApp) : "vscode";
}

export function saveEditorApp(app: EditorApp): void {
  localStorage.setItem("log:editor-app", app);
}

/** the directory relative frame paths resolve against — cmd cwd / the tailed file's dir */
export function sourceBaseDir(def?: SourceDef): string {
  return def?.kind === "cmd" && def.cwd
    ? def.cwd
    : def?.kind === "file" && def.path
      ? def.path.replace(/\/[^/]*$/, "")
      : "";
}

/** relative frame paths resolve against the command's cwd / the tailed file's dir
 *  ponytail: remote→local prefix mapping is M2 — SSH traces just fall back to copy */
export function resolveFramePath(frame: Frame, def?: SourceDef): string {
  if (frame.path.startsWith("node:")) return frame.path;
  if (frame.path.startsWith("/") || frame.path.startsWith("file://")) {
    return frame.path.replace(/^file:\/\//, "");
  }
  const base = sourceBaseDir(def);
  return base ? `${base.replace(/\/$/, "")}/${frame.path}` : frame.path;
}

/** `path:line[:col]` token (tok-path) → openFrame; false = copied instead of opened */
export async function openLocation(loc: string, def?: SourceDef): Promise<boolean> {
  const m = /^(.+?):(\d+)(?::(\d+))?$/.exec(loc);
  if (!m) return false;
  return openFrame(
    { fn: "", path: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : undefined, isApp: true },
    def,
  );
}

/** true when we actually opened an editor; false = copied to clipboard instead */
export async function openFrame(frame: Frame, def?: SourceDef): Promise<boolean> {
  const app = loadEditorApp();
  const resolved = resolveFramePath(frame, def);
  const loc = `${resolved}:${frame.line}${frame.col ? `:${frame.col}` : ""}`;
  const base = sourceBaseDir(def) || undefined;
  const isAbsolute = frame.path.startsWith("/") || frame.path.startsWith("file://");
  // runtime pseudo-paths and relative paths with nowhere to look → clipboard
  if (app === "copy" || frame.path.startsWith("node:") || (!isAbsolute && !base)) {
    await writeText(loc);
    return false;
  }
  try {
    // relative paths ship unresolved: the backend joins them to base and, when
    // the logger printed only the path tail (zap: `pkg/file.go`), walks base
    // for the first directory the suffix exists under
    await invoke("editor_open", {
      editor: app,
      path: isAbsolute ? resolved : frame.path,
      line: frame.line,
      col: frame.col,
      base,
    });
    return true;
  } catch {
    await writeText(loc);
    return false;
  }
}
