import { describe, expect, it } from "vitest";
import { INITIAL_DOCK_TAB, dockTabNext, type DockTabState } from "./dockTab";

describe("dockTabNext", () => {
  it("starts on Overview", () => {
    expect(INITIAL_DOCK_TAB).toEqual({ tab: "overview", auto: false });
  });

  it("routes a selection to json or inspect and marks it auto", () => {
    expect(dockTabNext(INITIAL_DOCK_TAB, { type: "select", route: "json" })).toEqual({ tab: "json", auto: true });
    expect(dockTabNext(INITIAL_DOCK_TAB, { type: "select", route: "inspect" })).toEqual({ tab: "inspect", auto: true });
  });

  it("returns to Overview on deselect only from an auto-opened tab", () => {
    const auto: DockTabState = { tab: "json", auto: true };
    const manual: DockTabState = { tab: "errors", auto: false };
    expect(dockTabNext(auto, { type: "deselect" })).toEqual(INITIAL_DOCK_TAB);
    expect(dockTabNext(manual, { type: "deselect" })).toBe(manual);
  });

  it("keeps a manual tab stable until the next selection or source change", () => {
    const manual = dockTabNext({ tab: "json", auto: true }, { type: "manual", tab: "errors" });
    expect(manual).toEqual({ tab: "errors", auto: false });
    expect(dockTabNext(manual, { type: "select", route: "json" })).toEqual({ tab: "json", auto: true });
    expect(dockTabNext(manual, { type: "source-change" })).toEqual(INITIAL_DOCK_TAB);
  });
});
