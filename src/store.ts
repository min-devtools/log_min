import { create } from "zustand";
import { dockTabNext, INITIAL_DOCK_TAB, type DockTabEvent, type DockTabState } from "./lib/dockTab";
import { isThemeId, themeBase } from "./lib/themes";
import { clampFontSize, DEFAULT_FONT_SIZE } from "./lib/fontScale";
import { bufferFor, dropBuffer } from "./lib/ring";
import { archiveFor, dropArchive } from "./lib/errorArchive";
import { dropErrorIndex, errorIndexFor } from "./lib/errors";
import { dropInsightIndex } from "./lib/insight";
import { purgeSource } from "./lib/merged";
import * as api from "./lib/logmin";
import { sourceIcon } from "./lib/types";
import type { CollectionDef, SelectedLine, SourceDef, SourceRuntime, StatusPayload, TabDef, TabKind } from "./lib/types";

const TAB_META: Record<TabKind, { title: string; icon: TabDef["icon"]; iconClass: string }> = {
  welcome: { title: "Welcome", icon: "sparkles", iconClass: "soft-blue" },
  source: { title: "Source", icon: "docs", iconClass: "soft-blue" },
  "source-edit": { title: "New Source", icon: "plus", iconClass: "soft-green" },
  settings: { title: "Settings", icon: "settings", iconClass: "soft-orange" },
  "error-trace": { title: "Error", icon: "zap", iconClass: "soft-orange" },
  combined: { title: "Combined", icon: "rows", iconClass: "soft-blue" },
};

const sourceTabId = (sourceId: string) => `src-${sourceId}`;

export const newSourceId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
export const newCollectionId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const IDLE_RUNTIME: SourceRuntime = { status: "idle", lines: 0, errors: 0, dropped: 0 };

/** Restore last session's open tabs from localStorage (log lines are not persisted). */
function loadSession(): { tabs: TabDef[]; activeTabId: string } | null {
  try {
    const raw = localStorage.getItem("log:session");
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.tabs) || s.tabs.length === 0) return null;
    // error-trace tabs and transient source tabs are not restored after a relaunch
    const tabs: TabDef[] = s.tabs.filter(
      (t: TabDef) => TAB_META[t.kind] && t.kind !== "error-trace" && !t.transient,
    );
    if (!tabs.length) return null;
    return {
      tabs,
      activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[0].id,
    };
  } catch {
    return null;
  }
}

const session = loadSession();

export interface ToastMsg {
  title: string;
  body: string;
  kind?: "ok" | "warn" | "err";
}

export interface DialogRequest {
  kind: "prompt" | "confirm";
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface AppState {
  sources: SourceDef[];
  collections: CollectionDef[];
  runtimes: Record<string, SourceRuntime>;
  /** bumped per received batch — LogView subscribes and reads the ring imperatively */
  bufVersions: Record<string, number>;
  /** bumped when the incremental error index changes */
  errorVersions: Record<string, number>;
  /** source being edited in the source-edit tab (null = new draft) */
  editingSourceId: string | null;
  /** prefill for a new source (palette templates, e.g. SSH tail) */
  sourceDraft: Partial<SourceDef> | null;
  /** protects an in-progress source form from being replaced or closed silently */
  sourceEditDirty: boolean;

  tabs: TabDef[];
  activeTabId: string;

  theme: string;
  compact: boolean;
  vimKeys: boolean;
  /** app-wide UI font size in px (1rem base) */
  uiFontSize: number;
  /** UI font family ("" = design default) */
  uiFont: string;
  /** mono font family for log lines ("" = design default) */
  editorFont: string;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  commandOpen: boolean;
  /** set by the error dock — the matching LogView scrolls to the seq and flashes it.
   *  combinedId set → the collection's combined view consumes it instead */
  jumpTarget: { sourceId: string; seq: number; nonce: number; combinedId?: string } | null;
  /** line last plain-clicked in a LogView — routes and feeds the right dock */
  inspectLine: SelectedLine | null;
  /** right-dock sub-tab (Overview/Inspect/JSON/Errors) — shared so LogView can yield ⌘F to the Errors search */
  dockTab: DockTabState;
  toast: ToastMsg | null;
  dialog: (DialogRequest & { resolve: (value: string | null) => void }) | null;

  // sources
  setSources: (sources: SourceDef[]) => void;
  saveSource: (def: SourceDef) => void;
  // sidebar collections
  setCollections: (collections: CollectionDef[]) => void;
  createCollection: (name: string) => void;
  renameCollection: (id: string, name: string) => void;
  /** delete the folder; its sources drop back to root */
  deleteCollection: (id: string) => void;
  /** reorder a collection before another (null = end) */
  reorderCollection: (id: string, beforeId: string | null) => void;
  /** move a source into a collection (undefined = root), inserted before beforeId (null = end) */
  moveSource: (id: string, collectionId: string | undefined, beforeId: string | null) => void;
  deleteSource: (id: string) => Promise<void>;
  /** commandOverride: run a one-off command in this source's view (same cwd/env) instead of the saved one */
  startSource: (id: string, commandOverride?: string) => Promise<void>;
  stopSource: (id: string) => Promise<void>;
  sendStdin: (id: string, line: string) => Promise<void>;
  /** open the source-edit tab for an existing source (id) or a new draft (null, optional prefill) */
  editSource: (id: string | null, draft?: Partial<SourceDef>) => void;
  setSourceEditDirty: (dirty: boolean) => void;
  onBatch: (sourceId: string, lines: number, errors: number, dropped: number) => void;
  /** "Clear buffer" pressed — zero the per-source counters and drop the published line */
  onBufferCleared: (sourceId: string) => void;
  /** drop captured errors (index + archive) from RAM and zero the error counter */
  clearErrors: (sourceId: string) => void;
  onErrorIndexChange: (sourceId: string) => void;
  onStatus: (p: StatusPayload) => void;

  // tabs
  openTab: (kind: TabKind) => void;
  openSourceTab: (sourceId: string) => void;
  /** open (or focus) the combined docker-compose-style view for a collection */
  openCombinedTab: (collectionId: string) => void;
  /** open (or focus) the dedicated trace tab for an error group */
  openErrorTab: (sourceId: string, fingerprint: string, message: string) => void;
  /** open file(s) as transient sources without persisting them */
  openTransientFiles: (paths: string[]) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  reorderTab: (id: string, beforeId: string | null) => void;
  renameTab: (id: string, title: string) => void;

  // shell
  setTheme: (id: string) => void;
  toggleTheme: () => void;
  toggleCompact: () => void;
  toggleVimKeys: () => void;
  setUiFontSize: (size: number) => void;
  setUiFont: (font: string) => void;
  setEditorFont: (font: string) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setCommandOpen: (open: boolean) => void;
  /** ⌘↵ / titlebar play — start (or restart, for cmd sources) the active tab's source */
  runActive: () => void;
  jumpToLine: (sourceId: string, seq: number) => void;
  /** focus + flash a line inside a collection's combined view (dock "Jump") */
  jumpToCombinedLine: (collectionId: string, sourceId: string, seq: number) => void;
  setInspectLine: (line: SelectedLine | null) => void;
  dispatchDockTab: (event: DockTabEvent) => void;
  showToast: (title: string, body: string, kind?: ToastMsg["kind"]) => void;
  clearToast: () => void;
  /** in-app replacement for window.prompt/confirm — unimplemented in the Tauri webview */
  openDialog: (req: DialogRequest) => Promise<string | null>;
}

let toastTimer: number | undefined;

export const runtimeOf = (s: Pick<AppState, "runtimes">, id: string): SourceRuntime =>
  s.runtimes[id] ?? IDLE_RUNTIME;

/** The error dock belongs to source-bound tabs; other views keep the workspace wide. */
export const inspectorAvailable = (s: Pick<AppState, "tabs" | "activeTabId">) => {
  const kind = s.tabs.find((tab) => tab.id === s.activeTabId)?.kind;
  return kind === "source" || kind === "error-trace" || kind === "combined";
};

export const useApp = create<AppState>((set, get) => ({
  sources: [],
  collections: [],
  runtimes: {},
  bufVersions: {},
  errorVersions: {},
  editingSourceId: null,
  sourceDraft: null,
  sourceEditDirty: false,

  tabs: session?.tabs ?? [{ id: "welcome", kind: "welcome", ...TAB_META.welcome }],
  activeTabId: session?.activeTabId ?? "welcome",

  // default = Bearded Arc (shared with elatic_min/requests_min); invalid stored themes fall back
  theme: (() => {
    const stored = localStorage.getItem("log:theme-v2");
    return stored && isThemeId(stored) ? stored : "default-dark";
  })(),
  compact: localStorage.getItem("log:compact") === "1",
  vimKeys: localStorage.getItem("log:vim-keys") === "1",
  uiFontSize: clampFontSize(Number(localStorage.getItem("log:ui-font-size")) || DEFAULT_FONT_SIZE),
  uiFont: localStorage.getItem("log:ui-font") ?? "",
  editorFont: localStorage.getItem("log:editor-font") ?? "",
  leftCollapsed: false,
  rightCollapsed: false,
  commandOpen: false,
  jumpTarget: null,
  inspectLine: null,
  dockTab: INITIAL_DOCK_TAB,
  toast: null,
  dialog: null,

  setSources: (sources) => set({ sources }),

  saveSource: (def) =>
    set((s) => {
      const exists = s.sources.some((x) => x.id === def.id);
      const sources = exists ? s.sources.map((x) => (x.id === def.id ? def : x)) : [...s.sources, def];
      // keep an open tab's title/icon in sync with the edited definition
      const tabs = s.tabs.map((t) =>
        t.sourceId === def.id
          ? { ...t, title: def.name, icon: sourceIcon(def), transient: def.transient }
          : t,
      );
      return { sources, tabs };
    }),

  setCollections: (collections) => set({ collections }),

  createCollection: (name) =>
    set((s) => ({ collections: [...s.collections, { id: newCollectionId(), name }] })),

  renameCollection: (id, name) =>
    set((s) => ({
      collections: s.collections.map((c) => (c.id === id ? { ...c, name } : c)),
      tabs: s.tabs.map((t) => (t.collectionId === id ? { ...t, title: name } : t)),
    })),

  deleteCollection: (id) => {
    get().closeTab(`comb-${id}`);
    set((s) => ({
      collections: s.collections.filter((c) => c.id !== id),
      sources: s.sources.map((x) => (x.collectionId === id ? { ...x, collectionId: undefined } : x)),
    }));
  },

  reorderCollection: (id, beforeId) =>
    set((s) => {
      if (id === beforeId) return s;
      const collections = s.collections.filter((c) => c.id !== id);
      const moved = s.collections.find((c) => c.id === id);
      if (!moved) return s;
      const at = beforeId ? collections.findIndex((c) => c.id === beforeId) : -1;
      collections.splice(at < 0 ? collections.length : at, 0, moved);
      if (collections.every((collection, index) => collection === s.collections[index])) return s;
      return { collections };
    }),

  moveSource: (id, collectionId, beforeId) =>
    set((s) => {
      if (id === beforeId) return s;
      const moved = s.sources.find((x) => x.id === id);
      if (!moved) return s;
      const sources = s.sources.filter((x) => x.id !== id);
      const at = beforeId ? sources.findIndex((x) => x.id === beforeId) : -1;
      const nextMoved = moved.collectionId === collectionId ? moved : { ...moved, collectionId };
      sources.splice(at < 0 ? sources.length : at, 0, nextMoved);
      if (sources.every((source, index) => source === s.sources[index])) return s;
      return { sources };
    }),

  deleteSource: async (id) => {
    try {
      await api.sourceStop(id);
    } catch {
      // already stopped
    }
    dropBuffer(id);
    purgeSource(id);
    dropErrorIndex(id);
    dropInsightIndex(id);
    dropArchive(id);
    const s = get();
    for (const t of s.tabs.filter((x) => x.kind === "error-trace" && x.sourceId === id)) s.closeTab(t.id);
    s.closeTab(sourceTabId(id));
    set((st) => {
      const runtimes = { ...st.runtimes };
      const bufVersions = { ...st.bufVersions };
      const errorVersions = { ...st.errorVersions };
      delete runtimes[id];
      delete bufVersions[id];
      delete errorVersions[id];
      return {
        sources: st.sources.filter((x) => x.id !== id),
        runtimes,
        bufVersions,
        errorVersions,
        inspectLine: st.inspectLine?.sourceId === id ? null : st.inspectLine,
      };
    });
  },

  startSource: async (id, commandOverride) => {
    const def = get().sources.find((x) => x.id === id);
    if (!def) return;
    try {
      await api.sourceStart(commandOverride ? { ...def, kind: "cmd", command: commandOverride } : def);
    } catch (err) {
      set((s) => ({
        runtimes: { ...s.runtimes, [id]: { ...runtimeOf(s, id), status: "error", error: String(err) } },
      }));
      get().showToast("Start failed", String(err), "err");
    }
  },

  stopSource: async (id) => {
    try {
      await api.sourceStop(id);
    } finally {
      // user-stop emits no Rust status event (stale-token guard) — settle locally
      set((s) => ({
        runtimes: {
          ...s.runtimes,
          [id]: { ...runtimeOf(s, id), status: "idle", pid: undefined, exitCode: undefined },
        },
      }));
    }
  },

  sendStdin: async (id, line) => {
    try {
      await api.cmdStdin(id, line);
    } catch (err) {
      get().showToast("stdin failed", String(err), "err");
    }
  },

  editSource: (id, draft) => {
    const s = get();
    if (s.sourceEditDirty) {
      set({ activeTabId: "source-edit" });
      s.showToast("Unsaved source draft", "Save or discard it before opening another source.", "warn");
      return;
    }
    set({ editingSourceId: id, sourceDraft: draft ?? null });
    get().openTab("source-edit");
    // retitle the singleton tab to match the mode
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.kind === "source-edit" ? { ...t, title: id ? "Edit Source" : "New Source" } : t,
      ),
    }));
  },
  setSourceEditDirty: (sourceEditDirty) => set({ sourceEditDirty }),

  onBatch: (sourceId, _lines, errors, dropped) =>
    set((s) => {
      const rt = runtimeOf(s, sourceId);
      return {
        bufVersions: { ...s.bufVersions, [sourceId]: (s.bufVersions[sourceId] ?? 0) + 1 },
        runtimes: {
          ...s.runtimes,
          [sourceId]: {
            ...rt,
            lines: bufferFor(sourceId).totalSeen,
            errors: rt.errors + errors,
            dropped: rt.dropped + dropped,
          },
        },
      };
    }),

  onBufferCleared: (sourceId) => {
    // the ring restarts seqs at 0 — drop its stale ledger entries so MergedIndex
    // doesn't produce duplicate {sourceId, seq} rows once it refills
    purgeSource(sourceId);
    // errors (index + archive + counter) survive a clear by design — only the ring resets
    set((s) => ({
      bufVersions: { ...s.bufVersions, [sourceId]: (s.bufVersions[sourceId] ?? 0) + 1 },
      runtimes: {
        ...s.runtimes,
        [sourceId]: { ...runtimeOf(s, sourceId), lines: 0, dropped: 0 },
      },
      inspectLine: s.inspectLine?.sourceId === sourceId ? null : s.inspectLine,
    }));
  },

  clearErrors: (sourceId) => {
    errorIndexFor(sourceId).clear();
    archiveFor(sourceId).clear();
    set((s) => ({
      errorVersions: { ...s.errorVersions, [sourceId]: (s.errorVersions[sourceId] ?? 0) + 1 },
      runtimes: { ...s.runtimes, [sourceId]: { ...runtimeOf(s, sourceId), errors: 0 } },
    }));
  },

  onErrorIndexChange: (sourceId) =>
    set((s) => ({
      errorVersions: {
        ...s.errorVersions,
        [sourceId]: (s.errorVersions[sourceId] ?? 0) + 1,
      },
    })),

  onStatus: (p) =>
    set((s) => {
      const rt = runtimeOf(s, p.sourceId);
      return {
        runtimes: {
          ...s.runtimes,
          [p.sourceId]: {
            ...rt,
            status: p.status,
            pid: p.pid ?? (p.status === "live" ? rt.pid : undefined),
            exitCode: p.exitCode ?? undefined,
            error: p.error,
            startedAt: p.startedAt ?? rt.startedAt,
          },
        },
      };
    }),

  openTab: (kind) => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === kind);
    if (existing) return set({ activeTabId: existing.id });
    set({
      tabs: [...s.tabs, { id: kind, kind, ...TAB_META[kind] }],
      activeTabId: kind,
    });
  },

  openErrorTab: (sourceId, fingerprint, message) => {
    const s = get();
    const id = `err-${sourceId}-${fingerprint}`;
    if (s.tabs.some((t) => t.id === id)) return set({ activeTabId: id });
    const title = message.length > 32 ? `${message.slice(0, 32)}…` : message;
    set({
      tabs: [
        ...s.tabs,
        { id, kind: "error-trace", title, icon: "zap", iconClass: "soft-orange", sourceId, fingerprint },
      ],
      activeTabId: id,
    });
  },

  openTransientFiles: (paths) => {
    for (const p of paths) {
      const id = newSourceId();
      const def: SourceDef = { id, name: baseName(p), kind: "file", path: p, transient: true };
      get().saveSource(def);
      get().openSourceTab(id);
      void get().startSource(id);
    }
  },

  openSourceTab: (sourceId) => {
    const s = get();
    const id = sourceTabId(sourceId);
    if (s.tabs.some((t) => t.id === id)) return set({ activeTabId: id });
    const def = s.sources.find((x) => x.id === sourceId);
    if (!def) return;
    set({
      tabs: [
        ...s.tabs,
        {
          id,
          kind: "source",
          title: def.name,
          icon: sourceIcon(def),
          iconClass: "soft-blue",
          sourceId,
          transient: def.transient,
        },
      ],
      activeTabId: id,
    });
  },

  openCombinedTab: (collectionId) => {
    const s = get();
    const id = `comb-${collectionId}`;
    if (s.tabs.some((t) => t.id === id)) return set({ activeTabId: id });
    const col = s.collections.find((c) => c.id === collectionId);
    if (!col) return;
    set({
      tabs: [
        ...s.tabs,
        { id, kind: "combined", title: col.name, icon: "rows", iconClass: "soft-blue", collectionId },
      ],
      activeTabId: id,
    });
  },

  closeTab: (id) => {
    if (id === "source-edit" && get().sourceEditDirty) {
      void get()
        .openDialog({
          kind: "confirm",
          title: "Discard source changes?",
          message: "Your unsaved source configuration will be lost.",
          confirmLabel: "Discard",
          danger: true,
        })
        .then((confirmed) => {
          if (confirmed === null) return;
          set({ sourceEditDirty: false });
          get().closeTab(id);
        });
      return;
    }
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      const transientId = tab.kind === "source" && tab.transient ? tab.sourceId : undefined;
      const idx = s.tabs.indexOf(tab);
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (activeTabId === id) {
        const next = tabs[Math.min(idx, tabs.length - 1)];
        activeTabId = next?.id ?? "";
      }
      if (tabs.length === 0) {
        activeTabId = "welcome";
      }
      // clean up transient sources immediately when their tab closes
      if (transientId) {
        setTimeout(() => get().deleteSource(transientId), 0);
      }
      if (tabs.length === 0) {
        return {
          tabs: [{ id: "welcome", kind: "welcome", ...TAB_META.welcome }],
          activeTabId: "welcome",
          ...(id === "source-edit"
            ? { editingSourceId: null, sourceDraft: null, sourceEditDirty: false }
            : {}),
        };
      }
      return {
        tabs,
        activeTabId,
        ...(id === "source-edit"
          ? { editingSourceId: null, sourceDraft: null, sourceEditDirty: false }
          : {}),
      };
    });
  },

  activateTab: (id) => set({ activeTabId: id }),

  reorderTab: (id, beforeId) =>
    set((s) => {
      if (id === beforeId) return s;
      const dragged = s.tabs.find((t) => t.id === id);
      if (!dragged) return s;
      const rest = s.tabs.filter((t) => t.id !== id);
      const idx = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
      const tabs = idx < 0 ? [...rest, dragged] : [...rest.slice(0, idx), dragged, ...rest.slice(idx)];
      return { tabs };
    }),

  renameTab: (id, title) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      const nextTitle = title.trim() || tab.title;
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: nextTitle } : t)),
        sources: tab.sourceId
          ? s.sources.map((source) =>
              source.id === tab.sourceId ? { ...source, name: nextTitle } : source,
            )
          : s.sources,
      };
    }),

  setTheme: (id) => {
    localStorage.setItem("log:theme-v2", id);
    set({ theme: id });
  },

  toggleTheme: () =>
    set((s) => {
      // flip between light/dark base regardless of the current custom theme
      const theme = themeBase(s.theme) === "dark" ? "light" : "dark";
      localStorage.setItem("log:theme-v2", theme);
      return { theme };
    }),
  toggleCompact: () =>
    set((s) => {
      localStorage.setItem("log:compact", s.compact ? "0" : "1");
      return { compact: !s.compact };
    }),
  toggleVimKeys: () =>
    set((s) => {
      localStorage.setItem("log:vim-keys", s.vimKeys ? "0" : "1");
      return { vimKeys: !s.vimKeys };
    }),
  setUiFontSize: (size) => {
    const clamped = clampFontSize(size || DEFAULT_FONT_SIZE);
    localStorage.setItem("log:ui-font-size", String(clamped));
    set({ uiFontSize: clamped });
  },
  setUiFont: (font) => {
    localStorage.setItem("log:ui-font", font);
    set({ uiFont: font });
  },
  setEditorFont: (font) => {
    localStorage.setItem("log:editor-font", font);
    set({ editorFont: font });
  },
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  setCommandOpen: (open) => set({ commandOpen: open }),
  runActive: () => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (tab?.kind === "combined" && tab.collectionId) {
      const collectionId = tab.collectionId;
      s.sources.filter((x) => x.collectionId === collectionId).forEach((x) => void s.startSource(x.id));
      return;
    }
    if (tab?.kind !== "source" || !tab.sourceId) return;
    const def = s.sources.find((x) => x.id === tab.sourceId);
    const live = runtimeOf(s, tab.sourceId).status === "live";
    if (def?.kind === "cmd" || !live) void s.startSource(tab.sourceId);
  },
  jumpToLine: (sourceId, seq) =>
    set((s) => {
      // jumping from a trace tab must land on the log tab, where the line lives
      const id = sourceTabId(sourceId);
      return {
        jumpTarget: { sourceId, seq, nonce: (s.jumpTarget?.nonce ?? 0) + 1 },
        activeTabId: s.tabs.some((t) => t.id === id) ? id : s.activeTabId,
      };
    }),

  jumpToCombinedLine: (collectionId, sourceId, seq) =>
    set((s) => {
      const id = `comb-${collectionId}`;
      return {
        jumpTarget: { sourceId, seq, combinedId: collectionId, nonce: (s.jumpTarget?.nonce ?? 0) + 1 },
        activeTabId: s.tabs.some((t) => t.id === id) ? id : s.activeTabId,
      };
    }),

  setInspectLine: (inspectLine) => set({ inspectLine }),
  dispatchDockTab: (event) => set((s) => ({ dockTab: dockTabNext(s.dockTab, event) })),

  showToast: (title, body, kind) => {
    window.clearTimeout(toastTimer);
    set({ toast: { title, body, kind } });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
  },
  clearToast: () => {
    window.clearTimeout(toastTimer);
    set({ toast: null });
  },

  openDialog: (req) =>
    new Promise<string | null>((resolve) => {
      set({
        dialog: {
          ...req,
          resolve: (value) => {
            resolve(value);
            set({ dialog: null });
          },
        },
      });
    }),
}));
