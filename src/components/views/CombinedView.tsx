import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { runtimeOf, useApp } from "../../store";
import { bufferFor } from "../../lib/ring";
import { CONN_COLORS } from "../../lib/connColor";
import { findMarks, lineTokens, renderSpans } from "../../lib/highlight";
import { rawLogText } from "../../lib/logPresentation";
import { MergedIndex, type MergedRef } from "../../lib/merged";
import type { LogLine } from "../../lib/types";

const OVERSCAN = 20;

/** row height in px — same formula as LogView */
function useRowHeight(): number {
  const uiFontSize = useApp((s) => s.uiFontSize);
  return Math.round(uiFontSize * 1.55);
}

interface Props {
  tabId: string;
  collectionId: string;
  active: boolean;
}

export function CombinedView({ collectionId, active }: Props) {
  const collection = useApp((s) => s.collections.find((c) => c.id === collectionId));
  const members = useApp(
    useShallow((s) => s.sources.filter((x) => x.collectionId === collectionId).map((x) => x.id)),
  );
  const names = useApp(
    useShallow((s) =>
      Object.fromEntries(s.sources.filter((x) => x.collectionId === collectionId).map((x) => [x.id, x.name])),
    ),
  );
  const anyLive = useApp((s) => members.some((id) => runtimeOf(s, id).status === "live"));
  // hidden tabs unsubscribe from batches, same trick as LogView
  const version = useApp((s) =>
    active ? members.reduce((n, id) => n + (s.bufVersions[id] ?? 0), 0) : -1,
  );
  const { startSource, stopSource, openSourceTab, jumpToLine } = useApp.getState();

  const rowH = useRowHeight();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // compose-style deterministic colors: member index → --conn-* token name
  const colorOf = useMemo(() => {
    const m = new Map(members.map((id, i) => [id, CONN_COLORS[i % CONN_COLORS.length]]));
    return (id: string) => m.get(id) ?? "slate";
  }, [members]);
  const prefixCh = useMemo(
    () => Math.min(24, Math.max(4, ...Object.values(names).map((n) => n.length))),
    [names],
  );

  // membership change invalidates every row ref — start over from the surviving ledger
  const idxRef = useRef(new MergedIndex());
  const membersKey = members.join("\n");
  const lastKey = useRef(membersKey);
  const rows = useMemo(() => {
    if (lastKey.current !== membersKey) {
      lastKey.current = membersKey;
      idxRef.current.reset();
    }
    return idxRef.current.update(new Set(members));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, membersKey]);

  // ponytail: O(n) filter per batch while muting — fine at 100k rows, revisit if it ever shows up
  const visible = useMemo(
    () => (muted.size ? rows.filter((r) => !muted.has(r.sourceId)) : rows),
    // rows is the SAME array reference across update() calls (mutated in place) —
    // version is what actually signals new content
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, muted, version],
  );

  const lineOf = (r: MergedRef): LogLine | undefined => {
    const ring = bufferFor(r.sourceId);
    return ring.at(ring.indexOfSeq(r.seq));
  };

  // search: match positions in the visible list, recomputed on batch/query change
  const q = searchOpen ? query.trim().toLowerCase() : "";
  const matches = useMemo(() => {
    if (!q) return [];
    const out: number[] = [];
    for (let i = 0; i < visible.length && out.length < 5_000; i++) {
      const l = lineOf(visible[i]);
      if (l && l.raw.toLowerCase().includes(q)) out.push(i);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, visible, version]);
  const [matchIdx, setMatchIdx] = useState(0);
  useEffect(() => setMatchIdx(0), [q]);
  // eviction/mute can shrink matches under a deep matchIdx — keep it in range
  useEffect(() => setMatchIdx((i) => Math.min(i, Math.max(0, matches.length - 1))), [matches.length]);

  const computeRange = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = Math.max(0, Math.floor(el.scrollTop / rowH) - OVERSCAN);
    const last = Math.min(visible.length, Math.ceil((el.scrollTop + el.clientHeight) / rowH) + OVERSCAN);
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
  }, [visible.length, rowH]);

  // new batch: stick to bottom when following
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (followRef.current) el.scrollTop = el.scrollHeight;
    computeRange();
  }, [version, visible.length, computeRange, rowH]);

  const lastTopRef = useRef(0);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    const top = el.scrollTop;
    const scrolledUp = top < lastTopRef.current - 1;
    lastTopRef.current = top;
    const atBottom = top + el.clientHeight >= el.scrollHeight - rowH;
    if (followRef.current) {
      if (scrolledUp && !atBottom) setFollow(false);
      else if (!atBottom) el.scrollTop = el.scrollHeight;
    } else if (atBottom) {
      setFollow(true);
    }
    computeRange();
  }, [active, computeRange, rowH]);

  const jumpToVisibleIndex = useCallback(
    (i: number) => {
      const el = scrollRef.current;
      if (!el) return;
      setFollow(false);
      el.scrollTop = Math.max(0, i * rowH - el.clientHeight / 2);
      computeRange();
    },
    [rowH, computeRange],
  );

  const jumpMatch = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(next);
    jumpToVisibleIndex(matches[next]);
  };

  // ⌘F opens search while this tab is active
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.select());
      }
      if (e.key === "Escape" && searchOpen && (e.target as HTMLElement)?.tagName !== "INPUT") {
        setSearchOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, searchOpen]);

  // ⌘↵ toggles follow, like LogView
  const runNonce = useApp((s) => s.runNonce);
  const runSeen = useRef(runNonce);
  useEffect(() => {
    if (runNonce !== runSeen.current) {
      runSeen.current = runNonce;
      if (active) setFollow((f) => !f);
    }
  }, [runNonce, active]);

  if (!collection) {
    return (
      <section className={`content log-view combined-view ${active ? "active" : ""}`}>
        <div className="empty-note" style={{ padding: 24 }}>This collection was deleted. Close the tab.</div>
      </section>
    );
  }

  const total = visible.length;
  const currentMatch = matches.length ? matches[matchIdx] : -1;
  const slice = visible.slice(range[0], range[1]);

  return (
    <section className={`content log-view combined-view ${active ? "active" : ""}`}>
      <div className="log-toolbar">
        <div className="log-toolbar-info combined-chips">
          {members.map((id) => (
            <button
              key={id}
              type="button"
              className={`combined-chip ${muted.has(id) ? "muted" : ""}`}
              style={{ "--conn": `var(--conn-${colorOf(id)})` } as React.CSSProperties}
              title={muted.has(id) ? `Show ${names[id]}` : `Hide ${names[id]}`}
              aria-pressed={!muted.has(id)}
              onClick={() =>
                setMuted((cur) => {
                  const next = new Set(cur);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            >
              <span className="conn-dot" />
              {names[id]}
            </button>
          ))}
          {members.length === 0 && <span>No sources in this collection.</span>}
        </div>
        <div className="log-toolbar-actions">
          <ToolButton
            iconOnly
            variant="primary"
            title="Start all sources"
            aria-label="Start all"
            disabled={!members.length}
            onClick={() => members.forEach((id) => void startSource(id))}
          >
            <Icon name="play" />
          </ToolButton>
          <ToolButton
            iconOnly
            title="Stop all sources"
            aria-label="Stop all"
            disabled={!anyLive}
            onClick={() => members.forEach((id) => void stopSource(id))}
          >
            <Icon name="stop" />
          </ToolButton>
          <ToolButton
            iconOnly
            title={follow ? "Pause follow (⌘↵)" : "Resume follow (⌘↵)"}
            aria-label="Toggle follow"
            aria-pressed={follow}
            className={`log-view-toggle ${follow ? "active" : ""}`}
            onClick={() => {
              const el = scrollRef.current;
              if (!follow && el) el.scrollTop = el.scrollHeight;
              setFollow(!follow);
            }}
          >
            <Icon name="arrow-down" />
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
        </div>
      </div>

      {searchOpen && (
        <div className="log-search">
          <Icon name="search" size={13} />
          <input
            ref={searchInputRef}
            value={query}
            placeholder="Find in combined buffer…"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpMatch(e.shiftKey ? -1 : 1);
              if (e.key === "Escape") setSearchOpen(false);
            }}
          />
          <span className="log-search-count">
            {matches.length ? `${matchIdx + 1}/${matches.length >= 5_000 ? "5 000+" : matches.length}` : query ? "0" : ""}
          </span>
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

      <div className="log-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="log-spacer" style={{ height: total * rowH }}>
          {slice.map((r, offset) => {
            const i = range[0] + offset;
            const l = lineOf(r);
            if (!l) return null;
            const isMatch = !!q && l.raw.toLowerCase().includes(q);
            return (
              <div
                key={`${r.sourceId}:${r.seq}`}
                className={[
                  "log-line",
                  l.level ? `lv-${l.level}` : "",
                  isMatch ? "match" : "",
                  isMatch && i === currentMatch ? "current" : "",
                ].filter(Boolean).join(" ")}
                style={{ top: i * rowH, height: rowH }}
                title="Click to open this line in the source's own tab"
                onClick={() => {
                  openSourceTab(r.sourceId);
                  jumpToLine(r.sourceId, r.seq);
                }}
              >
                <span
                  className="combined-prefix"
                  style={{ color: `var(--conn-${colorOf(r.sourceId)})`, width: `${prefixCh}ch` }}
                >
                  {names[r.sourceId]}
                </span>
                <span className="log-raw">
                  {renderSpans(rawLogText(l.raw), lineTokens(l.raw, l.ansi, true), isMatch ? findMarks(l.raw, q) : [])}
                </span>
              </div>
            );
          })}
        </div>
        {total === 0 && (
          <div className="empty-note" style={{ padding: 24 }}>
            {members.length === 0
              ? "Add sources to this collection to see their combined output."
              : anyLive
                ? "Waiting for output…"
                : "Press ▶ to start every source in this collection."}
          </div>
        )}
      </div>
    </section>
  );
}
