export type DockTab = "overview" | "inspect" | "json" | "errors";

export interface DockTabState {
  tab: DockTab;
  /** true when the dock opened this tab itself (line selection) — deselect may undo it */
  auto: boolean;
}

export type DockTabEvent =
  | { type: "select"; route: "json" | "inspect" }
  | { type: "deselect" }
  | { type: "manual"; tab: DockTab }
  | { type: "source-change" };

export const INITIAL_DOCK_TAB: DockTabState = { tab: "overview", auto: false };

export function dockTabNext(state: DockTabState, event: DockTabEvent): DockTabState {
  switch (event.type) {
    case "select":
      return { tab: event.route, auto: true };
    case "deselect":
      return state.auto ? INITIAL_DOCK_TAB : state;
    case "manual":
      return { tab: event.tab, auto: false };
    case "source-change":
      return INITIAL_DOCK_TAB;
  }
}
