import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectionDropTarget } from "./lib/collectionDrop";
import type { CollectionDef, SourceDef } from "./lib/types";

const values = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
});

const { useApp } = await import("./store");

const collections: CollectionDef[] = [
  { id: "first", name: "First" },
  { id: "second", name: "Second" },
];

const source = (id: string, collectionId?: string): SourceDef => ({
  id,
  collectionId,
  kind: "cmd",
  name: id,
  command: `echo ${id}`,
});

describe("sidebar source reorder", () => {
  beforeEach(() => {
    useApp.setState({
      collections,
      sources: [
        source("one", "first"),
        source("two", "first"),
        source("other", "second"),
      ],
    });
  });

  it("does not publish a new sources array when the source is already in that slot", () => {
    const before = useApp.getState().sources;

    useApp.getState().moveSource("one", "first", "two");

    expect(useApp.getState().sources).toBe(before);
  });

  it("reorders within a collection without changing membership", () => {
    useApp.getState().moveSource("two", "first", "one");

    expect(useApp.getState().sources.map(({ id, collectionId }) => [id, collectionId])).toEqual([
      ["two", "first"],
      ["one", "first"],
      ["other", "second"],
    ]);
  });
});

describe("sidebar collection reorder", () => {
  beforeEach(() => {
    useApp.setState({ collections });
  });

  it("does not publish a new collections array when the collection is already in that slot", () => {
    const before = useApp.getState().collections;

    useApp.getState().reorderCollection("first", "second");

    expect(useApp.getState().collections).toBe(before);
  });

});

describe("collectionDropTarget", () => {
  const order = ["alpha", "beta", "gamma", "delta"];

  it("moves an item from below before the whole target collection", () => {
    expect(collectionDropTarget(order, "delta", "beta")).toEqual({ edge: "before", beforeId: "beta" });
  });

  it("moves an item from above after the whole target collection", () => {
    expect(collectionDropTarget(order, "alpha", "gamma")).toEqual({ edge: "after", beforeId: "delta" });
  });

  it("ignores self and missing targets", () => {
    expect(collectionDropTarget(order, "beta", "beta")).toBeNull();
    expect(collectionDropTarget(order, "missing", "beta")).toBeNull();
  });
});
