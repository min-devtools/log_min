import { load, type Store } from "@tauri-apps/plugin-store";
import type { CollectionDef, SourceDef } from "./types";
import { useApp } from "../store";

let store: Store | null = null;

export async function initPersistence(): Promise<void> {
  try {
    store = await load("log.json", { autoSave: true, defaults: {} });
    const sources = (await store.get<SourceDef[]>("sources")) ?? [];
    const collections = (await store.get<CollectionDef[]>("collections")) ?? [];
    useApp.setState({ sources, collections });
    // sources are restored but never auto-started — the app must not spawn
    // processes on launch; each tab shows ▶ instead
  } catch (err) {
    console.error("failed to load persisted store", err);
  }

  let prev = useApp.getState();
  useApp.subscribe((s) => {
    if (store && s.sources !== prev.sources) void store.set("sources", s.sources);
    if (store && s.collections !== prev.collections) void store.set("collections", s.collections);
    // session restore: open tabs (log lines are not persisted)
    if (s.tabs !== prev.tabs || s.activeTabId !== prev.activeTabId) {
      localStorage.setItem(
        "log:session",
        JSON.stringify({ tabs: s.tabs, activeTabId: s.activeTabId }),
      );
    }
    prev = s;
  });
}
