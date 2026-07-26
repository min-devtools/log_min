import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
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
import { lineMatches, lineTokens, renderSpans, searchMarks } from "../../lib/highlight";
import { insightIndexFor } from "../../lib/insight";
import { LiveFilter } from "../../lib/liveFilter";
import { saveText } from "../../lib/logmin";
import { rawLogText } from "../../lib/logPresentation";
import { estimateLogRowHeight } from "../../lib/wrapLayout";
import { sourceIcon } from "../../lib/types";
import type { LogLevel, LogLine } from "../../lib/types";

// 8 rows ≈ 170px of runway each side; 20 doubled the mounted DOM for no visible gain
const OVERSCAN = 8;
const COLLAPSE_LEN = 1200;
const PREVIEW_LEN = 200;

const isJsonLike = (raw: string) => /^\s*[\[{]/.test(raw);
const previewText = (raw: string) => raw.slice(0, Math.min(raw.length, PREVIEW_LEN)) + "…";

/** token spans survive row unmount/remount — the virtual window churns rows on
 * every scroll reversal and follow-mode batch, and re-running the regex
 * tokenizer on remount was pure waste. Keyed by the immutable ring line object;
 * the string key covers every input that changes the rendered spans. */
const spanCache = new WeakMap<LogLine, { key: string; content: ReactNode }>();

/** row height in px, derived from the app font size (mono line + padding) */
function useRowHeight(): number {
  const uiFontSize = useApp((s) => s.uiFontSize);
  return Math.round(uiFontSize * 1.55);
}

/** bufVersions bumps at batch rate — 30Hz per live source, more with several.
 * Each bump is its own zustand set → its own render pass, and on a slow machine
 * those renders queue back-to-back and starve the frame budget. Subscribe
 * through an rAF gate instead: however many batches land, the view repaints at
 * most once per frame, always with the latest version. */
function useFrameVersion(sourceId: string, active: boolean): number {
  const [version, setVersion] = useState(() => useApp.getState().bufVersions[sourceId] ?? 0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let latest = useApp.getState().bufVersions[sourceId] ?? 0;
    setVersion(latest);
    const unsub = useApp.subscribe((s) => {
      const next = s.bufVersions[sourceId] ?? 0;
      if (next === latest) return;
      latest = next;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setVersion(latest);
        });
      }
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [sourceId, active]);
  return active ? version : -1;
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

interface RowProps {
  line: LogLine;
  idx: number;
  wrap: boolean;
  /** wrap: translateY offset · non-wrap: absolute top, both px */
  start: number;
  rowH: number;
  syntax: boolean;
  selected: boolean;
  current: boolean;
  flash: boolean;
  collapsed: boolean;
  qRaw: string;
  caseSensitive: boolean;
  regexMode: boolean;
  measure?: (node: HTMLDivElement | null) => void;
  onRowClick: (l: LogLine, e: React.MouseEvent) => void;
  onToggleExpand: (seq: number) => void;
  onInspect: (l: LogLine) => void;
  onCopyRaw: (raw: string) => void;
  openLoc: (loc: string) => void;
}

/** memoized row: batches land at 30Hz and every scroll tick re-renders the view —
 * unchanged rows must skip both the re-render and the regex tokenize pass */
const LogRow = memo(function LogRow({
  line,
  idx,
  wrap,
  start,
  rowH,
  syntax,
  selected,
  current,
  flash,
  collapsed,
  qRaw,
  caseSensitive,
  regexMode,
  measure,
  onRowClick,
  onToggleExpand,
  onInspect,
  onCopyRaw,
  openLoc,
}: RowProps) {
  const displayText = collapsed ? previewText(line.raw) : line.raw;
  const isMatch = qRaw ? lineMatches(line.raw, qRaw, caseSensitive, regexMode) : false;
  // token spans + search <mark>s — the expensive part; cached in spanCache so the
  // work survives remounts (openLoc is ref-stable, so it can stay out of the key)
  const cacheKey = `${collapsed ? "c" : "f"}|${syntax ? 1 : 0}|${caseSensitive ? 1 : 0}|${regexMode ? 1 : 0}|${isMatch ? qRaw : ""}`;
  const cached = spanCache.get(line);
  let content: ReactNode;
  if (cached && cached.key === cacheKey) {
    content = cached.content;
  } else {
    const text = rawLogText(displayText);
    content = renderSpans(
      text,
      lineTokens(text, line.ansi, syntax),
      isMatch ? searchMarks(text, qRaw, caseSensitive, regexMode) : [],
      openLoc,
    );
    spanCache.set(line, { key: cacheKey, content });
  }
  const style: CSSProperties = wrap
    ? { transform: `translateY(${start}px)`, minHeight: rowH }
    : { top: start, height: rowH };
  return (
    <div
      ref={measure}
      data-index={measure ? idx : undefined}
      className={[
        "log-line",
        wrap ? "wrapped" : "",
        line.level ? `lv-${line.level}` : "",
        selected ? "selected" : "",
        isMatch ? "match" : "",
        isMatch && current ? "current" : "",
        flash ? "flash" : "",
        collapsed ? "collapsed" : "",
      ].filter(Boolean).join(" ")}
      style={style}
      onClick={(e) => onRowClick(line, e)}
    >
      {collapsed ? (
        <span
          className="log-raw collapsed-preview"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(line.seq);
          }}
        >
          {content}
          <span className="collapse-badge">{(line.raw.length / 1024).toFixed(1)} KB JSON</span>
        </span>
      ) : (
        <span className="log-raw">{content}</span>
      )}
      {(line.raw[0] === "{" || line.raw[0] === "[") && (
        <button
          type="button"
          className="log-copy log-json"
          title="Inspect this line's JSON in the dock"
          aria-label="Inspect this line's JSON in the dock"
          onClick={(e) => {
            e.stopPropagation();
            onInspect(line);
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
          onCopyRaw(line.raw);
        }}
      >
        <Icon name="copy" size={12} />
      </button>
    </div>
  );
});

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
  const version = useFrameVersion(sourceId, active);
  // actions are stable — getState() avoids subscribing to the whole store
  const { startSource, stopSource, sendStdin, showToast, editSource, setInspectLine } = useApp.getState();

  const ring = bufferFor(sourceId);
  const rowH = useRowHeight();
  const uiFontSize = useApp((s) => s.uiFontSize);
  // the Errors dock owns ⌘F for its own in-tab search while it's the visible dock tab
  const dockTab = useApp((s) => s.dockTab.tab);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** viewport height, kept by the ResizeObserver — read this, not el.clientHeight */
  const viewportHRef = useRef(0);
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
  /** seq of the first visible row. the wrapped virtualizer drops its size cache while
   * the tab is inactive, so a pixel offset no longer maps to the same line on return —
   * and a plain index drifts too, because a live source keeps evicting from the ring */
  const savedSeq = useRef(-1);

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

  /** spacer height in px, mirrored from render values — the follow/scroll hot paths
   * read this instead of el.scrollHeight, which forces a synchronous layout */
  const totalPxRef = useRef(0);
  totalPxRef.current = wrap ? wrappedVirtualizer.getTotalSize() : viewLen * rowH;

  /** at most one scrollTop write per frame: batches land at 30Hz and every write
   * invalidates layout, so unbatched sticks force layout once per batch AND per
   * scroll event — the main source of live-follow jank */
  const stickRafRef = useRef(0);
  const scheduleStick = useCallback(() => {
    if (stickRafRef.current) return;
    stickRafRef.current = requestAnimationFrame(() => {
      stickRafRef.current = 0;
      const el = scrollRef.current;
      if (!el || !followRef.current) return;
      el.scrollTop = totalPxRef.current;
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(stickRafRef.current), []);

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
    // width 0 means the tab is hidden, not a 0px viewport — keeping the last real
    // width matters: row heights are estimated from it, and a 1px viewport would
    // bake absurd estimates into the virtualizer's cache on the next re-enable
    // the dock collapse animates the center column, so this observer fires every
    // frame for ~180ms — debounce the width STATE (it only feeds wrap-row height
    // estimates) so the transition doesn't drag a React render per frame behind it.
    // the height ref updates inline: writing a ref schedules nothing.
    let widthTimer = 0;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (entry.contentRect.height > 0) viewportHRef.current = entry.contentRect.height;
      if (w > 0) {
        window.clearTimeout(widthTimer);
        widthTimer = window.setTimeout(() => setViewportWidth(w), 120);
      }
    });
    observer.observe(el);
    if (el.clientWidth > 0) setViewportWidth(el.clientWidth);
    if (el.clientHeight > 0) viewportHRef.current = el.clientHeight;
    return () => {
      window.clearTimeout(widthTimer);
      observer.disconnect();
    };
  }, [active]);

  // ── virtual window ──────────────────────────────────────────────────────
  const computeRange = useCallback(() => {
    const el = scrollRef.current;
    if (!el || wrap) return;
    const top = el.scrollTop;
    const first = Math.max(0, Math.floor(top / rowH) - OVERSCAN);
    const last = Math.min(
      viewLen,
      Math.ceil((top + viewportHRef.current) / rowH) + OVERSCAN,
    );
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
  }, [viewLen, rowH, wrap]);

  // restore scroll position when returning to a tab that was hidden via display:none.
  // no save on !active: this effect runs after the tab is already display:none, where
  // scrollTop reads 0 — onScroll keeps savedSeq current while the tab is visible
  const wasActive = useRef(active);
  useEffect(() => {
    if (!active) {
      wasActive.current = false;
      return;
    }
    // only on the hidden → visible flip: this effect's deps also change on every
    // batch, and re-anchoring mid-scroll would fight the user
    if (wasActive.current) return;
    wasActive.current = true;
    const el = scrollRef.current;
    if (!el || followRef.current) return;
    // snapshot NOW: re-enabling the virtualizer runs its _willUpdate layout effect,
    // which re-attaches the scroll element and forces scrollTop back to its own
    // (nulled) offset — the resulting scroll event lands before the rAF below and
    // would otherwise overwrite the ref
    const targetSeq = savedSeq.current;
    // give the wrapped virtualizer one frame to remeasure before restoring
    const raf = requestAnimationFrame(() => {
      if (followRef.current) return;
      const ringIdx = ring.indexOfSeq(targetSeq);
      // evicted or filtered out while hidden: the top of the buffer is now the
      // closest surviving position, which is where we already are
      const i = ringIdx < 0 ? -1 : viewIdx ? viewIdx.indexOf(ringIdx) : ringIdx;
      if (i >= 0) {
        if (wrap) wrappedVirtualizer.scrollToIndex(i, { align: "start" });
        else el.scrollTop = i * rowH;
      }
      computeRange();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, computeRange, ring, rowH, viewIdx, wrap, wrappedVirtualizer]);

  // new batch: stick to bottom when following, always refresh the window.
  // the stick is rAF-coalesced — a raw scrollHeight read + scrollTop write per
  // batch forces one full layout pass per batch on top of the frame's own
  useEffect(() => {
    if (followRef.current) scheduleStick();
    computeRange();
  }, [version, computeRange, rowH, wrap, ring, wrappedVirtualizer, scheduleStick]);

  /** last seen scrollTop — breaking follow needs the scroll DIRECTION, not position:
   * batches land faster than scroll events, so "not at bottom" alone is just lag */
  const lastTopRef = useRef(0);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    // hiding the tab collapses the spacer to 0px, which clamps scrollTop to 0 and
    // fires a scroll event — saving it here would wipe the position we want back
    if (!el || !active) return;
    const top = el.scrollTop;
    // range is null while the virtualizer settles after a re-enable — saving then
    // would anchor the restore to the top of the buffer
    const firstVisible = wrap ? wrappedVirtualizer.range?.startIndex : Math.floor(top / rowH);
    if (firstVisible !== undefined) {
      savedSeq.current = ring.at(viewIdx ? viewIdx[firstVisible] : firstVisible)?.seq ?? -1;
    }
    const scrolledUp = top < lastTopRef.current - 1;
    lastTopRef.current = top;
    const atBottom = top + viewportHRef.current >= totalPxRef.current - rowH;
    if (followRef.current) {
      if (scrolledUp && !atBottom) {
        // user scrolled up — never fight them
        setFollow(false);
        pausedAtRef.current = ring.totalSeen;
      } else if (!atBottom) {
        // layout grew under us (new batch, wrap re-measure) — re-stick next frame
        scheduleStick();
      }
    } else if (atBottom) {
      setFollow(true);
    }
    if (!wrap) computeRange();
  }, [active, computeRange, ring, rowH, viewIdx, wrap, wrappedVirtualizer, scheduleStick]);

  const resumeFollow = useCallback(() => {
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = totalPxRef.current;
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
        if (el) el.scrollTop = totalPxRef.current;
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
    else el.scrollTop = Math.max(0, i * rowH - viewportHRef.current / 2);
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

  // row callbacks must be identity-stable — a fresh closure would defeat LogRow's memo
  const onInspect = useCallback(
    (l: LogLine) => {
      setSelection({ anchor: l.seq, picks: new Set([l.seq]) });
      publishLine(l);
    },
    [publishLine],
  );

  const onCopyRaw = useCallback((raw: string) => void copyText(raw, "Complete raw line."), [copyText]);

  const onToggleExpand = useCallback(
    (seq: number) => {
      setExpandedSeqs((prev) => {
        const next = new Set(prev);
        if (next.has(seq)) next.delete(seq);
        else next.add(seq);
        return next;
      });
      if (wrap) requestAnimationFrame(() => wrappedVirtualizer.measure());
    },
    [wrap, wrappedVirtualizer],
  );

  /** tok-path click → resolve against the source cwd and open in the editor.
   * Identity-stable via ref indirection: cached row spans capture it once and
   * must keep calling the LATEST def even after a source edit. */
  const openLocImpl = useRef<(loc: string) => void>(() => {});
  openLocImpl.current = (loc: string) => {
    if (!def) return;
    void openLocation(loc, def).then((opened) => {
      if (!opened) showToast("Copied", "Source location copied. Choose an editor in Settings to open it directly.");
    });
  };
  const openLoc = useCallback((loc: string) => openLocImpl.current(loc), []);

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
          const vh = viewportHRef.current;
          if (top < el.scrollTop) el.scrollTop = top;
          else if (top + rowH > el.scrollTop + vh) el.scrollTop = top + rowH - vh;
          computeRange();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selection, copySelection, searchOpen, clearBuffer, publishLine, viewIdx, viewLen, wrap, rowH, computeRange, dockTab]);

  const onRowClick = useCallback((l: LogLine, e: React.MouseEvent) => {
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
  }, [selection, publishLine]);

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
  const wrappedItems = wrap ? wrappedVirtualizer.getVirtualItems() : [];
  const currentMatchSeq = matches.length ? matches[matchIdx] : -1;

  // matching itself lives in LogRow (memoized); the parent only validates for the count badge
  let regexInvalid = false;
  if (qRaw && regexMode) {
    try {
      new RegExp(qRaw);
    } catch {
      regexInvalid = true;
    }
  }

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

      <AnimatePresence initial={false}>
      {searchOpen && (
        <motion.div
          className={`log-search ${regexInvalid ? "invalid" : ""}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.12, ease: [0.05, 0.7, 0.1, 1] }}
        >
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
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
      {exited && (
        <motion.div
          className={`log-exit-banner ${rt.exitCode === 0 ? "ok" : "err"}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.12, ease: [0.05, 0.7, 0.1, 1] }}
        >
          <span>
            exited with code {rt.exitCode}
            {rt.startedAt ? ` · started ${new Date(rt.startedAt).toLocaleTimeString()}` : ""}
          </span>
          <ToolButton onClick={() => void startSource(sourceId)}>
            <Icon name="refresh" /> Restart
          </ToolButton>
        </motion.div>
      )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
      {rt.status === "error" && rt.error && (
        <motion.div
          className="log-exit-banner err"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.12, ease: [0.05, 0.7, 0.1, 1] }}
        >
          <span>{rt.error}</span>
          <ToolButton onClick={() => void startSource(sourceId)}>
            <Icon name="refresh" /> Retry
          </ToolButton>
        </motion.div>
      )}
      </AnimatePresence>

      <div className="log-scroll" ref={scrollRef} onScroll={onScroll}>
        <div
          className={`log-spacer ${wrap ? "wrapped" : ""}`}
          style={{ height: wrap ? wrappedVirtualizer.getTotalSize() : total * rowH }}
        >
          {wrap
            ? wrappedItems.map((item) => {
                const line = lineAt(item.index);
                return line ? (
                  <LogRow
                    key={line.seq}
                    line={line}
                    idx={item.index}
                    wrap
                    start={item.start}
                    rowH={rowH}
                    syntax={syntax}
                    selected={!!picks?.has(line.seq)}
                    current={line.seq === currentMatchSeq}
                    flash={flashSeq === line.seq}
                    collapsed={isCollapsed(line)}
                    qRaw={qRaw}
                    caseSensitive={caseSensitive}
                    regexMode={regexMode}
                    measure={wrappedVirtualizer.measureElement}
                    onRowClick={onRowClick}
                    onToggleExpand={onToggleExpand}
                    onInspect={onInspect}
                    onCopyRaw={onCopyRaw}
                    openLoc={openLoc}
                  />
                ) : null;
              })
            : lines.map((line, offset) => {
                const idx = range[0] + offset;
                return (
                  <LogRow
                    key={line.seq}
                    line={line}
                    idx={idx}
                    wrap={false}
                    start={idx * rowH}
                    rowH={rowH}
                    syntax={syntax}
                    selected={!!picks?.has(line.seq)}
                    current={line.seq === currentMatchSeq}
                    flash={flashSeq === line.seq}
                    collapsed={isCollapsed(line)}
                    qRaw={qRaw}
                    caseSensitive={caseSensitive}
                    regexMode={regexMode}
                    onRowClick={onRowClick}
                    onToggleExpand={onToggleExpand}
                    onInspect={onInspect}
                    onCopyRaw={onCopyRaw}
                    openLoc={openLoc}
                  />
                );
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

      {/* follow paused + new output below → one tap back to the live edge */}
      <div className={`log-new-pill-wrap ${isCmd ? "with-stdin" : ""}`}>
        <AnimatePresence>
          {active && !follow && ring.totalSeen > pausedAtRef.current && (
            <motion.button
              type="button"
              className="log-new-pill"
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              onClick={resumeFollow}
              title="Jump to the newest lines and resume follow (⌘↵)"
            >
              <Icon name="arrow-down" size={13} />
              <span>{fmtInt(ring.totalSeen - pausedAtRef.current)} new line{ring.totalSeen - pausedAtRef.current === 1 ? "" : "s"}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {isCmd && (
        <div className="log-stdin">
          <Icon name="terminal" size={13} />
          <textarea
            rows={3}
            value={stdinValue}
            placeholder={
              live
                ? "Send to stdin (↵, ⇧↵ newline) — for y/N prompts, not a terminal"
                : "Run a command via your shell (↵, ⇧↵ newline) — output streams here"
            }
            spellCheck={false}
            onChange={(e) => setStdinValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!stdinValue.length) return;
                if (live) void sendStdin(sourceId, stdinValue);
                else void startSource(sourceId, stdinValue);
                setStdinValue("");
              }
            }}
          />
        </div>
      )}
    </section>
  );
}
