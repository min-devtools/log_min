import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { estimateLogRowHeight } from "../../lib/wrapLayout";
import { useApp } from "../../store";
import type { LogModel } from "../../lib/logModel";

// 8 rows ≈ 170px of runway each side; 20 doubled the mounted DOM for no visible gain
const OVERSCAN = 8;

export interface LogViewportOpts {
  active: boolean;
  wrap: boolean;
  rowH: number;
  uiFontSize: number;
  /** frame-gated buffer version — drives stick/range refresh effects */
  version: number;
  /** px of left gutters (time/prefix) — wrap height estimates subtract it */
  reservedPx?: number;
}

export interface LogViewport<A> {
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  follow: boolean;
  resumeFollow: () => void;
  pauseFollow: () => void;
  /** fixed-row window [first, last) — empty in wrap mode */
  range: [number, number];
  /** wrap-mode virtual items — empty otherwise */
  wrappedItems: VirtualItem[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** spacer height in px for the current mode */
  totalPx: number;
  /** row key currently flashing after a jump, or null */
  flashKey: string | null;
  /** center on a view index, pause follow, flash */
  jumpToIndex: (i: number) => void;
  /** center on an address; false = evicted or filtered out (no scroll) */
  jumpToAddr: (addr: A) => boolean;
  /** minimal scroll to keep a view index on screen (↑/↓ walking) */
  ensureIndexVisible: (i: number) => void;
  computeRange: () => void;
  /** lines appended since follow was paused — drives the "↓ N new lines" pill */
  newCount: number;
}

/**
 * The scrolling half of a log view: follow/stick (rAF-coalesced), the fixed-row
 * virtual window and the wrap-mode virtualizer, scroll-position restore across
 * tab switches, and jump-with-flash. Extracted verbatim from LogView, generic
 * over the model's line address.
 */
export function useLogViewport<A>(model: LogModel<A>, opts: LogViewportOpts): LogViewport<A> {
  const { active, wrap, rowH, uiFontSize, version, reservedPx = 0 } = opts;
  const viewLen = model.length;

  const scrollRef = useRef<HTMLDivElement>(null);
  /** viewport height, kept by the ResizeObserver — read this, not el.clientHeight */
  const viewportHRef = useRef(0);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  /** totalAppended when follow was paused — drives the "↓ N new lines" pill */
  const pausedAtRef = useRef(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  /** address of the first visible row. the wrapped virtualizer drops its size cache
   * while the tab is inactive, so a pixel offset no longer maps to the same line on
   * return — and a plain index drifts too, because live sources keep evicting */
  const savedAddr = useRef<A | null>(null);

  const virtualizer = useVirtualizer({
    count: viewLen,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      estimateLogRowHeight(model.at(index)?.raw ?? "", viewportWidth - reservedPx, uiFontSize),
    getItemKey: (index) => {
      const addr = model.addrAt(index);
      return addr !== undefined ? model.key(addr) : index;
    },
    overscan: 12,
    enabled: wrap && active,
    useFlushSync: false,
  });

  /** spacer height in px, mirrored from render values — the follow/scroll hot paths
   * read this instead of el.scrollHeight, which forces a synchronous layout */
  const totalPxRef = useRef(0);
  totalPxRef.current = wrap ? virtualizer.getTotalSize() : viewLen * rowH;

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
    const last = Math.min(viewLen, Math.ceil((top + viewportHRef.current) / rowH) + OVERSCAN);
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
  }, [viewLen, rowH, wrap]);

  // restore scroll position when returning to a tab that was hidden via display:none.
  // no save on !active: this effect runs after the tab is already display:none, where
  // scrollTop reads 0 — onScroll keeps savedAddr current while the tab is visible
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
    const targetAddr = savedAddr.current;
    // give the wrapped virtualizer one frame to remeasure before restoring
    const raf = requestAnimationFrame(() => {
      if (followRef.current) return;
      // evicted or filtered out while hidden: the top of the buffer is now the
      // closest surviving position, which is where we already are
      const i = targetAddr === null ? -1 : model.indexOf(targetAddr);
      if (i >= 0) {
        if (wrap) virtualizer.scrollToIndex(i, { align: "start" });
        else el.scrollTop = i * rowH;
      }
      computeRange();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, computeRange, model, rowH, wrap, virtualizer]);

  // new batch: stick to bottom when following, always refresh the window.
  // the stick is rAF-coalesced — a raw scrollHeight read + scrollTop write per
  // batch forces one full layout pass per batch on top of the frame's own
  useEffect(() => {
    if (followRef.current) scheduleStick();
    computeRange();
  }, [version, computeRange, rowH, wrap, virtualizer, scheduleStick]);

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
    const firstVisible = wrap ? virtualizer.range?.startIndex : Math.floor(top / rowH);
    if (firstVisible !== undefined) {
      savedAddr.current = model.addrAt(firstVisible) ?? null;
    }
    const scrolledUp = top < lastTopRef.current - 1;
    lastTopRef.current = top;
    const atBottom = top + viewportHRef.current >= totalPxRef.current - rowH;
    if (followRef.current) {
      if (scrolledUp && !atBottom) {
        // user scrolled up — never fight them
        setFollow(false);
        pausedAtRef.current = model.totalAppended;
      } else if (!atBottom) {
        // layout grew under us (new batch, wrap re-measure) — re-stick next frame
        scheduleStick();
      }
    } else if (atBottom) {
      setFollow(true);
    }
    if (!wrap) computeRange();
  }, [active, computeRange, model, rowH, wrap, virtualizer, scheduleStick]);

  const resumeFollow = useCallback(() => {
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = totalPxRef.current;
  }, []);

  const pauseFollow = useCallback(() => {
    setFollow(false);
    pausedAtRef.current = model.totalAppended;
  }, [model]);

  useEffect(() => {
    if (!wrap) {
      requestAnimationFrame(computeRange);
      return;
    }
    // no manual virtualizer.measure() here: the virtualizer's own ResizeObserver
    // already re-measured the rendered rows when the viewport reflowed; clearing
    // its cache afterwards would strand every row on stale width estimates (gaps)
    if (followRef.current && viewLen) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = totalPxRef.current;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap, viewportWidth, uiFontSize, computeRange]);

  // ⌘↵ from the app shell toggles follow on the active tab
  const runNonce = useApp((s) => s.runNonce);
  const runSeen = useRef(runNonce);
  useEffect(() => {
    if (runNonce !== runSeen.current) {
      runSeen.current = runNonce;
      if (active) (follow ? pauseFollow() : resumeFollow());
    }
  }, [runNonce, active, follow, pauseFollow, resumeFollow]);

  // ── jump & flash ────────────────────────────────────────────────────────
  const flashTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const jumpToIndex = useCallback(
    (i: number) => {
      const el = scrollRef.current;
      const addr = model.addrAt(i);
      if (!el || addr === undefined) return;
      pauseFollow();
      if (wrap) virtualizer.scrollToIndex(i, { align: "center" });
      else el.scrollTop = Math.max(0, i * rowH - viewportHRef.current / 2);
      const key = model.key(addr);
      setFlashKey(key);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 900);
      if (!wrap) computeRange();
    },
    [model, wrap, rowH, virtualizer, pauseFollow, computeRange],
  );

  /** addr → current view index → scroll; evicted or filtered-out addrs are skipped */
  const jumpToAddr = useCallback(
    (addr: A) => {
      const i = model.indexOf(addr);
      if (i < 0) return false;
      jumpToIndex(i);
      return true;
    },
    [model, jumpToIndex],
  );

  const ensureIndexVisible = useCallback(
    (i: number) => {
      const el = scrollRef.current;
      if (wrap) {
        virtualizer.scrollToIndex(i);
      } else if (el) {
        const top = i * rowH;
        const vh = viewportHRef.current;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + rowH > el.scrollTop + vh) el.scrollTop = top + rowH - vh;
        computeRange();
      }
    },
    [wrap, rowH, virtualizer, computeRange],
  );

  return {
    scrollRef,
    onScroll,
    follow,
    resumeFollow,
    pauseFollow,
    range,
    wrappedItems: wrap ? virtualizer.getVirtualItems() : [],
    virtualizer,
    totalPx: totalPxRef.current,
    flashKey,
    jumpToIndex,
    jumpToAddr,
    ensureIndexVisible,
    computeRange,
    newCount: follow ? 0 : Math.max(0, model.totalAppended - pausedAtRef.current),
  };
}
