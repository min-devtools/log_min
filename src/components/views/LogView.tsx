import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { Combobox } from "../../ui/Combobox";
import { SectionVeil } from "../../ui/SectionVeil";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { runtimeOf, useApp } from "../../store";
import { bufferFor } from "../../lib/ring";
import { openLocation } from "../../lib/editor";
import { copyTextForLines } from "../../lib/errors";
import { lineTokens, renderSpans } from "../../lib/highlight";
import { insightIndexFor } from "../../lib/insight";
import { LiveFilter } from "../../lib/liveFilter";
import { saveText } from "../../lib/logmin";
import { rawLogText } from "../../lib/logPresentation";
import { estimateLogRowHeight } from "../../lib/wrapLayout";
import { sourceIcon } from "../../lib/types";
import type { LogLevel, LogLine } from "../../lib/types";

const OVERSCAN = 20;
const COLLAPSE_LEN = 1200;
const PREVIEW_LEN = 200;

const isJsonLike = (raw: string) => /^\s*[\[{]/.test(raw);
const previewText = (raw: string) => raw.slice(0, Math.min(raw.length, PREVIEW_LEN)) + "…";

/** row height in px, derived from the app font size (mono line + padding) */
function useRowHeight(): number {
  const uiFontSize = useApp((s) => s.uiFontSize);
  return Math.round(uiFontSize * 1.55);
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US").replace(/,/g, " ");
}

/** 5000 → "5k"; non-round values stay plain numbers */
function fmtCapValue(n: number): string {
  return n % 1000 === 0 ? `${n / 1000}k` : String(n);
}

/** "5k" | "5K" | "5000" → 5000; anything unparsable → null */
function parseCap(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*k?\s*$/i.exec(text);
  if (!m) return null;
  const n = /k\s*$/i.test(text) ? Number(m[1]) * 1000 : Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

interface Props {
  tabId: string;
  sourceId: string;
  active: boolean;
}

export function LogView({ sourceId, active }: Props) {
  const def = useApp((s) => s.sources.find((x) => x.id === sourceId));
  // narrow runtime pick: counter-only batch updates must not re-render the view
  const rt = useApp(
    useShallow((s) => {
      const r = runtimeOf(s, sourceId);
      return { status: r.status, exitCode: r.exitCode, error: r.error, startedAt: r.startedAt };
    }),
  );
  // hidden tabs unsubscribe from batches; activation flips the sentinel → one fresh paint
  const version = useApp((s) => (active ? s.bufVersions[sourceId] ?? 0 : -1));
  // actions are stable — getState() avoids subscribing to the whole store
  const { startSource, stopSource, sendStdin, showToast, editSource, setInspectLine } = useApp.getState();

  const ring = bufferFor(sourceId);
  const rowH = useRowHeight();
  const uiFontSize = useApp((s) => s.uiFontSize);
  // the Errors dock owns ⌘F for its own in-tab search while it's the visible dock tab
  const dockTab = useApp((s) => s.dockTab.tab);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(() => localStorage.getItem(`log:wrap:${sourceId}`) !== "0");
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
  /** live filter: the view shows only matching lines, updated per batch */
  const [filterMode, setFilterMode] = useState(false);
  /** level quick-filter chips (Err / Warn); empty = all levels */
  const [levelFilter, setLevelFilter] = useState<ReadonlySet<LogLevel>>(new Set());
  /** search hits as line seqs — ring indexes shift on eviction, seqs don't */
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIdx, setMatchIdx] = useState(0);
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const [stdinValue, setStdinValue] = useState("");
  const [capValue, setCapValue] = useState("");
  const [expandedSeqs, setExpandedSeqs] = useState<Set<number>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** scroll position preserved when the tab is hidden via display:none */
  const savedScrollTop = useRef(0);

  const isCollapsed = (l: LogLine) =>
    l.raw.length > COLLAPSE_LEN && isJsonLike(l.raw) && !expandedSeqs.has(l.seq);

  // per-source retained-line budget — applied to the ring on mount, persisted on commit
  useEffect(() => {
    const stored = parseCap(localStorage.getItem(`log:cap:${sourceId}`) ?? "");
    if (stored) ring.setCap(stored);
    setCapValue(fmtCapValue(ring.capacity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  const commitCap = useCallback(
    (text: string) => {
      const parsed = parseCap(text);
      if (parsed) {
        ring.setCap(parsed);
        localStorage.setItem(`log:cap:${sourceId}`, String(ring.capacity));
        useApp.getState().onBatch(sourceId, 0, 0, 0); // repaint the (possibly evicted) window
      }
      setCapValue(fmtCapValue(ring.capacity));
    },
    [ring, sourceId],
  );

  const clearBuffer = useCallback(() => {
    // captured errors (index + archive) survive by design — only the raw buffer resets
    ring.clear();
    insightIndexFor(sourceId).clear();
    liveFilterRef.current.reset();
    setSelection(null);
    setMatches([]);
    useApp.getState().onBufferCleared(sourceId);
  }, [ring, sourceId]);

  // incremental live filter — each batch scans only the new lines
  const filterQ = searchOpen && filterMode ? query.trim() : "";
  const filterActive = !!filterQ || levelFilter.size > 0;
  const liveFilterRef = useRef(new LiveFilter());
  const viewIdx = useMemo(
    () =>
      filterActive
        ? liveFilterRef.current.update(ring, { query: filterQ, caseSensitive, regex: regexMode, levels: levelFilter })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterActive, filterQ, caseSensitive, regexMode, levelFilter, version, ring],
  );
  const viewLen = viewIdx ? viewIdx.length : ring.length;
  const lineAt = (i: number) => ring.at(viewIdx ? viewIdx[i] : i);

  const wrappedVirtualizer = useVirtualizer({
    count: viewLen,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateLogRowHeight(lineAt(index)?.raw ?? "", viewportWidth, uiFontSize),
    getItemKey: (index) => lineAt(index)?.seq ?? index,
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
      viewLen,
      Math.ceil((el.scrollTop + el.clientHeight) / rowH) + OVERSCAN,
    );
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
  }, [viewLen, rowH, wrap]);

  // restore scroll position when returning to a tab that was hidden via display:none
  useEffect(() => {
    if (!active) {
      savedScrollTop.current = scrollRef.current?.scrollTop ?? 0;
      return;
    }
    const el = scrollRef.current;
    if (!el || followRef.current) return;
    // give the wrapped virtualizer one frame to remeasure before restoring
    const raf = requestAnimationFrame(() => {
      if (followRef.current) return;
      if (wrap) {
        wrappedVirtualizer.scrollToOffset(savedScrollTop.current, { align: "start" });
      } else {
        el.scrollTop = savedScrollTop.current;
      }
      computeRange();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, computeRange, wrap, wrappedVirtualizer]);

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
    savedScrollTop.current = top;
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
    // no manual virtualizer.measure() here: the virtualizer's own ResizeObserver
    // already re-measured the rendered rows when the viewport reflowed; clearing
    // its cache afterwards would strand every row on stale width estimates (gaps)
    if (followRef.current && ring.length) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [wrap, viewportWidth, uiFontSize, computeRange, ring]);

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
      const seqs: number[] = [];
      for (const i of idxs) {
        const line = ring.at(i);
        if (line) seqs.push(line.seq);
      }
      setMatches(seqs);
      setMatchIdx(0);
      if (seqs.length) jumpToSeq(seqs[0]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [ring, version, caseSensitive, regexMode],
  );

  const jumpToIndex = (i: number) => {
    const el = scrollRef.current;
    const line = lineAt(i); // view index — identical to ring index outside filter mode
    if (!el || !line) return;
    setFollow(false);
    pausedAtRef.current = ring.totalSeen;
    if (wrap) wrappedVirtualizer.scrollToIndex(i, { align: "center" });
    else el.scrollTop = Math.max(0, i * rowH - el.clientHeight / 2);
    setFlashSeq(line.seq);
    window.setTimeout(() => setFlashSeq((s) => (s === line.seq ? null : s)), 900);
    if (!wrap) computeRange();
  };

  /** seq → current view index → scroll; evicted or filtered-out seqs are skipped */
  const jumpToSeq = (seq: number) => {
    const ringIdx = ring.indexOfSeq(seq);
    if (ringIdx < 0) return;
    const i = viewIdx ? viewIdx.indexOf(ringIdx) : ringIdx;
    if (i >= 0) jumpToIndex(i);
  };

  const jumpMatch = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(next);
    jumpToSeq(matches[next]);
  };

  // eviction while search is open: drop seqs that left the ring so ↵ never lands wrong
  useEffect(() => {
    const start = ring.startSeq;
    if (!matches.length || matches[0] >= start) return;
    const next = matches.filter((s) => s >= start);
    setMatches(next);
    setMatchIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
  }, [version, matches, ring]);

  // debounce re-search while typing; filter mode owns the view instead
  useEffect(() => {
    if (!searchOpen) return;
    if (filterMode) {
      setMatches([]);
      return;
    }
    const t = window.setTimeout(() => runSearch(query), 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchOpen, caseSensitive, regexMode, filterMode]);

  // auto-expand long JSON lines that are search matches so highlights are visible
  useEffect(() => {
    if (!matches.length) return;
    setExpandedSeqs((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const seq of matches) {
        if (!next.has(seq)) {
          const line = ring.at(ring.indexOfSeq(seq));
          if (line && line.raw.length > COLLAPSE_LEN && isJsonLike(line.raw)) {
            next.add(seq);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [matches, ring]);

  // error dock clicked a group — scroll to the line and flash it
  const jumpTarget = useApp((s) => s.jumpTarget);
  const jumpSeen = useRef(0);
  useEffect(() => {
    if (!active || !jumpTarget || jumpTarget.nonce === jumpSeen.current) return;
    if (jumpTarget.sourceId !== sourceId) return;
    jumpSeen.current = jumpTarget.nonce;
    jumpToSeq(jumpTarget.seq);
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

  const exportBuffer = useCallback(async () => {
    if (!ring.length) return;
    const path = await save({ defaultPath: `${def?.name ?? "buffer"}.log` });
    if (!path) return;
    try {
      await saveText(path, copyTextForLines(ring.slice(0, ring.length)));
      showToast("Saved", `${fmtInt(ring.length)} lines → ${path.split("/").pop()}`);
    } catch (err) {
      showToast("Save failed", String(err), "err");
    }
  }, [ring, def?.name, showToast]);

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
      if (mod && e.key.toLowerCase() === "f" && dockTab !== "errors") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.select());
      }
      // highlighted text wins over line picks — let the native copy handle it
      if (mod && e.key.toLowerCase() === "c" && selection && !inInput && !window.getSelection()?.toString()) {
        e.preventDefault();
        void copySelection();
      }
      // literal Ctrl+L (not ⌘L) clears the buffer, terminal-style; errors are kept
      if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "l" && !inInput) {
        e.preventDefault();
        clearBuffer();
      }
      if (e.key === "Escape" && !inInput) {
        if (searchOpen) setSearchOpen(false);
        else if (selection) {
          setSelection(null);
          publishLine(null);
        }
      }
      // F8 / ⇧F8 step to the next/previous error line (err level or trace head)
      if (!inInput && e.key === "F8" && viewLen > 0) {
        e.preventDefault();
        const dir: 1 | -1 = e.shiftKey ? -1 : 1;
        const curRing = selection ? ring.indexOfSeq(selection.anchor) : -1;
        const curView = viewIdx ? (curRing >= 0 ? viewIdx.indexOf(curRing) : -1) : curRing;
        let i = curView < 0 ? (dir === 1 ? 0 : viewLen - 1) : curView + dir;
        for (; i >= 0 && i < viewLen; i += dir) {
          const line = lineAt(i);
          if (line && (line.level === "err" || line.traceStart)) {
            setSelection({ anchor: line.seq, picks: new Set([line.seq]) });
            publishLine(line);
            jumpToIndex(i);
            break;
          }
        }
      }
      // ↑/↓ walk the (possibly filtered) view; the dock follows the selection
      if (!inInput && !mod && !e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && viewLen > 0) {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const curRing = selection ? ring.indexOfSeq(selection.anchor) : -1;
        const curView = viewIdx ? (curRing >= 0 ? viewIdx.indexOf(curRing) : -1) : curRing;
        const i = curView < 0 ? (dir === 1 ? 0 : viewLen - 1) : Math.max(0, Math.min(viewLen - 1, curView + dir));
        const line = lineAt(i);
        if (!line) return;
        setFollow(false);
        pausedAtRef.current = ring.totalSeen;
        setSelection({ anchor: line.seq, picks: new Set([line.seq]) });
        publishLine(line);
        const el = scrollRef.current;
        if (wrap) wrappedVirtualizer.scrollToIndex(i);
        else if (el) {
          const top = i * rowH;
          if (top < el.scrollTop) el.scrollTop = top;
          else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight;
          computeRange();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selection, copySelection, searchOpen, clearBuffer, publishLine, viewIdx, viewLen, wrap, rowH, computeRange, dockTab]);

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

  const total = viewLen;
  const lines = viewIdx
    ? viewIdx.slice(range[0], range[1]).map((i) => ring.at(i)).filter((l): l is LogLine => !!l)
    : ring.slice(range[0], range[1]);
  const picks = selection?.picks;
  const selectedCount = picks?.size ?? 0;
  const qRaw = searchOpen ? query.trim() : "";
  const q = caseSensitive ? qRaw : qRaw.toLowerCase();
  const wrappedItems = wrap ? wrappedVirtualizer.getVirtualItems() : [];
  const currentMatchSeq = matches.length ? matches[matchIdx] : -1;

  // per-render line matcher — substring or regex, mirrors ring.search
  let regexInvalid = false;
  let lineRe: RegExp | null = null;
  let gRe: RegExp | null = null;
  if (qRaw && regexMode) {
    try {
      lineRe = new RegExp(qRaw, caseSensitive ? "" : "i");
      gRe = new RegExp(qRaw, caseSensitive ? "g" : "gi");
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
      if (!gRe) return [];
      gRe.lastIndex = 0; // shared per-render regex — rewind between rows
      for (let k = 0, m = gRe.exec(text); m && k < 400; m = gRe.exec(text), k++) {
        if (m[0] === "") {
          gRe.lastIndex++; // zero-width match — step forward or loop forever
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

  /** tok-path click → resolve against the source cwd and open in the editor */
  const openLoc = (loc: string) => {
    void openLocation(loc, def).then((opened) => {
      if (!opened) showToast("Copied", "Source location copied. Choose an editor in Settings to open it directly.");
    });
  };

  /** token spans + search <mark>s in one walk — rendered rows only, so cheap */
  const renderRaw = (text: string, isMatch: boolean, ansi?: LogLine["ansi"]): React.ReactNode =>
    renderSpans(text, lineTokens(text, ansi, syntax), isMatch ? matchRanges(text) : [], openLoc);

  const renderLogLine = (
    l: LogLine,
    idx: number,
    style: CSSProperties,
    measure?: (node: HTMLDivElement | null) => void,
  ) => {
    const selected = !!picks?.has(l.seq);
    const isMatch = testLine(l.raw);
    const collapsed = isCollapsed(l);
    const displayText = collapsed ? previewText(l.raw) : l.raw;
    const toggleExpanded = (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpandedSeqs((prev) => {
        const next = new Set(prev);
        if (next.has(l.seq)) next.delete(l.seq);
        else next.add(l.seq);
        return next;
      });
      if (wrap) requestAnimationFrame(() => wrappedVirtualizer.measure());
    };
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
          isMatch && l.seq === currentMatchSeq ? "current" : "",
          flashSeq === l.seq ? "flash" : "",
          collapsed ? "collapsed" : "",
        ].filter(Boolean).join(" ")}
        style={style}
        onClick={(e) => onRowClick(l, e)}
      >
        {collapsed ? (
          <span className="log-raw collapsed-preview" onClick={toggleExpanded}>
            {renderRaw(rawLogText(displayText), !!isMatch, l.ansi)}
            <span className="collapse-badge">{(l.raw.length / 1024).toFixed(1)} KB JSON</span>
          </span>
        ) : (
          <span className="log-raw">{renderRaw(rawLogText(displayText), !!isMatch, l.ansi)}</span>
        )}
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
          <Icon name={sourceIcon(def)} size={14} />
          <span className="log-toolbar-target">{def.command ?? def.url ?? def.path}</span>
        </div>
        <div className="log-toolbar-actions">
          {selectedCount > 0 && (
            <ToolButton
              iconOnly
              className="log-copy-selection"
              title={`Copy ${fmtInt(selectedCount)} selected line${selectedCount === 1 ? "" : "s"} (⌘C)`}
              aria-label="Copy selected lines"
              onClick={() => void copySelection()}
            >
              <Icon name="copy" />
            </ToolButton>
          )}
          {isCmd && !live && (
            <ToolButton
              iconOnly
              variant="primary"
              title="Start (▶)"
              aria-label="Start"
              onClick={() => void startSource(sourceId)}
            >
              <Icon name="play" />
            </ToolButton>
          )}
          {isCmd && live && (
            <>
              <ToolButton iconOnly title="Restart" aria-label="Restart" onClick={() => void startSource(sourceId)}>
                <Icon name="refresh" />
              </ToolButton>
              <ToolButton iconOnly title="Stop (kills the whole process tree)" aria-label="Stop" onClick={() => void stopSource(sourceId)}>
                <Icon name="stop" />
              </ToolButton>
            </>
          )}
          {!isCmd && (
            <ToolButton
              iconOnly
              title={live ? "Stop" : def.kind === "http" ? "Start streaming" : "Start tailing"}
              aria-label={live ? "Stop" : def.kind === "http" ? "Stream" : "Tail"}
              onClick={() => void (live ? stopSource(sourceId) : startSource(sourceId))}
            >
              <Icon name={live ? "stop" : "play"} />
            </ToolButton>
          )}
          <ToolButton
            iconOnly
            title={follow ? "Pause follow (⌘↵)" : "Resume follow (⌘↵)"}
            aria-label="Toggle follow"
            aria-pressed={follow}
            className={`log-view-toggle ${follow ? "active" : ""}`}
            onClick={() => (follow ? setFollow(false) : resumeFollow())}
          >
            <Icon name="arrow-down" />
          </ToolButton>
          <ToolButton
            iconOnly
            title={wrap ? "Disable live wrap" : "Wrap long log lines"}
            aria-label="Toggle live wrap"
            aria-pressed={wrap}
            className={`log-view-toggle ${wrap ? "active" : ""}`}
            onClick={() => setWrap((value) => !value)}
          >
            <Icon name="wrap-text" />
          </ToolButton>
          {(["err", "warn"] as const).map((lv) => (
            <ToolButton
              key={lv}
              iconOnly
              title={levelFilter.has(lv) ? "Show all levels again" : `Show only ${lv === "err" ? "error" : "warning"} lines (live)`}
              aria-label={`Filter ${lv} lines`}
              aria-pressed={levelFilter.has(lv)}
              className={`log-view-toggle lv-chip-${lv} ${levelFilter.has(lv) ? "active" : ""}`}
              onClick={() =>
                setLevelFilter((cur) => {
                  const next = new Set(cur);
                  if (next.has(lv)) next.delete(lv);
                  else next.add(lv);
                  return next;
                })
              }
            >
              <Icon name={lv === "err" ? "alert-circle" : "alert-triangle"} />
            </ToolButton>
          ))}
          <ToolButton
            iconOnly
            title={syntax ? "Disable syntax colors" : "Color strings, numbers, keys and brackets"}
            aria-label="Toggle syntax colors"
            aria-pressed={syntax}
            className={`log-view-toggle ${syntax ? "active" : ""}`}
            onClick={() => setSyntax((value) => !value)}
          >
            <Icon name="sparkles" />
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
          <div className="log-cap" title="Lines kept in the buffer (100–100k). Type a number or pick a preset; 5k = 5000.">
            <Combobox
              value={capValue}
              freeText
              options={[
                { value: "1k", hint: "1 000 lines" },
                { value: "5k", hint: "5 000 lines" },
                { value: "10k", hint: "10 000 lines" },
                { value: "50k", hint: "50 000 lines" },
                { value: "100k", hint: "100 000 lines" },
              ]}
              onChange={commitCap}
            />
          </div>
          <ToolButton iconOnly title="Save the retained buffer to a file" aria-label="Save buffer to file" onClick={() => void exportBuffer()}>
            <Icon name="download" />
          </ToolButton>
          <ToolButton iconOnly title="Clear buffer (Ctrl+L) — captured errors are kept" aria-label="Clear buffer" onClick={clearBuffer}>
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
            placeholder={
              filterMode
                ? "Filter — only matching lines, live…"
                : regexMode
                  ? "Find in buffer (regex)…"
                  : "Find in buffer…"
            }
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpMatch(e.shiftKey ? -1 : 1);
              if (e.key === "Escape") setSearchOpen(false);
            }}
          />
          <span className="log-search-count" title={regexInvalid ? "Invalid regular expression" : undefined}>
            {regexInvalid
              ? "bad regex"
              : viewIdx
                ? `${fmtInt(viewLen)} line${viewLen === 1 ? "" : "s"}`
                : matches.length
                  ? `${matchIdx + 1}/${matches.length >= 5_000 ? "5 000+" : matches.length}`
                  : query
                    ? "0"
                    : ""}
          </span>
          <ToolButton
            iconOnly
            title="Live filter — show only matching lines, including new output"
            aria-label="Live filter"
            aria-pressed={filterMode}
            className={`log-search-case ${filterMode ? "active" : ""}`}
            onClick={() => setFilterMode((v) => !v)}
          >
            <Icon name="filter" size={13} />
          </ToolButton>
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
          <ToolButton iconOnly disabled={filterMode} title="Previous match (⇧↵)" aria-label="Previous match" onClick={() => jumpMatch(-1)}>
            <Icon name="arrow-left" />
          </ToolButton>
          <ToolButton iconOnly disabled={filterMode} title="Next match (↵)" aria-label="Next match" onClick={() => jumpMatch(1)}>
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
                const line = lineAt(item.index);
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
        {/* startup only: streaming batches clear it as soon as the first line lands */}
        <SectionVeil on={live && total === 0 && !viewIdx} label="Waiting for output…" />
        {total === 0 && !(live && !viewIdx) && (
          <div className="empty-note" style={{ padding: 24 }}>
            {viewIdx
              ? filterQ
                ? `No lines match “${filterQ}”. New matching output will appear here.`
                : "No matching lines yet. New matching output will appear here."
              : isCmd
                ? "Press Start to run the command."
                : def.kind === "http"
                  ? "Press Stream to start polling the URL."
                  : "Press Tail to start following the file."}
          </div>
        )}
      </div>

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
