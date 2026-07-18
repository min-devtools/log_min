import { useEffect, useMemo } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { DockTab } from "../lib/dockTab";
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

  const dock = useApp((state) => state.dockTab);
  const dispatch = useApp((state) => state.dispatchDockTab);

  const line = inspectLine?.sourceId === sourceId ? inspectLine : null;
  // an error-trace tab always shows its stack in the Errors dock, expanded
  const errorTabId = activeTab?.kind === "error-trace" ? activeTab.id : null;
  const autoExpandFingerprint = activeTab?.kind === "error-trace" ? activeTab.fingerprint : undefined;

  useEffect(() => {
    dispatch({ type: "source-change" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  // runs after the source-change reset above so landing on an error tab always wins
  useEffect(() => {
    if (errorTabId) dispatch({ type: "manual", tab: "errors" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorTabId]);

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
      {dock.tab === "errors" && (
        <ErrorsPanel
          sourceId={sourceId}
          source={source}
          snapshot={snapshot}
          autoExpandFingerprint={autoExpandFingerprint}
        />
      )}
    </aside>
  );
}
