import { useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { archiveFor, type ArchivedLine, type ErrorOccurrence } from "../../lib/errorArchive";
import { openLocation } from "../../lib/editor";
import { errorIndexFor } from "../../lib/errors";
import { countMatches, findMarks, lineTokens, renderSpans } from "../../lib/highlight";
import { useApp } from "../../store";
import { useKeepScroll } from "../../lib/useKeepScroll";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();

function Snippet({ occ, picks, wrap, syntax, query, onCopy, onLineClick, onPathClick }: {
  occ: ErrorOccurrence;
  picks: Set<number> | null;
  wrap: boolean;
  syntax: boolean;
  query: string;
  onCopy: (text: string) => void;
  onLineClick: (line: ArchivedLine, e: React.MouseEvent) => void;
  onPathClick: (loc: string) => void;
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
            {l.raw
              ? renderSpans(l.raw, lineTokens(l.raw, l.ansi, syntax), findMarks(l.raw, query), onPathClick)
              : " "}
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
  // hidden trace tabs unsubscribe from batches; activation flips the sentinel → one fresh paint
  const errorVersion = useApp((s) => (active ? s.errorVersions[sourceId] ?? 0 : -1));
  const bufVersion = useApp((s) => (active ? s.bufVersions[sourceId] ?? 0 : -1));
  const { showToast, setInspectLine } = useApp.getState();
  // same selection model as LogView: anchor for shift-ranges, picks for ⌘C
  const [selection, setSelection] = useState<{ anchor: number; picks: Set<number> } | null>(null);
  const [wrap, setWrap] = useState(() => localStorage.getItem("log:trace-wrap") !== "0");
  const toggleWrap = () => setWrap((v) => {
    localStorage.setItem("log:trace-wrap", v ? "0" : "1");
    return !v;
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useKeepScroll<HTMLDivElement>(active);
  // follows the source's Syntax toggle (same localStorage key LogView writes)
  const syntax = localStorage.getItem(`log:syntax:${sourceId}`) !== "0";

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

  const matchCount = useMemo(
    () => countMatches(occurrences.flatMap((occ) => occ.lines.map((l) => l.raw)), query),
    [occurrences, query],
  );
  useEffect(() => setMatchIdx(0), [query]);
  const jumpMatch = (dir: 1 | -1) => {
    const marks = scrollRef.current?.querySelectorAll("mark");
    if (!marks?.length) return;
    const next = ((matchIdx + dir) % marks.length + marks.length) % marks.length;
    setMatchIdx(next);
    marks[next].scrollIntoView({ block: "center", behavior: "smooth" });
  };

  /** tok-path click in a snippet → resolve against the source cwd and open in the editor */
  const openLoc = (loc: string) => {
    void openLocation(loc, source).then((opened) => {
      if (!opened) showToast("Copied", "Source location copied. Choose an editor in Settings to open it directly.");
    });
  };

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
      // this tab owns ⌘F while active — the dock's Errors search yields to it
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.select());
      }
      // highlighted text wins over line picks — let the native copy handle it
      if (mod && e.key.toLowerCase() === "c" && selection?.picks.size && !inInput && !window.getSelection()?.toString()) {
        e.preventDefault();
        const raws = [...selection.picks].sort((a, b) => a - b)
          .map((seq) => linesBySeq.get(seq)?.raw)
          .filter((r): r is string => r !== undefined);
        void copy(raws.join("\n"), `${raws.length} selected line${raws.length === 1 ? "" : "s"}.`);
      }
      if (e.key === "Escape" && !inInput) {
        if (searchOpen) {
          setSearchOpen(false);
          setQuery("");
        } else if (selection) {
          setSelection(null);
          publishLine(null);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selection, linesBySeq, searchOpen]);

  return (
    <section className={`content trace-view ${active ? "active" : ""}`}>
      <div className="trace-scroll" ref={scrollRef}>
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
              iconOnly
              title="Search (⌘F)"
              aria-label="Search"
              onClick={() => {
                setSearchOpen(true);
                requestAnimationFrame(() => searchInputRef.current?.select());
              }}
            >
              <Icon name="search" size={13} />
            </ToolButton>
            <ToolButton
              iconOnly
              title={wrap ? "Disable snippet wrap" : "Wrap long snippet lines"}
              aria-label="Toggle wrap"
              aria-pressed={wrap}
              className={wrap ? "active" : ""}
              onClick={toggleWrap}
            >
              <Icon name="wrap-text" size={13} />
            </ToolButton>
            {group && (
              <ToolButton
                iconOnly
                title={group.frames.length ? "Copy the complete latest stack trace" : "Copy the complete raw error"}
                aria-label="Copy latest occurrence"
                onClick={() => void copy(group.rawLines.join("\n"), "Latest raw occurrence.")}
              >
                <Icon name="copy" size={13} />
              </ToolButton>
            )}
          </div>
        </header>

        {searchOpen && (
          <div className="log-search trace-search">
            <Icon name="search" size={13} />
            <input
              ref={searchInputRef}
              value={query}
              placeholder="Find in trace…"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpMatch(e.shiftKey ? -1 : 1);
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  setQuery("");
                }
              }}
            />
            <span className="log-search-count">
              {query ? (matchCount ? `${matchIdx + 1}/${matchCount}` : "0") : ""}
            </span>
          </div>
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
                syntax={syntax}
                query={query}
                onCopy={(text) => void copy(text, "Snippet copied.")}
                onLineClick={onLineClick}
                onPathClick={openLoc}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
