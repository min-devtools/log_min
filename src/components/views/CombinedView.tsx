import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useShallow } from "zustand/react/shallow";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { runtimeOf, useApp } from "../../store";
import { CONN_COLORS } from "../../lib/connColor";
import { openLocation } from "../../lib/editor";
import { MergedModel } from "../../lib/logModel";
import type { MergedRef } from "../../lib/merged";
import { fmtClock, fmtInt, LogRow, useRowHeight } from "../log/LogRow";
import { LogSearchBar } from "../log/LogSearchBar";
import { useFrameVersion } from "../log/useFrameVersion";
import { useJsonCollapse, useLogSearch } from "../log/useLogSearch";
import { useLogSelection } from "../log/useLogSelection";
import { useLogKeys } from "../log/useLogKeys";
import { useLogViewport } from "../log/useLogViewport";
import type { LogLevel, LogLine } from "../../lib/types";

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
  const membersKey = members.join("\n");
  const readVersion = useCallback(
    (s: ReturnType<typeof useApp.getState>) =>
      members.reduce((n, id) => n + (s.bufVersions[id] ?? 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [membersKey],
  );
  const version = useFrameVersion(active, readVersion);
  const { startSource, stopSource, showToast, setInspectLine } = useApp.getState();

  const rowH = useRowHeight();
  const uiFontSize = useApp((s) => s.uiFontSize);
  // the Errors dock owns ⌘F for its own in-tab search while it's the visible dock tab
  const dockTab = useApp((s) => s.dockTab.tab);

  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set());
  const [wrap, setWrap] = useState(() => localStorage.getItem(`combined:wrap:${collectionId}`) !== "0");
  const [syntax, setSyntax] = useState(() => localStorage.getItem(`combined:syntax:${collectionId}`) !== "0");
  // compose views default the receive-time gutter ON, Dozzle-style
  const [showTime, setShowTime] = useState(() => localStorage.getItem(`combined:time:${collectionId}`) !== "0");
  /** level quick-filter chips (Err / Warn); empty = all levels */
  const [levelFilter, setLevelFilter] = useState<ReadonlySet<LogLevel>>(new Set());

  useEffect(() => {
    localStorage.setItem(`combined:wrap:${collectionId}`, wrap ? "1" : "0");
  }, [collectionId, wrap]);
  useEffect(() => {
    localStorage.setItem(`combined:syntax:${collectionId}`, syntax ? "1" : "0");
  }, [collectionId, syntax]);
  useEffect(() => {
    localStorage.setItem(`combined:time:${collectionId}`, showTime ? "1" : "0");
  }, [collectionId, showTime]);

  // compose-style deterministic colors: member index → --conn-* token name
  const colorOf = useMemo(() => {
    const m = new Map(members.map((id, i) => [id, CONN_COLORS[i % CONN_COLORS.length]]));
    return (id: string) => m.get(id) ?? "slate";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersKey]);
  const prefixCh = useMemo(
    () => Math.min(24, Math.max(4, ...Object.values(names).map((n) => n.length))),
    [names],
  );

  // ── engine wiring ───────────────────────────────────────────────────────
  const model = useMemo(() => new MergedModel(), []);
  const jumpToAddrRef = useRef<(a: MergedRef) => boolean>(() => false);
  const jumpTo = useCallback((a: MergedRef) => void jumpToAddrRef.current(a), []);
  const search = useLogSearch(model, { active, version, jumpTo });

  // sync BEFORE the viewport reads model.length for this render pass
  model.sync(members, muted, {
    query: search.filterQ,
    caseSensitive: search.caseSensitive,
    regex: search.regexMode,
    levels: levelFilter,
  });

  const chPx = uiFontSize * 0.62;
  const viewport = useLogViewport(model, {
    active,
    wrap,
    rowH,
    uiFontSize,
    version,
    // prefix column + separator + optional time gutter
    reservedPx: Math.round(prefixCh * chPx + 18 + (showTime ? 8 * chPx + 8 : 0)),
  });
  jumpToAddrRef.current = viewport.jumpToAddr;

  const publish = useCallback(
    (l: LogLine | null, addr: MergedRef | null) =>
      setInspectLine(
        l && addr
          ? { sourceId: addr.sourceId, seq: l.seq, raw: l.raw, stream: l.stream, level: l.level, traceId: l.traceId }
          : null,
      ),
    [setInspectLine],
  );
  const selection = useLogSelection<MergedRef>(model, publish);
  const { isCollapsed, toggleExpand } = useJsonCollapse<MergedRef>(model, search.matches);

  // ── copy ────────────────────────────────────────────────────────────────
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
    const selected = selection.collectSelected();
    if (!selected.length) return;
    // docker-compose style: pad every name to the shared gutter width
    const text = selected
      .map(({ line, addr }) => `${(names[addr.sourceId] ?? addr.sourceId).padEnd(prefixCh)} | ${line.raw}`)
      .join("\n");
    await copyText(text, `${selected.length} selected line${selected.length === 1 ? "" : "s"}.`);
  }, [selection, names, prefixCh, copyText]);
  const copySelectionCb = useCallback(() => void copySelection(), [copySelection]);

  // row callbacks must be identity-stable — a fresh closure would defeat LogRow's memo
  const onRowClick = useCallback(
    (l: LogLine, addr: unknown, e: React.MouseEvent) => selection.onRowClick(l, addr as MergedRef, e),
    [selection.onRowClick],
  );
  const onInspect = useCallback(
    (l: LogLine, addr: unknown) => selection.selectSingle(l, addr as MergedRef),
    [selection.selectSingle],
  );
  const onCopyRaw = useCallback((raw: string) => void copyText(raw, "Complete raw line."), [copyText]);
  const onToggleExpand = useCallback(
    (l: LogLine, addr: unknown) => {
      toggleExpand(l, addr as MergedRef);
      if (wrap) requestAnimationFrame(() => viewport.virtualizer.measure());
    },
    [toggleExpand, wrap, viewport.virtualizer],
  );

  /** tok-path click → resolve against the LINE's source cwd (members differ) */
  const openLoc = useCallback((loc: string, _line: LogLine, addr: unknown) => {
    const a = addr as MergedRef;
    const def = useApp.getState().sources.find((x) => x.id === a.sourceId);
    if (!def) return;
    void openLocation(loc, def).then((opened) => {
      if (!opened)
        useApp.getState().showToast("Copied", "Source location copied. Choose an editor in Settings to open it directly.");
    });
  }, []);

  const anchorViewIndex = useCallback(
    () => (selection.selection ? model.indexOf(selection.selection.anchor) : -1),
    [selection.selection, model],
  );
  const selectAt = useCallback(
    (line: LogLine, addr: MergedRef) => selection.selectSingle(line, addr),
    [selection.selectSingle],
  );

  useLogKeys<MergedRef>({
    active,
    yieldSearchToDock: dockTab === "errors",
    searchOpen: search.searchOpen,
    openSearch: search.openSearch,
    closeSearch: search.closeSearch,
    hasSelection: !!selection.selection,
    clearSelection: selection.clearSelection,
    copySelection: copySelectionCb,
    model,
    anchorViewIndex,
    selectAt,
    jumpToIndex: viewport.jumpToIndex,
    ensureIndexVisible: viewport.ensureIndexVisible,
    pauseFollow: viewport.pauseFollow,
  });

  // the dock's Jump button targets this collection — unmute if needed, then flash.
  // the nonce is left unconsumed while unmuting so the effect re-runs after the
  // model re-syncs without the muted source
  const jumpTarget = useApp((s) => s.jumpTarget);
  const jumpSeen = useRef(0);
  useEffect(() => {
    if (!active || !jumpTarget || jumpTarget.nonce === jumpSeen.current) return;
    if (jumpTarget.combinedId !== collectionId) return;
    const addr: MergedRef = { sourceId: jumpTarget.sourceId, seq: jumpTarget.seq };
    if (!model.isAlive(addr)) {
      jumpSeen.current = jumpTarget.nonce;
      showToast("Line unavailable", "That line is no longer in the buffer.");
      return;
    }
    if (muted.has(addr.sourceId)) {
      setMuted((cur) => {
        const next = new Set(cur);
        next.delete(addr.sourceId);
        return next;
      });
      return;
    }
    jumpSeen.current = jumpTarget.nonce;
    if (!viewport.jumpToAddr(addr)) showToast("Line hidden", "The current filter hides that line.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget, active, collectionId, muted]);

  // ── render ──────────────────────────────────────────────────────────────
  if (!collection) {
    return (
      <section className={`content log-view combined-view ${active ? "active" : ""}`}>
        <div className="empty-note" style={{ padding: 24 }}>This collection was deleted. Close the tab.</div>
      </section>
    );
  }

  const total = model.length;
  const filtered = model.filtered;
  const picks = selection.picks;
  const selectedCount = selection.selectedCount;
  const { qRaw, caseSensitive, regexMode, matches, matchIdx, regexInvalid, currentMatchKey } = search;

  const countText = regexInvalid
    ? "bad regex"
    : search.filterMode && search.filterQ
      ? `${fmtInt(total)} line${total === 1 ? "" : "s"}`
      : matches.length
        ? `${matchIdx + 1}/${matches.length >= 5_000 ? "5 000+" : matches.length}`
        : search.query
          ? "0"
          : "";

  const toggleMute = (id: string, solo: boolean) => {
    setMuted((cur) => {
      if (solo) {
        // ⌥click: solo this source; ⌥click again to hear everyone
        const already = !cur.has(id) && cur.size === members.length - 1;
        return already ? new Set<string>() : new Set(members.filter((m) => m !== id));
      }
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderRow = (line: LogLine, addr: MergedRef, idx: number, start: number, measure?: (n: HTMLDivElement | null) => void) => {
    const key = model.key(addr);
    return (
      <LogRow
        key={key}
        line={line}
        addr={addr}
        idx={idx}
        wrap={!!measure}
        start={start}
        rowH={rowH}
        syntax={syntax}
        selected={!!picks?.has(key)}
        current={currentMatchKey === key}
        flash={viewport.flashKey === key}
        collapsed={isCollapsed(line, addr)}
        qRaw={qRaw}
        caseSensitive={caseSensitive}
        regexMode={regexMode}
        time={showTime ? (line.at !== undefined ? fmtClock(line.at) : "") : undefined}
        prefixText={names[addr.sourceId] ?? addr.sourceId}
        prefixColorVar={`var(--conn-${colorOf(addr.sourceId)})`}
        prefixWidthCh={prefixCh}
        measure={measure}
        onRowClick={onRowClick}
        onToggleExpand={onToggleExpand}
        onInspect={onInspect}
        onCopyRaw={onCopyRaw}
        openLoc={openLoc}
      />
    );
  };

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
              title={`${muted.has(id) ? `Show ${names[id]}` : `Hide ${names[id]}`} · ⌥click to solo`}
              aria-pressed={!muted.has(id)}
              onClick={(e) => toggleMute(id, e.altKey)}
            >
              <span className="conn-dot" />
              {names[id]}
            </button>
          ))}
          {members.length === 0 && <span>No sources in this collection.</span>}
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
            title={viewport.follow ? "Pause follow (⌘↵)" : "Resume follow (⌘↵)"}
            aria-label="Toggle follow"
            aria-pressed={viewport.follow}
            className={`log-view-toggle ${viewport.follow ? "active" : ""}`}
            onClick={() => (viewport.follow ? viewport.pauseFollow() : viewport.resumeFollow())}
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
            title={showTime ? "Hide receive times" : "Show receive time of every line"}
            aria-label="Toggle timestamps"
            aria-pressed={showTime}
            className={`log-view-toggle ${showTime ? "active" : ""}`}
            onClick={() => setShowTime((value) => !value)}
          >
            <Icon name="clock" />
          </ToolButton>
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
          <ToolButton iconOnly title="Search (⌘F)" aria-label="Search" onClick={search.openSearch}>
            <Icon name="search" />
          </ToolButton>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {search.searchOpen && (
          <LogSearchBar
            inputRef={search.searchInputRef}
            query={search.query}
            onQueryChange={search.setQuery}
            placeholder={
              search.filterMode
                ? "Filter — only matching lines, live…"
                : regexMode
                  ? "Find across the collection (regex)…"
                  : "Find across the collection…"
            }
            invalid={regexInvalid}
            countText={countText}
            filterMode={search.filterMode}
            onToggleFilter={() => search.setFilterMode((v) => !v)}
            caseSensitive={caseSensitive}
            onToggleCase={() => search.setCaseSensitive((v) => !v)}
            regexMode={regexMode}
            onToggleRegex={() => search.setRegexMode((v) => !v)}
            navDisabled={search.filterMode}
            onPrev={() => search.jumpMatch(-1)}
            onNext={() => search.jumpMatch(1)}
            onClose={search.closeSearch}
          />
        )}
      </AnimatePresence>

      <div className="log-scroll" ref={viewport.scrollRef} onScroll={viewport.onScroll}>
        <div className={`log-spacer ${wrap ? "wrapped" : ""}`} style={{ height: viewport.totalPx }}>
          {wrap
            ? viewport.wrappedItems.map((item) => {
                const line = model.at(item.index);
                const addr = model.addrAt(item.index);
                return line && addr
                  ? renderRow(line, addr, item.index, item.start, viewport.virtualizer.measureElement)
                  : null;
              })
            : (() => {
                const out = [];
                for (let i = viewport.range[0]; i < viewport.range[1]; i++) {
                  const line = model.at(i);
                  const addr = model.addrAt(i);
                  if (line && addr) out.push(renderRow(line, addr, i, i * rowH));
                }
                return out;
              })()}
        </div>
        {total === 0 && (
          <div className="empty-note" style={{ padding: 24 }}>
            {members.length === 0
              ? "Add sources to this collection to see their combined output."
              : filtered
                ? search.filterQ
                  ? `No lines match “${search.filterQ}”. New matching output will appear here.`
                  : "No matching lines yet. New matching output will appear here."
                : anyLive
                  ? "Waiting for output…"
                  : "Press ▶ to start every source in this collection."}
          </div>
        )}
      </div>

      {/* follow paused + new output below → one tap back to the live edge */}
      <div className="log-new-pill-wrap">
        <AnimatePresence>
          {active && !viewport.follow && viewport.newCount > 0 && (
            <motion.button
              type="button"
              className="log-new-pill"
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              onClick={viewport.resumeFollow}
              title="Jump to the newest lines and resume follow (⌘↵)"
            >
              <Icon name="arrow-down" size={13} />
              <span>{fmtInt(viewport.newCount)} new line{viewport.newCount === 1 ? "" : "s"}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
