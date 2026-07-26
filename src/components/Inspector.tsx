import { useEffect, useMemo } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useShallow } from "zustand/react/shallow";
import type { DockTab } from "../lib/dockTab";
import { CONN_COLORS } from "../lib/connColor";
import { errorIndexFor } from "../lib/errors";
import { shouldAutoRouteJson } from "../lib/json";
import { useApp } from "../store";
import { MiniTabs } from "../ui/MiniTabs";
import { ErrorsPanel, type ErrorEntry } from "./inspector/ErrorsPanel";
import { InspectPanel } from "./inspector/InspectPanel";
import { JsonPanel } from "./inspector/JsonPanel";
import { OverviewPanel } from "./inspector/OverviewPanel";

const NO_MEMBERS: string[] = [];

/** Right dock: Overview / Inspect / JSON / Errors for the active source, or
 * Inspect / JSON / aggregated Errors for the active collection's combined view. */
export function Inspector() {
  const activeTab = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  // error-trace tabs belong to a source too — keep the dock (JSON / Inspect / Errors) alive there
  const sourceId =
    activeTab?.kind === "source" || activeTab?.kind === "error-trace" ? activeTab.sourceId : undefined;
  const collectionId = activeTab?.kind === "combined" ? activeTab.collectionId : undefined;
  const combined = collectionId !== undefined;
  const members = useApp(
    useShallow((state) =>
      collectionId
        ? state.sources.filter((x) => x.collectionId === collectionId).map((x) => x.id)
        : NO_MEMBERS,
    ),
  );
  const sources = useApp((state) => state.sources);
  const source = sources.find((item) => item.id === sourceId);
  const errorVersion = useApp((state) =>
    sourceId
      ? state.errorVersions[sourceId] ?? 0
      : members.reduce((n, id) => n + (state.errorVersions[id] ?? 0), 0),
  );
  const inspectLine = useApp((state) => state.inspectLine);
  const showToast = useApp((state) => state.showToast);
  const jumpToLine = useApp((state) => state.jumpToLine);
  const jumpToCombinedLine = useApp((state) => state.jumpToCombinedLine);
  const openSourceTab = useApp((state) => state.openSourceTab);
  const openErrorTab = useApp((state) => state.openErrorTab);

  const dock = useApp((state) => state.dockTab);
  const dispatch = useApp((state) => state.dispatchDockTab);

  const line = combined
    ? inspectLine && members.includes(inspectLine.sourceId)
      ? inspectLine
      : null
    : inspectLine?.sourceId === sourceId
      ? inspectLine
      : null;
  // an error-trace tab always shows its stack in the Errors dock, expanded
  const errorTabId = activeTab?.kind === "error-trace" ? activeTab.id : null;
  const autoExpandKey =
    activeTab?.kind === "error-trace" && sourceId ? `${sourceId}:${activeTab.fingerprint}` : undefined;

  const contextKey = sourceId ?? collectionId;
  useEffect(() => {
    dispatch({ type: "source-change" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

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

  // compose-style deterministic colors: member index → --conn-* token name
  const colorVarOf = (id: string) => {
    const i = members.indexOf(id);
    return i < 0 ? undefined : `var(--conn-${CONN_COLORS[i % CONN_COLORS.length]})`;
  };

  const { entries, totalOccurrences } = useMemo(() => {
    if (sourceId) {
      const snap = errorIndexFor(sourceId).snapshot();
      return {
        entries: snap.groups.map((group): ErrorEntry => ({ group, sourceId, source })),
        totalOccurrences: snap.totalOccurrences,
      };
    }
    if (!collectionId) return { entries: [] as ErrorEntry[], totalOccurrences: 0 };
    const out: ErrorEntry[] = [];
    let total = 0;
    for (const id of members) {
      const snap = errorIndexFor(id).snapshot();
      total += snap.totalOccurrences;
      const def = sources.find((x) => x.id === id);
      for (const group of snap.groups) {
        out.push({
          group,
          sourceId: id,
          source: def,
          badge: def ? { name: def.name, colorVar: colorVarOf(id) } : undefined,
        });
      }
    }
    out.sort((a, b) => b.group.lastAt - a.group.lastAt);
    return { entries: out, totalOccurrences: total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, collectionId, members, sources, errorVersion]);

  const copy = async (text: string, label: string) => {
    try {
      await writeText(text);
      showToast("Copied", label);
    } catch (error) {
      showToast("Copy failed", String(error), "err");
    }
  };
  const handleCopy = (text: string, label: string) => void copy(text, label);

  // the combined dock has no Overview — its stored tab state maps to Inspect
  const shownTab = combined && dock.tab === "overview" ? "inspect" : dock.tab;
  const lineSource = line ? sources.find((x) => x.id === line.sourceId) : undefined;

  return (
    <aside className="inspector error-inspector">
      <div className="inspector-head">
          <MiniTabs
            tabs={[
              ...(combined
                ? []
                : [{ id: "overview", label: "Overview", icon: "layout-grid", title: "Overview" } as const]),
              { id: "inspect", label: "Inspect", icon: "eye", title: "Inspect" },
              { id: "json", label: "JSON", icon: "braces", title: "JSON" },
              { id: "errors", label: "Errors", icon: "zap", title: `Errors${entries.length ? ` (${entries.length})` : ""}` },
            ]}
            active={shownTab}
            onChange={(id) => dispatch({ type: "manual", tab: id as DockTab })}
          />
      </div>

      {shownTab === "overview" && sourceId && (
        <OverviewPanel
          sourceId={sourceId}
          source={source}
          groups={entries.map((e) => e.group)}
          onShowError={(group) => openErrorTab(sourceId, group.fingerprint, group.message)}
        />
      )}
      {shownTab === "inspect" && (
        <InspectPanel
          line={line}
          onCopy={handleCopy}
          onJump={(seq) => {
            if (combined && line && collectionId) jumpToCombinedLine(collectionId, line.sourceId, seq);
            else if (sourceId) jumpToLine(sourceId, seq);
          }}
          origin={
            combined && line && lineSource
              ? { name: lineSource.name, colorVar: colorVarOf(line.sourceId) }
              : undefined
          }
          onOpenSource={
            combined && line
              ? () => {
                  openSourceTab(line.sourceId);
                  jumpToLine(line.sourceId, line.seq);
                }
              : undefined
          }
        />
      )}
      {shownTab === "json" && <JsonPanel line={line} onCopy={handleCopy} />}
      {shownTab === "errors" && (
        <ErrorsPanel
          entries={entries}
          totalOccurrences={totalOccurrences}
          clearIds={sourceId ? [sourceId] : members}
          autoExpandKey={autoExpandKey}
        />
      )}
    </aside>
  );
}
