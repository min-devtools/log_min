import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { INITIAL_DOCK_TAB, dockTabNext, type DockTab, type DockTabEvent } from "../lib/dockTab";
import { errorIndexFor } from "../lib/errors";
import { shouldAutoRouteJson } from "../lib/json";
import { useApp } from "../store";
import { MiniTabs } from "../ui/MiniTabs";
import { ErrorsPanel } from "./inspector/ErrorsPanel";
import { InspectPanel } from "./inspector/InspectPanel";
import { JsonPanel } from "./inspector/JsonPanel";
import { OverviewPanel } from "./inspector/OverviewPanel";

/** Right dock: Overview / Inspect / JSON / Errors for the active source. */
export function Inspector() {
  const activeTab = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  // error-trace tabs belong to a source too — keep the dock (JSON / Inspect / Errors) alive there
  const sourceId =
    activeTab?.kind === "source" || activeTab?.kind === "error-trace" ? activeTab.sourceId : undefined;
  const source = useApp((state) => state.sources.find((item) => item.id === sourceId));
  const errorVersion = useApp((state) => (sourceId ? state.errorVersions[sourceId] ?? 0 : 0));
  const inspectLine = useApp((state) => state.inspectLine);
  const showToast = useApp((state) => state.showToast);
  const jumpToLine = useApp((state) => state.jumpToLine);
  const openErrorTab = useApp((state) => state.openErrorTab);

  const [dock, setDock] = useState(INITIAL_DOCK_TAB);
  const dispatch = (event: DockTabEvent) => setDock((state) => dockTabNext(state, event));

  const line = inspectLine?.sourceId === sourceId ? inspectLine : null;

  useEffect(() => {
    setDock(INITIAL_DOCK_TAB);
  }, [sourceId]);

  // a plain click routes the dock; clearing the last selection returns to Overview.
  // keyed on object identity: every explicit gesture publishes a fresh snapshot,
  // so re-publishing the same seq (e.g. the {} button) still re-routes
  useEffect(() => {
    if (line) dispatch({ type: "select", route: shouldAutoRouteJson(line.raw) ? "json" : "inspect" });
    else dispatch({ type: "deselect" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line]);

  const snapshot = useMemo(
    () => (sourceId ? errorIndexFor(sourceId).snapshot() : { totalOccurrences: 0, groups: [] }),
    [sourceId, errorVersion],
  );

  const copy = async (text: string, label: string) => {
    try {
      await writeText(text);
      showToast("Copied", label);
    } catch (error) {
      showToast("Copy failed", String(error), "err");
    }
  };
  const handleCopy = (text: string, label: string) => void copy(text, label);

  return (
    <aside className="inspector error-inspector">
      <div className="inspector-head">
        <MiniTabs
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "inspect", label: "Inspect" },
            { id: "json", label: "JSON" },
            { id: "errors", label: `Errors${snapshot.groups.length ? ` · ${snapshot.groups.length}` : ""}` },
          ]}
          active={dock.tab}
          onChange={(id) => dispatch({ type: "manual", tab: id as DockTab })}
        />
      </div>

      {dock.tab === "overview" && sourceId && (
        <OverviewPanel
          sourceId={sourceId}
          source={source}
          groups={snapshot.groups}
          onShowError={(group) => openErrorTab(sourceId, group.fingerprint, group.message)}
        />
      )}
      {dock.tab === "inspect" && (
        <InspectPanel line={line} onCopy={handleCopy} onJump={(seq) => sourceId && jumpToLine(sourceId, seq)} />
      )}
      {dock.tab === "json" && <JsonPanel line={line} onCopy={handleCopy} />}
      {dock.tab === "errors" && <ErrorsPanel sourceId={sourceId} source={source} snapshot={snapshot} />}
    </aside>
  );
}
