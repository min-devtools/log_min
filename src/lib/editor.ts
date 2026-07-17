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

/** relative frame paths resolve against the command's cwd / the tailed file's dir
 *  ponytail: remote→local prefix mapping is M2 — SSH traces just fall back to copy */
export function resolveFramePath(frame: Frame, def?: SourceDef): string {
  if (frame.path.startsWith("node:")) return frame.path;
  if (frame.path.startsWith("/") || frame.path.startsWith("file://")) {
    return frame.path.replace(/^file:\/\//, "");
  }
  const base =
    def?.kind === "cmd" && def.cwd
      ? def.cwd
      : def?.kind === "file" && def.path
        ? def.path.replace(/\/[^/]*$/, "")
        : "";
  return base ? `${base.replace(/\/$/, "")}/${frame.path}` : frame.path;
}

/** true when we actually opened an editor; false = copied to clipboard instead */
export async function openFrame(frame: Frame, def?: SourceDef): Promise<boolean> {
  const app = loadEditorApp();
  const path = resolveFramePath(frame, def);
  const loc = `${path}:${frame.line}${frame.col ? `:${frame.col}` : ""}`;
  // unresolvable relative path → clipboard is the honest fallback
  if (app === "copy" || !path.startsWith("/")) {
    await writeText(loc);
    return false;
  }
  try {
    await invoke("editor_open", {
      editor: app,
      path,
      line: frame.line,
      col: frame.col,
    });
    return true;
  } catch {
    await writeText(loc);
    return false;
  }
}
