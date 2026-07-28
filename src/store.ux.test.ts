import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDef, TabDef } from "./lib/types";

const values = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
});
vi.stubGlobal("window", {
  clearTimeout: () => undefined,
  setTimeout: () => 1,
});

const { useApp } = await import("./store");

const source = (id: string, name = id, transient = false): SourceDef => ({
  id,
  name,
  kind: "file",
  path: `/tmp/${id}.log`,
  transient: transient || undefined,
});

const sourceTab = (id: string, name = id, transient = false): TabDef => ({
  id: `src-${id}`,
  kind: "source",
  title: name,
  icon: "docs",
  iconClass: "soft-blue",
  sourceId: id,
  transient: transient || undefined,
});

describe("source editor lifecycle", () => {
  beforeEach(() => {
    useApp.setState({
      sources: [source("one"), source("two")],
      tabs: [
        sourceTab("one"),
        { id: "source-edit", kind: "source-edit", title: "Edit Source", icon: "plus", iconClass: "soft-green" },
      ],
      activeTabId: "source-edit",
      editingSourceId: "one",
      sourceDraft: null,
      sourceEditDirty: false,
      dialog: null,
      toast: null,
    });
  });

  it("keeps a dirty source draft open until discard is confirmed", async () => {
    useApp.setState({ sourceEditDirty: true });

    useApp.getState().closeTab("source-edit");

    expect(useApp.getState().tabs.some((tab) => tab.id === "source-edit")).toBe(true);
    expect(useApp.getState().dialog?.title).toBe("Discard source changes?");

    useApp.getState().dialog?.resolve("1");
    await Promise.resolve();

    expect(useApp.getState().tabs.some((tab) => tab.id === "source-edit")).toBe(false);
    expect(useApp.getState().sourceEditDirty).toBe(false);
  });

  it("does not replace a dirty draft when another source edit is requested", () => {
    useApp.setState({ sourceEditDirty: true });

    useApp.getState().editSource("two");

    expect(useApp.getState().editingSourceId).toBe("one");
    expect(useApp.getState().activeTabId).toBe("source-edit");
    expect(useApp.getState().toast?.title).toBe("Unsaved source draft");
  });
});

describe("source identity", () => {
  it("renames the source and its tab together", () => {
    useApp.setState({
      sources: [source("one", "Old")],
      tabs: [sourceTab("one", "Old")],
      activeTabId: "src-one",
    });

    useApp.getState().renameTab("src-one", "New");

    expect(useApp.getState().sources[0].name).toBe("New");
    expect(useApp.getState().tabs[0].title).toBe("New");
  });

  it("turns a temporary file into a persistent source without leaving a temporary tab", () => {
    useApp.setState({
      sources: [source("temp", "Temp", true)],
      tabs: [sourceTab("temp", "Temp", true)],
      activeTabId: "src-temp",
    });

    useApp.getState().saveSource({ ...useApp.getState().sources[0], transient: undefined });

    expect(useApp.getState().sources[0].transient).toBeUndefined();
    expect(useApp.getState().tabs[0].transient).toBeUndefined();
  });
});
