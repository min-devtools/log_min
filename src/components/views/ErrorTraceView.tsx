import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { archiveFor, type ArchivedLine, type ErrorOccurrence } from "../../lib/errorArchive";
import { errorIndexFor } from "../../lib/errors";
import { openFrame } from "../../lib/editor";
import { frameLocation } from "../../lib/logPresentation";
import type { Frame } from "../../lib/types";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();

function Snippet({ occ, picks, wrap, onCopy, onLineClick }: {
  occ: ErrorOccurrence;
  picks: Set<number> | null;
  wrap: boolean;
  onCopy: (text: string) => void;
  onLineClick: (line: ArchivedLine, e: React.MouseEvent) => void;
}) {
  return (
    <section className="trace-occurrence">
      <div className="trace-occurrence-head">
        <strong>#{occ.firstErrSeq + 1}–#{occ.lastErrSeq + 1}</strong>
        <span>
          {fmtTime(occ.at)} · {occ.lines.length} lines{occ.truncated ? " · truncated" : ""}
          {occ.open ? " · capturing…" : ""}
        </span>
        <ToolButton
          iconOnly
          title="Copy this snippet"
          aria-label="Copy this snippet"
          onClick={() => onCopy(occ.lines.map((l) => l.raw).join("\n"))}
        >
          <Icon name="copy" size={13} />
        </ToolButton>
      </div>
      <pre className={`trace-snippet ${wrap ? "wrap" : ""}`}>
        {occ.lines.map((l) => (
          <span
            key={l.seq}
            className={`trace-line ${l.isError ? "err" : ""} ${picks?.has(l.seq) ? "sel" : ""}`}
            title="Click to inspect · ⌘click multi-select · ⇧click range · ⌘C copies picked lines"
            onClick={(e) => onLineClick(l, e)}
          >
            {l.raw || " "}
          </span>
        ))}
      </pre>
    </section>
  );
}

interface Props {
  sourceId: string;
  fingerprint: string;
  title: string;
  active: boolean;
}

/** Dedicated center tab tracing one error group: metadata, stack, captured ±10-line snippets. */
export function ErrorTraceView({ sourceId, fingerprint, title, active }: Props) {
  const source = useApp((s) => s.sources.find((x) => x.id === sourceId));
  const errorVersion = useApp((s) => s.errorVersions[sourceId] ?? 0);
  const bufVersion = useApp((s) => s.bufVersions[sourceId] ?? 0);
  const showToast = useApp((s) => s.showToast);
  const setInspectLine = useApp((s) => s.setInspectLine);
  // same selection model as LogView: anchor for shift-ranges, picks for ⌘C
  const [selection, setSelection] = useState<{ anchor: number; picks: Set<number> } | null>(null);
  const [wrap, setWrap] = useState(() => localStorage.getItem("log:trace-wrap") !== "0");
  const toggleWrap = () => setWrap((v) => {
    localStorage.setItem("log:trace-wrap", v ? "0" : "1");
    return !v;
  });

  const group = useMemo(
    () => errorIndexFor(sourceId).snapshot().groups.find((g) => g.fingerprint === fingerprint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceId, fingerprint, errorVersion],
  );
  const occurrences = useMemo(
    () => archiveFor(sourceId).forFingerprint(fingerprint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceId, fingerprint, bufVersion, errorVersion],
  );

  const copy = async (text: string, label: string) => {
    try {
      await writeText(text);
      showToast("Copied", label);
    } catch (error) {
      showToast("Copy failed", String(error), "err");
    }
  };

  // ponytail: seq-keyed across snippets — a seq reused after a source restart
  // highlights in every snippet containing it; harmless for copy
  const linesBySeq = useMemo(() => {
    const m = new Map<number, ArchivedLine>();
    for (const occ of occurrences) for (const l of occ.lines) m.set(l.seq, l);
    return m;
  }, [occurrences]);

  const publishLine = (l: ArchivedLine | null) =>
    setInspectLine(
      l ? { sourceId, seq: l.seq, raw: l.raw, stream: l.stream, level: l.level, traceId: l.traceId } : null,
    );

  const onLineClick = (l: ArchivedLine, e: React.MouseEvent) => {
    // dragging to select text also fires click on mouseup — keep the selection
    if (window.getSelection()?.toString()) return;
    if (e.shiftKey && selection) {
      const [lo, hi] = [Math.min(selection.anchor, l.seq), Math.max(selection.anchor, l.seq)];
      const picks = new Set<number>();
      for (const seq of linesBySeq.keys()) if (seq >= lo && seq <= hi) picks.add(seq);
      setSelection({ anchor: selection.anchor, picks });
    } else if ((e.metaKey || e.ctrlKey) && selection) {
      const picks = new Set(selection.picks);
      if (picks.has(l.seq)) picks.delete(l.seq);
      else picks.add(l.seq);
      setSelection(picks.size ? { anchor: l.seq, picks } : null);
      if (!picks.size) publishLine(null);
    } else {
      const deselect = selection?.picks.size === 1 && selection.picks.has(l.seq);
      setSelection(deselect ? null : { anchor: l.seq, picks: new Set([l.seq]) });
      publishLine(deselect ? null : l);
    }
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inInput = (e.target as HTMLElement)?.tagName === "INPUT";
      // highlighted text wins over line picks — let the native copy handle it
      if (mod && e.key.toLowerCase() === "c" && selection?.picks.size && !inInput && !window.getSelection()?.toString()) {
        e.preventDefault();
        const raws = [...selection.picks].sort((a, b) => a - b)
          .map((seq) => linesBySeq.get(seq)?.raw)
          .filter((r): r is string => r !== undefined);
        void copy(raws.join("\n"), `${raws.length} selected line${raws.length === 1 ? "" : "s"}.`);
      }
      if (e.key === "Escape" && selection && !inInput) {
        setSelection(null);
        publishLine(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selection, linesBySeq]);

  const handleOpen = (frame: Frame) => {
    void openFrame(frame, source).then((opened) => {
      if (!opened) showToast("Copied", "Source location copied. Choose an editor in Settings to open it directly.");
    });
  };

  const origin = group?.topFrame ? frameLocation(group.topFrame, source) : null;

  return (
    <section className={`content trace-view ${active ? "active" : ""}`}>
      <div className="trace-scroll">
        <header className="trace-head">
          <div className="trace-head-copy">
            <h2>{group?.message ?? title}</h2>
            <p>
              {source?.name ?? sourceId}
              {group ? ` · ${group.count}× · first ${fmtTime(group.firstAt)} · last ${fmtTime(group.lastAt)}` : ""}
            </p>
          </div>
          <div className="dock-actions">
            <ToolButton
              title={wrap ? "Disable snippet wrap" : "Wrap long snippet lines"}
              aria-pressed={wrap}
              className={wrap ? "active" : ""}
              onClick={toggleWrap}
            >
              <Icon name="rows" size={13} /> Wrap
            </ToolButton>
            {group && (
              <ToolButton
                title={group.frames.length ? "Copy the complete latest stack trace" : "Copy the complete raw error"}
                onClick={() => void copy(group.rawLines.join("\n"), "Latest raw occurrence.")}
              >
                <Icon name="copy" size={13} /> Copy latest
              </ToolButton>
            )}
          </div>
        </header>

        {origin && group?.topFrame && (
          <div className="trace-origin">
            <span>Application origin</span>
            <strong>{origin.file}:{origin.position}</strong>
            <code>{origin.parent || origin.resolvedPath}</code>
            <ToolButton title={`Open ${origin.full}`} onClick={() => handleOpen(group.topFrame!)}>
              <Icon name="code" size={13} /> Open origin
            </ToolButton>
          </div>
        )}

        {group && group.frames.length > 0 && (
          <details className="trace-stack">
            <summary>
              Stack trace · {group.frames.filter((f) => f.isApp).length} app ·{" "}
              {group.frames.filter((f) => !f.isApp).length} runtime
            </summary>
            <div className="trace-frame-list">
              {group.frames.map((frame, index) => {
                const location = frameLocation(frame, source);
                return (
                  <button
                    key={`${frame.path}:${frame.line}:${index}`}
                    type="button"
                    className={`trace-frame ${frame.isApp ? "app" : "runtime"}`}
                    title={frame.isApp ? `Open ${location.full}` : `Copy ${location.full}`}
                    onClick={() => (frame.isApp ? handleOpen(frame) : void copy(location.full, "Source location."))}
                  >
                    <em>{String(index + 1).padStart(2, "0")}</em>
                    <strong>{location.file}:{location.position}</strong>
                    <span>{frame.fn || "anonymous"}</span>
                  </button>
                );
              })}
            </div>
          </details>
        )}

        <div className="trace-occurrence-list">
          <h3>Captured occurrences · {occurrences.length}</h3>
          {occurrences.length === 0 ? (
            <p className="empty-note">
              No captured snippets for this error yet. Snippets record ±10 lines around each occurrence from now on.
            </p>
          ) : (
            occurrences.map((occ) => (
              <Snippet
                key={occ.id}
                occ={occ}
                picks={selection?.picks ?? null}
                wrap={wrap}
                onCopy={(text) => void copy(text, "Snippet copied.")}
                onLineClick={onLineClick}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
