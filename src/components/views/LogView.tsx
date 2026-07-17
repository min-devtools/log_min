import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { runtimeOf, useApp } from "../../store";
import { bufferFor } from "../../lib/ring";
import { copyTextForLines, errorIndexFor } from "../../lib/errors";
import { insightIndexFor } from "../../lib/insight";
import { rawLogText, tokenizeLogLine } from "../../lib/logPresentation";
import { estimateLogRowHeight } from "../../lib/wrapLayout";
import type { LogLine } from "../../lib/types";

const OVERSCAN = 20;

/** row height in px, derived from the app font size (mono line + padding) */
function useRowHeight(): number {
  const uiFontSize = useApp((s) => s.uiFontSize);
  return Math.round(uiFontSize * 1.55);
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US").replace(/,/g, " ");
}

interface Props {
  tabId: string;
  sourceId: string;
  active: boolean;
}

export function LogView({ sourceId, active }: Props) {
  const def = useApp((s) => s.sources.find((x) => x.id === sourceId));
  const rt = useApp((s) => runtimeOf(s, sourceId));
  const version = useApp((s) => s.bufVersions[sourceId] ?? 0);
  const { startSource, stopSource, sendStdin, showToast, editSource, setInspectLine } = useApp();

  const ring = bufferFor(sourceId);
  const rowH = useRowHeight();
  const uiFontSize = useApp((s) => s.uiFontSize);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(() => localStorage.getItem(`log:wrap:${sourceId}`) !== "1");
  const [syntax, setSyntax] = useState(() => localStorage.getItem(`log:syntax:${sourceId}`) !== "0");
  const [viewportWidth, setViewportWidth] = useState(900);
  const followRef = useRef(true);
  followRef.current = follow;
  /** totalSeen when follow was paused — drives the "↓ N new lines" pill */
  const pausedAtRef = useRef(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  /** picked line seqs; anchor = last plain click, base for shift-ranges */
  const [selection, setSelection] = useState<{ anchor: number; picks: Set<number> } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIdx, setMatchIdx] = useState(0);
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const [stdinValue, setStdinValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const wrappedVirtualizer = useVirtualizer({
    count: ring.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateLogRowHeight(ring.at(index)?.raw ?? "", viewportWidth, uiFontSize),
    getItemKey: (index) => ring.at(index)?.seq ?? index,
    overscan: 12,
    enabled: wrap && active,
    useFlushSync: false,
  });

  const isCmd = def?.kind === "cmd";
  const live = rt.status === "live";
  const exited = isCmd && rt.status === "idle" && rt.exitCode !== undefined && rt.exitCode !== null;

  useEffect(() => {
    localStorage.setItem(`log:wrap:${sourceId}`, wrap ? "1" : "0");
  }, [sourceId, wrap]);

  useEffect(() => {
    localStorage.setItem(`log:syntax:${sourceId}`, syntax ? "1" : "0");
  }, [sourceId, syntax]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(el);
    setViewportWidth(Math.max(1, el.clientWidth));
    return () => observer.disconnect();
  }, [active]);

  // ── virtual window ──────────────────────────────────────────────────────
  const computeRange = useCallback(() => {
    const el = scrollRef.current;
    if (!el || wrap) return;
    const first = Math.max(0, Math.floor(el.scrollTop / rowH) - OVERSCAN);
    const last = Math.min(
      ring.length,
      Math.ceil((el.scrollTop + el.clientHeight) / rowH) + OVERSCAN,
    );
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
  }, [ring, rowH, wrap]);

  // new batch: stick to bottom when following, always refresh the window
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (followRef.current) el.scrollTop = el.scrollHeight;
    computeRange();
  }, [version, computeRange, rowH, wrap, ring, wrappedVirtualizer]);

  /** last seen scrollTop — breaking follow needs the scroll DIRECTION, not position:
   * batches land faster than scroll events, so "not at bottom" alone is just lag */
  const lastTopRef = useRef(0);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const scrolledUp = top < lastTopRef.current - 1;
    lastTopRef.current = top;
    const atBottom = top + el.clientHeight >= el.scrollHeight - rowH;
    if (followRef.current) {
      if (scrolledUp && !atBottom) {
        // user scrolled up — never fight them
        setFollow(false);
        pausedAtRef.current = ring.totalSeen;
      } else if (!atBottom) {
        // layout grew under us (new batch, wrap re-measure) — re-stick
        el.scrollTop = el.scrollHeight;
      }
    } else if (atBottom) {
      setFollow(true);
    }
    if (!wrap) computeRange();
  }, [computeRange, ring, rowH, wrap]);

  const resumeFollow = useCallback(() => {
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (!wrap) {
      requestAnimationFrame(computeRange);
      return;
    }
    wrappedVirtualizer.measure();
    if (followRef.current && ring.length) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [wrap, viewportWidth, uiFontSize, computeRange, ring, wrappedVirtualizer]);

  // ⌘↵ from the app shell toggles follow on the active tab
  const runNonce = useApp((s) => s.runNonce);
  const runSeen = useRef(runNonce);
  useEffect(() => {
    if (runNonce !== runSeen.current) {
      runSeen.current = runNonce;
      if (active) (follow ? setFollow(false) : resumeFollow());
    }
  }, [runNonce, active, follow, resumeFollow]);

  // ── search ──────────────────────────────────────────────────────────────
  const runSearch = useCallback(
    (q: string) => {
      const idxs = ring.search(q.trim(), { caseSensitive, regex: regexMode });
      setMatches(idxs);
      setMatchIdx(0);
      if (idxs.length) jumpToIndex(idxs[0]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [ring, version, caseSensitive, regexMode],
  );

  const jumpToIndex = (i: number) => {
    const el = scrollRef.current;
    const line = ring.at(i);
    if (!el || !line) return;
    setFollow(false);
    pausedAtRef.current = ring.totalSeen;
    if (wrap) wrappedVirtualizer.scrollToIndex(i, { align: "center" });
    else el.scrollTop = Math.max(0, i * rowH - el.clientHeight / 2);
    setFlashSeq(line.seq);
    window.setTimeout(() => setFlashSeq((s) => (s === line.seq ? null : s)), 900);
    if (!wrap) computeRange();
  };

  const jumpMatch = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(next);
    jumpToIndex(matches[next]);
  };

  // debounce re-search while typing
  useEffect(() => {
    if (!searchOpen) return;
    const t = window.setTimeout(() => runSearch(query), 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchOpen, caseSensitive, regexMode]);

  // error dock clicked a group — scroll to the line and flash it
  const jumpTarget = useApp((s) => s.jumpTarget);
  const jumpSeen = useRef(0);
  useEffect(() => {
    if (!active || !jumpTarget || jumpTarget.nonce === jumpSeen.current) return;
    if (jumpTarget.sourceId !== sourceId) return;
    jumpSeen.current = jumpTarget.nonce;
    const idx = ring.indexOfSeq(jumpTarget.seq);
    if (idx >= 0) jumpToIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget, active, sourceId]);

  // ── copy & keys ─────────────────────────────────────────────────────────
  const copyText = useCallback(
    async (text: string, body: string) => {
      try {
        await writeText(text);
        showToast("Copied", body);
      } catch (err) {
        showToast("Copy failed", String(err), "err");
      }
    },
    [showToast],
  );

  const copySelection = useCallback(async () => {
    if (!selection?.picks.size) return;
    const seqs = [...selection.picks].sort((a, b) => a - b);
    const selected: LogLine[] = [];
    for (const seq of seqs) {
      const idx = ring.indexOfSeq(seq);
      if (idx >= 0) selected.push(...ring.slice(idx, idx + 1));
    }
    if (!selected.length) return;
    await copyText(copyTextForLines(selected), `${selected.length} selected line${selected.length === 1 ? "" : "s"}.`);
  }, [selection, ring, copyText]);

  const publishLine = useCallback(
    (l: LogLine | null) =>
      setInspectLine(
        l ? { sourceId, seq: l.seq, raw: l.raw, stream: l.stream, level: l.level, traceId: l.traceId } : null,
      ),
    [setInspectLine, sourceId],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inInput = (e.target as HTMLElement)?.tagName === "INPUT";
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.select());
      }
      if (mod && e.key.toLowerCase() === "c" && selection && !inInput) {
        e.preventDefault();
        void copySelection();
      }
      if (e.key === "Escape" && searchOpen && !inInput) setSearchOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, selection, copySelection, searchOpen]);

  const onRowClick = (l: LogLine, e: React.MouseEvent) => {
    // dragging to select text also fires click on mouseup — keep the selection
    if (window.getSelection()?.toString()) return;
    if (e.shiftKey && selection) {
      // extending a copy range must not re-route the dock
      const [lo, hi] = [Math.min(selection.anchor, l.seq), Math.max(selection.anchor, l.seq)];
      const picks = new Set<number>();
      for (let s = lo; s <= hi; s++) picks.add(s);
      setSelection({ anchor: selection.anchor, picks });
    } else if ((e.metaKey || e.ctrlKey) && selection) {
      // ⌘click toggles a line in/out without touching the rest — and without re-routing
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

  // ── render ──────────────────────────────────────────────────────────────
  if (!def) {
    return (
      <section className={`content log-view ${active ? "active" : ""}`}>
        <div className="empty-note" style={{ padding: 24 }}>
          This source was deleted. Close the tab.
        </div>
      </section>
    );
  }

  const total = ring.length;
  const lines = ring.slice(range[0], range[1]);
  const picks = selection?.picks;
  const selectedCount = picks?.size ?? 0;
  const newSincePause = follow ? 0 : Math.max(0, ring.totalSeen - pausedAtRef.current);
  const qRaw = searchOpen ? query.trim() : "";
  const q = caseSensitive ? qRaw : qRaw.toLowerCase();
  const wrappedItems = wrap ? wrappedVirtualizer.getVirtualItems() : [];
  const currentMatchIdx = matches.length ? matches[matchIdx] : -1;

  // per-render line matcher — substring or regex, mirrors ring.search
  let regexInvalid = false;
  let lineRe: RegExp | null = null;
  if (qRaw && regexMode) {
    try {
      lineRe = new RegExp(qRaw, caseSensitive ? "" : "i");
    } catch {
      regexInvalid = true;
    }
  }
  const testLine = (raw: string): boolean => {
    if (!qRaw) return false;
    if (regexMode) return lineRe ? lineRe.test(raw) : false;
    return (caseSensitive ? raw : raw.toLowerCase()).includes(q);
  };

  /** [start,end) of every query occurrence — sorted, non-overlapping */
  const matchRanges = (text: string): [number, number][] => {
    if (!q) return [];
    const out: [number, number][] = [];
    if (regexMode) {
      let re: RegExp;
      try {
        re = new RegExp(qRaw, caseSensitive ? "g" : "gi");
      } catch {
        return [];
      }
      for (let k = 0, m = re.exec(text); m && k < 400; m = re.exec(text), k++) {
        if (m[0] === "") {
          re.lastIndex++; // zero-width match — step forward or loop forever
          continue;
        }
        out.push([m.index, m.index + m[0].length]);
      }
    } else {
      const hay = caseSensitive ? text : text.toLowerCase();
      for (let i = hay.indexOf(q); i >= 0 && out.length < 400; i = hay.indexOf(q, i + q.length)) {
        out.push([i, i + q.length]);
      }
    }
    return out;
  };

  /** syntax token spans + search <mark>s in one walk — rendered rows only, so cheap */
  const renderRaw = (text: string, isMatch: boolean): React.ReactNode => {
    const tokens = syntax ? tokenizeLogLine(text) : [];
    const marks = isMatch ? matchRanges(text) : [];
    if (!tokens.length && !marks.length) return text;
    const nodes: React.ReactNode[] = [];
    let key = 0;
    const pushPiece = (from: number, to: number, cls?: string) => {
      let cur = from;
      for (const [ms, me] of marks) {
        if (me <= cur || ms >= to) continue;
        const s = Math.max(ms, cur);
        const e = Math.min(me, to);
        if (s > cur) nodes.push(cls ? <span key={key++} className={cls}>{text.slice(cur, s)}</span> : text.slice(cur, s));
        nodes.push(<mark key={key++}>{text.slice(s, e)}</mark>);
        cur = e;
      }
      if (cur < to) nodes.push(cls ? <span key={key++} className={cls}>{text.slice(cur, to)}</span> : text.slice(cur, to));
    };
    let pos = 0;
    for (const t of tokens) {
      pushPiece(pos, t.start);
      pushPiece(t.start, t.end, t.cls);
      pos = t.end;
    }
    pushPiece(pos, text.length);
    return nodes;
  };

  const renderLogLine = (
    l: LogLine,
    idx: number,
    style: CSSProperties,
    measure?: (node: HTMLDivElement | null) => void,
  ) => {
    const selected = !!picks?.has(l.seq);
    const isMatch = testLine(l.raw);
    return (
      <div
        key={l.seq}
        ref={measure}
        data-index={measure ? idx : undefined}
        className={[
          "log-line",
          wrap ? "wrapped" : "",
          l.level ? `lv-${l.level}` : "",
          selected ? "selected" : "",
          isMatch ? "match" : "",
          isMatch && idx === currentMatchIdx ? "current" : "",
          flashSeq === l.seq ? "flash" : "",
        ].filter(Boolean).join(" ")}
        style={style}
        onClick={(e) => onRowClick(l, e)}
      >
        <span className="log-raw">{renderRaw(rawLogText(l.raw), !!isMatch)}</span>
        {(l.raw[0] === "{" || l.raw[0] === "[") && (
          <button
            type="button"
            className="log-copy log-json"
            title="Inspect this line's JSON in the dock"
            aria-label="Inspect this line's JSON in the dock"
            onClick={(e) => {
              e.stopPropagation();
              setSelection({ anchor: l.seq, picks: new Set([l.seq]) });
              publishLine(l);
            }}
          >
            <Icon name="braces" size={12} />
          </button>
        )}
        <button
          type="button"
          className="log-copy"
          title="Copy complete raw line"
          aria-label="Copy complete raw line"
          onClick={(e) => {
            e.stopPropagation();
            void copyText(l.raw, "Complete raw line.");
          }}
        >
          <Icon name="copy" size={12} />
        </button>
      </div>
    );
  };

  return (
    <section className={`content log-view ${active ? "active" : ""}`}>
      <div className="log-toolbar">
        <div className="log-toolbar-info" title={def.command ?? def.url ?? def.path}>
          <Icon name={isCmd ? "terminal" : def.kind === "http" ? "globe" : "docs"} size={14} />
          <span className="log-toolbar-target">{def.command ?? def.url ?? def.path}</span>
        </div>
        <div className="log-toolbar-actions">
          {selectedCount > 0 && (
            <ToolButton className="log-copy-selection" title="Copy selected raw lines (⌘C)" onClick={() => void copySelection()}>
              <Icon name="copy" /> Copy {fmtInt(selectedCount)} line{selectedCount === 1 ? "" : "s"}
            </ToolButton>
          )}
          {isCmd && !live && (
            <ToolButton variant="primary" title="Start (▶)" onClick={() => void startSource(sourceId)}>
              <Icon name="play" /> Start
            </ToolButton>
          )}
          {isCmd && live && (
            <>
              <ToolButton title="Restart" onClick={() => void startSource(sourceId)}>
                <Icon name="refresh" /> Restart
              </ToolButton>
              <ToolButton title="Stop (kills the whole process tree)" onClick={() => void stopSource(sourceId)}>
                <Icon name="stop" /> Stop
              </ToolButton>
            </>
          )}
          {!isCmd && (
            <ToolButton
              title={live ? "Stop" : def.kind === "http" ? "Start streaming" : "Start tailing"}
              onClick={() => void (live ? stopSource(sourceId) : startSource(sourceId))}
            >
              <Icon name={live ? "stop" : "play"} /> {live ? "Stop" : def.kind === "http" ? "Stream" : "Tail"}
            </ToolButton>
          )}
          <ToolButton
            title={follow ? "Pause follow (⌘↵)" : "Resume follow (⌘↵)"}
            aria-label="Toggle follow"
            aria-pressed={follow}
            className={`log-view-toggle ${follow ? "active" : ""}`}
            onClick={() => (follow ? setFollow(false) : resumeFollow())}
          >
            <Icon name="arrow-down" /> {follow ? "Following" : "Paused"}
          </ToolButton>
          <ToolButton
            title={wrap ? "Disable live wrap" : "Wrap long log lines"}
            aria-label="Toggle live wrap"
            aria-pressed={wrap}
            className={`log-view-toggle ${wrap ? "active" : ""}`}
            onClick={() => setWrap((value) => !value)}
          >
            <Icon name="rows" /> Wrap
          </ToolButton>
          <ToolButton
            title={syntax ? "Disable syntax colors" : "Color strings, numbers, keys and brackets"}
            aria-label="Toggle syntax colors"
            aria-pressed={syntax}
            className={`log-view-toggle ${syntax ? "active" : ""}`}
            onClick={() => setSyntax((value) => !value)}
          >
            <Icon name="sparkles" /> Syntax
          </ToolButton>
          <ToolButton
            iconOnly
            title="Search (⌘F)"
            aria-label="Search"
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.select());
            }}
          >
            <Icon name="search" />
          </ToolButton>
          <ToolButton
            iconOnly
            title="Clear buffer"
            aria-label="Clear buffer"
            onClick={() => {
              ring.clear();
              errorIndexFor(sourceId).clear();
              insightIndexFor(sourceId).clear();
              setSelection(null);
              setMatches([]);
              useApp.getState().onBufferCleared(sourceId);
            }}
          >
            <Icon name="trash" />
          </ToolButton>
          <ToolButton iconOnly title="Edit source" aria-label="Edit source" onClick={() => editSource(sourceId)}>
            <Icon name="pencil" />
          </ToolButton>
        </div>
      </div>

      {searchOpen && (
        <div className={`log-search ${regexInvalid ? "invalid" : ""}`}>
          <Icon name="search" size={13} />
          <input
            ref={searchInputRef}
            value={query}
            placeholder={regexMode ? "Find in buffer (regex)…" : "Find in buffer…"}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpMatch(e.shiftKey ? -1 : 1);
              if (e.key === "Escape") setSearchOpen(false);
            }}
          />
          <span className="log-search-count" title={regexInvalid ? "Invalid regular expression" : undefined}>
            {regexInvalid ? "bad regex" : matches.length ? `${matchIdx + 1}/${matches.length}` : query ? "0" : ""}
          </span>
          <ToolButton
            iconOnly
            title="Match case"
            aria-label="Match case"
            aria-pressed={caseSensitive}
            className={`log-search-case ${caseSensitive ? "active" : ""}`}
            onClick={() => setCaseSensitive((v) => !v)}
          >
            Aa
          </ToolButton>
          <ToolButton
            iconOnly
            title="Regular expression"
            aria-label="Regular expression"
            aria-pressed={regexMode}
            className={`log-search-case ${regexMode ? "active" : ""}`}
            onClick={() => setRegexMode((v) => !v)}
          >
            .*
          </ToolButton>
          <ToolButton iconOnly title="Previous match (⇧↵)" aria-label="Previous match" onClick={() => jumpMatch(-1)}>
            <Icon name="arrow-left" />
          </ToolButton>
          <ToolButton iconOnly title="Next match (↵)" aria-label="Next match" onClick={() => jumpMatch(1)}>
            <Icon name="arrow-right" />
          </ToolButton>
          <ToolButton iconOnly title="Close (Esc)" aria-label="Close search" onClick={() => setSearchOpen(false)}>
            <Icon name="x" />
          </ToolButton>
        </div>
      )}

      {exited && (
        <div className={`log-exit-banner ${rt.exitCode === 0 ? "ok" : "err"}`}>
          <span>
            exited with code {rt.exitCode}
            {rt.startedAt ? ` · started ${new Date(rt.startedAt).toLocaleTimeString()}` : ""}
          </span>
          <ToolButton onClick={() => void startSource(sourceId)}>
            <Icon name="refresh" /> Restart
          </ToolButton>
        </div>
      )}
      {rt.status === "error" && rt.error && (
        <div className="log-exit-banner err">
          <span>{rt.error}</span>
          <ToolButton onClick={() => void startSource(sourceId)}>
            <Icon name="refresh" /> Retry
          </ToolButton>
        </div>
      )}

      <div className="log-scroll" ref={scrollRef} onScroll={onScroll}>
        <div
          className={`log-spacer ${wrap ? "wrapped" : ""}`}
          style={{ height: wrap ? wrappedVirtualizer.getTotalSize() : total * rowH }}
        >
          {wrap
            ? wrappedItems.map((item) => {
                const line = ring.at(item.index);
                return line
                  ? renderLogLine(
                      line,
                      item.index,
                      { transform: `translateY(${item.start}px)`, minHeight: rowH },
                      wrappedVirtualizer.measureElement,
                    )
                  : null;
              })
            : lines.map((line, offset) => {
                const idx = range[0] + offset;
                return renderLogLine(line, idx, { top: idx * rowH, height: rowH });
              })}
        </div>
        {total === 0 && (
          <div className="empty-note" style={{ padding: 24 }}>
            {live
              ? "Waiting for output…"
              : isCmd
                ? "Press Start to run the command."
                : def.kind === "http"
                  ? "Press Stream to start polling the URL."
                  : "Press Tail to start following the file."}
          </div>
        )}
      </div>

      {!follow && newSincePause > 0 && (
        <button type="button" className="log-follow-pill" onClick={resumeFollow}>
          <Icon name="arrow-down" size={13} /> {fmtInt(newSincePause)} new lines
        </button>
      )}

      {isCmd && live && (
        <div className="log-stdin">
          <Icon name="terminal" size={13} />
          <input
            value={stdinValue}
            placeholder="Send a line to stdin (↵) — for y/N prompts, not a terminal"
            spellCheck={false}
            onChange={(e) => setStdinValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && stdinValue.length) {
                void sendStdin(sourceId, stdinValue);
                setStdinValue("");
              }
            }}
          />
        </div>
      )}
    </section>
  );
}
