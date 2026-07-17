import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { errorIndexFor, type ErrorGroup } from "../lib/errors";
import { openFrame } from "../lib/editor";
import { extractJson } from "../lib/json";
import { frameLocation } from "../lib/logPresentation";
import type { Frame, SourceDef } from "../lib/types";
import { useApp } from "../store";
import { Icon } from "../ui/Icon";
import { MiniTabs } from "../ui/MiniTabs";
import { ToolButton } from "../ui/ToolButton";

// Monaco stays out of the main bundle until the JSON tab is first opened
const JsonEditor = lazy(() => import("../ui/JsonEditor"));

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();

function GroupButton({ group, active, source, onClick }: {
  group: ErrorGroup;
  active: boolean;
  source?: SourceDef;
  onClick: () => void;
}) {
  const origin = group.topFrame ? frameLocation(group.topFrame, source) : null;
  return (
    <button
      type="button"
      className={`error-group ${active ? "active" : ""}`}
      title="Show details and flash the line in the log"
      onClick={onClick}
    >
      <span className="error-group-topline">
        <span className="error-group-kind">{group.frames.length ? "trace" : "error"}</span>
        <span className="error-group-count">{group.count}×</span>
      </span>
      <strong>{group.message}</strong>
      <span className="error-group-meta">
        <span>{origin ? `${origin.file}:${origin.position}` : "No application frame"}</span>
        <span>{fmtTime(group.lastAt)} · #{group.lastSeq + 1}</span>
      </span>
    </button>
  );
}

function FrameRow({ frame, index, source, onOpen, onCopy }: {
  frame: Frame;
  index: number;
  source?: SourceDef;
  onOpen: (frame: Frame) => void;
  onCopy: (text: string) => void;
}) {
  const location = frameLocation(frame, source);
  return (
    <div className={`error-frame ${frame.isApp ? "app" : "runtime"}`}>
      <button
        type="button"
        className="error-frame-main"
        title={frame.isApp ? `Open ${location.full} · ⌥click copies` : `Copy ${location.full}`}
        onClick={(event) => {
          if (!frame.isApp || event.altKey) onCopy(location.full);
          else onOpen(frame);
        }}
      >
        <span className="error-frame-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="error-frame-content">
          <span className="error-frame-source">
            <strong>{location.file}</strong>
            <span>{location.position}</span>
          </span>
          <span className="error-frame-function">{frame.fn || "anonymous"}</span>
          <span className="error-frame-path">{location.parent || location.resolvedPath}</span>
        </span>
      </button>
      <button
        type="button"
        className="error-frame-copy"
        title={`Copy ${location.full}`}
        aria-label={`Copy source location ${location.full}`}
        onClick={() => onCopy(location.full)}
      >
        <Icon name="copy" size={12} />
      </button>
    </div>
  );
}

/** Right dock: live error groups and the latest complete stack for the active source. */
export function Inspector() {
  const activeTab = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const sourceId = activeTab?.kind === "source" ? activeTab.sourceId : undefined;
  const source = useApp((state) => state.sources.find((item) => item.id === sourceId));
  const errorVersion = useApp((state) => (sourceId ? state.errorVersions[sourceId] ?? 0 : 0));
  const showToast = useApp((state) => state.showToast);
  const jumpToLine = useApp((state) => state.jumpToLine);
  const inspectLine = useApp((state) => state.inspectLine);
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const [dockTab, setDockTab] = useState<"errors" | "json">("errors");

  const line = inspectLine?.sourceId === sourceId ? inspectLine : null;
  const pretty = useMemo(() => {
    if (!line) return null;
    const hit = extractJson(line.raw);
    return hit ? JSON.stringify(hit.value, null, 2) : null;
  }, [line]);

  // clicking a log line is a "show me this as JSON" gesture
  useEffect(() => {
    if (line) setDockTab("json");
  }, [line]);

  const snapshot = useMemo(
    () => (sourceId ? errorIndexFor(sourceId).snapshot() : { totalOccurrences: 0, groups: [] }),
    [sourceId, errorVersion],
  );
  const selected = snapshot.groups.find((group) => group.fingerprint === selectedFingerprint) ?? snapshot.groups[0];
  const origin = selected?.topFrame ? frameLocation(selected.topFrame, source) : null;
  const appFrameCount = selected?.frames.filter((frame) => frame.isApp).length ?? 0;

  useEffect(() => setSelectedFingerprint(null), [sourceId]);

  const copy = async (text: string, label: string) => {
    try {
      await writeText(text);
      showToast("Copied", label);
    } catch (error) {
      showToast("Copy failed", String(error), "err");
    }
  };

  const handleOpen = (frame: Frame) => {
    void openFrame(frame, source).then((opened) => {
      if (!opened) showToast("Copied", "Source location copied. Choose an editor in Settings to open it directly.");
    });
  };

  return (
    <aside className="inspector error-inspector">
      <div className="inspector-head">
        <MiniTabs
          tabs={[
            { id: "errors", label: `Errors${snapshot.groups.length ? ` · ${snapshot.groups.length}` : ""}` },
            { id: "json", label: "JSON" },
          ]}
          active={dockTab}
          onChange={(id) => setDockTab(id as "errors" | "json")}
        />
      </div>

      {dockTab === "json" ? (
        <div className="inspector-scroll json-dock">
          {!line ? (
            <div className="error-dock-empty">
              <span className="error-dock-empty-icon"><Icon name="braces" size={18} /></span>
              <strong>No line selected</strong>
              <p>Click a log line to view the JSON embedded in it, formatted.</p>
            </div>
          ) : (
            <>
              <div className="json-dock-head">
                <span>line #{line.seq + 1}{pretty ? "" : " · no JSON found"}</span>
                <ToolButton
                  iconOnly
                  title={pretty ? "Copy formatted JSON" : "Copy raw line"}
                  aria-label="Copy"
                  onClick={() => void copy(pretty ?? line.raw, pretty ? "Formatted JSON." : "Raw line.")}
                >
                  <Icon name="copy" size={13} />
                </ToolButton>
              </div>
              {pretty ? (
                <div className="json-dock-editor">
                  <Suspense fallback={<div className="empty-note" style={{ padding: 12 }}>Loading editor…</div>}>
                    <JsonEditor value={pretty} />
                  </Suspense>
                </div>
              ) : (
                <pre className="json-dock-raw">{line.raw}</pre>
              )}
            </>
          )}
        </div>
      ) : (
      <div className="inspector-scroll error-dock">
        {snapshot.groups.length === 0 ? (
          <div className="error-dock-empty">
            <span className="error-dock-empty-icon"><Icon name="zap" size={18} /></span>
            <strong>No errors yet</strong>
            <p>The center stays raw. Parsed errors, stack frames, and source actions appear here.</p>
          </div>
        ) : (
          <>
            <div className="error-group-list" aria-label="Error groups">
              {snapshot.groups.map((group) => (
                <GroupButton
                  key={group.fingerprint}
                  group={group}
                  active={group.fingerprint === selected?.fingerprint}
                  source={source}
                  onClick={() => {
                    setSelectedFingerprint(group.fingerprint);
                    if (sourceId) jumpToLine(sourceId, group.lastSeq);
                  }}
                />
              ))}
            </div>

            {selected && (
              <section className="error-detail" aria-label={selected.frames.length ? "Latest stack trace" : "Latest error occurrence"}>
                <div className="error-detail-head">
                  <div>
                    <span>Selected error</span>
                    <strong>latest #{selected.lastSeq + 1} · {selected.count}×</strong>
                  </div>
                  <div className="error-detail-actions">
                    <ToolButton
                      iconOnly
                      title="Flash the latest occurrence in the log"
                      aria-label="Jump to line in log"
                      onClick={() => sourceId && jumpToLine(sourceId, selected.lastSeq)}
                    >
                      <Icon name="status" size={13} />
                    </ToolButton>
                    <ToolButton title={selected.frames.length ? "Copy the complete latest stack trace" : "Copy the complete raw error"} onClick={() => void copy(selected.rawLines.join("\n"), selected.frames.length ? `Full stack trace · ${selected.rawLines.length} lines.` : "Complete raw error line.")}>
                      <Icon name="copy" size={13} /> {selected.frames.length ? "Copy trace" : "Copy error"}
                    </ToolButton>
                  </div>
                </div>
                <p className="error-detail-message">{selected.message}</p>
                <p className="error-detail-when">
                  first {fmtTime(selected.firstAt)} · last {fmtTime(selected.lastAt)}
                  {selected.count > 1 ? ` · ${selected.count} occurrences` : ""}
                </p>
                {selected.topFrame && origin && (
                  <div className="error-origin">
                    <div className="error-origin-copy">
                      <span>Application origin</span>
                      <strong>{origin.file}<em>{origin.position}</em></strong>
                      <small>{selected.topFrame.fn || "anonymous"}</small>
                      <code>{origin.parent || origin.resolvedPath}</code>
                    </div>
                    <div className="error-origin-actions">
                      <ToolButton className="error-origin-open" title={`Open ${origin.full}`} onClick={() => handleOpen(selected.topFrame!)}>
                        <Icon name="code" size={13} /> Open origin
                      </ToolButton>
                      <ToolButton iconOnly title={`Copy ${origin.full}`} aria-label="Copy application origin" onClick={() => void copy(origin.full, "Application origin copied.")}>
                        <Icon name="copy" size={13} />
                      </ToolButton>
                    </div>
                  </div>
                )}
                {selected.rawLines.length > 0 && (
                  <details className="error-raw">
                    <summary>Raw output · {selected.rawLines.length} line{selected.rawLines.length === 1 ? "" : "s"}</summary>
                    <pre>{selected.rawLines.join("\n")}</pre>
                  </details>
                )}
                {selected.frames.length > 0 && (
                  <>
                    <div className="error-stack-head">
                      <strong>Stack trace</strong>
                      <span>{appFrameCount} app · {selected.frames.length - appFrameCount} runtime</span>
                    </div>
                    <div className="error-frame-list">
                      {selected.frames.map((frame, index) => (
                        <FrameRow
                          key={`${frame.path}:${frame.line}:${frame.col ?? 0}:${index}`}
                          frame={frame}
                          index={index}
                          source={source}
                          onOpen={handleOpen}
                          onCopy={(text) => void copy(text, "Source location copied.")}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
      )}
    </aside>
  );
}
