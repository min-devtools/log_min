import { useEffect, useRef, useState, type ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openFrame } from "../../lib/editor";
import type { ErrorGroup, ErrorSnapshot } from "../../lib/errors";
import { highlightText } from "../../lib/highlight";
import { frameLocation } from "../../lib/logPresentation";
import type { Frame, SourceDef } from "../../lib/types";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();

function locationText(group: ErrorGroup, source?: SourceDef): string | null {
  if (!group.topFrame) return null;
  const origin = frameLocation(group.topFrame, source);
  return `${origin.file}:${origin.position}`;
}

function GroupButton({ group, source, query, expanded, onOpen, onOpenFrame, onCopy }: {
  group: ErrorGroup;
  source?: SourceDef;
  query: string;
  expanded: boolean;
  onOpen: () => void;
  onOpenFrame: (frame: Frame) => void;
  onCopy: (text: string, label: string) => void;
}) {
  const loc = locationText(group, source);
  return (
    <div className={`error-group ${expanded ? "expanded" : ""}`}>
      <div className="error-group-row">
        <button
          type="button"
          className="error-group-toggle"
          title="Open this error's tab and its stack trace"
          aria-expanded={expanded}
          onClick={onOpen}
        >
          <Icon name="chevron-down" size={13} className="error-group-chevron" />
          <span className="error-group-body">
            <span className="error-group-topline">
              <span className="error-group-kind">{group.frames.length ? "trace" : "error"}</span>
              <span className="error-group-count">{group.count}×</span>
            </span>
            <strong>{highlightText(group.message, query)}</strong>
            <span className="error-group-meta">
              <span>{loc ? highlightText(loc, query) : "No application frame"}</span>
              <span>{fmtTime(group.lastAt)} · #{group.headSeq + 1}</span>
            </span>
          </span>
        </button>
      </div>
      <div className="error-group-expand">
        <div className="error-group-expand-inner">
          {group.frames.length === 0 ? (
            <p className="empty-note">No stack trace captured for this error.</p>
          ) : (
            <>
              <div className="error-group-stack-summary">
                Stack trace · {group.frames.filter((f) => f.isApp).length} app ·{" "}
                {group.frames.filter((f) => !f.isApp).length} runtime
              </div>
              <div className="trace-frame-list">
                {group.frames.map((frame, index) => {
                  const location = frameLocation(frame, source);
                  return (
                    <button
                      key={`${frame.path}:${frame.line}:${index}`}
                      type="button"
                      className={`trace-frame ${frame.isApp ? "app" : "runtime"}`}
                      title={frame.isApp ? `Open ${location.full}` : `Copy ${location.full}`}
                      onClick={() => (frame.isApp ? onOpenFrame(frame) : onCopy(location.full, "Source location."))}
                    >
                      <em>{String(index + 1).padStart(2, "0")}</em>
                      <strong>{location.file}:{location.position}</strong>
                      <span>{frame.fn || "anonymous"}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Right-dock error list: click a group to open its trace tab and expand its stack inline (exclusive). */
export function ErrorsPanel({ sourceId, source, snapshot, autoExpandFingerprint }: {
  sourceId?: string;
  source?: SourceDef;
  snapshot: ErrorSnapshot;
  /** an error-trace tab just became active — expand its group without touching manual collapses */
  autoExpandFingerprint?: string;
}): ReactNode {
  const openErrorTab = useApp((s) => s.openErrorTab);
  const clearErrors = useApp((s) => s.clearErrors);
  const openDialog = useApp((s) => s.openDialog);
  const showToast = useApp((s) => s.showToast);
  // an active error-trace center tab owns ⌘F for its own search; the dock only claims it otherwise
  const activeKind = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId)?.kind);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // exclusive: at most one group shows its stack, following the open/active error tab
  const [expanded, setExpanded] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ⌘F opens an in-dock search while this tab is mounted; LogView yields the shortcut to us (store.dockTab)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "f" && activeKind !== "error-trace") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.select());
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen, activeKind]);

  // landing on an error's dedicated tab expands its stack here and collapses the rest
  useEffect(() => {
    if (autoExpandFingerprint) setExpanded(autoExpandFingerprint);
  }, [autoExpandFingerprint]);

  /** one gesture: open (or focus) the error's tab and show its stack, exclusively */
  const openGroup = (group: ErrorGroup) => {
    setExpanded(group.fingerprint);
    if (sourceId) openErrorTab(sourceId, group.fingerprint, group.message);
  };

  const handleOpenFrame = (frame: Frame) => {
    void openFrame(frame, source).then((opened) => {
      if (!opened) showToast("Copied", "Source location copied. Choose an editor in Settings to open it directly.");
    });
  };

  const handleCopy = (text: string, label: string) => {
    void writeText(text)
      .then(() => showToast("Copied", label))
      .catch((error) => showToast("Copy failed", String(error), "err"));
  };

  const confirmClear = () => {
    if (!sourceId) return;
    void openDialog({
      kind: "confirm",
      title: "Clear captured errors?",
      message: "Captured errors live only in memory and cannot be recovered once cleared.",
      confirmLabel: "Clear",
      danger: true,
    }).then((ok) => {
      if (ok !== null) clearErrors(sourceId);
    });
  };

  const q = query.trim().toLowerCase();
  const groups = q
    ? snapshot.groups.filter((group) => {
        const loc = locationText(group, source);
        return group.message.toLowerCase().includes(q) || (loc?.toLowerCase().includes(q) ?? false);
      })
    : snapshot.groups;

  return (
    <div className="inspector-scroll error-dock">
      {searchOpen && (
        <div className="log-search">
          <Icon name="search" size={13} />
          <input
            ref={searchInputRef}
            value={query}
            placeholder="Find in errors…"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                setQuery("");
              }
            }}
          />
          <span className="log-search-count">
            {query ? `${groups.length}/${snapshot.groups.length}` : ""}
          </span>
        </div>
      )}
      {snapshot.groups.length > 0 && (
        <div className="error-dock-head">
          <span>{snapshot.groups.length} group{snapshot.groups.length === 1 ? "" : "s"} · {snapshot.totalOccurrences}×</span>
          <ToolButton
            iconOnly
            title="Clear captured errors from memory"
            aria-label="Clear captured errors"
            onClick={confirmClear}
          >
            <Icon name="trash" size={13} />
          </ToolButton>
        </div>
      )}
      {snapshot.groups.length === 0 ? (
        <div className="error-dock-empty">
          <span className="error-dock-empty-icon"><Icon name="zap" size={18} /></span>
          <strong>No errors yet</strong>
          <p>Errors are captured with ±10 lines of context and kept even when the buffer is cleared.</p>
        </div>
      ) : (
        <div className="error-group-list" aria-label="Error groups">
          {groups.map((group) => (
            <GroupButton
              key={group.fingerprint}
              group={group}
              source={source}
              query={q}
              expanded={expanded === group.fingerprint}
              onOpen={() => openGroup(group)}
              onOpenFrame={handleOpenFrame}
              onCopy={handleCopy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
