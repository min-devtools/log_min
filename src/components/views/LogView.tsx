import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
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
import { insightIndexFor } from "../../lib/insight";
import { RingModel } from "../../lib/logModel";
import { saveText } from "../../lib/logmin";
import { sourceIcon } from "../../lib/types";
import { fmtClock, fmtInt, LogRow, useRowHeight } from "../log/LogRow";
import { LogSearchBar } from "../log/LogSearchBar";
import { useFrameVersion } from "../log/useFrameVersion";
import { useJsonCollapse, useLogSearch } from "../log/useLogSearch";
import { useLogSelection } from "../log/useLogSelection";
import { useLogKeys } from "../log/useLogKeys";
import { useLogViewport } from "../log/useLogViewport";
import type { LogLevel, LogLine } from "../../lib/types";

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
  const readVersion = useCallback(
    (s: ReturnType<typeof useApp.getState>) => s.bufVersions[sourceId] ?? 0,
    [sourceId],
  );
  const version = useFrameVersion(active, readVersion);
  // actions are stable — getState() avoids subscribing to the whole store
  const { startSource, stopSource, sendStdin, showToast, editSource, setInspectLine } = useApp.getState();

  const ring = bufferFor(sourceId);
  const model = useMemo(() => new RingModel(sourceId), [sourceId]);
  const rowH = useRowHeight();
  const uiFontSize = useApp((s) => s.uiFontSize);
  // the Errors dock owns ⌘F for its own in-tab search while it's the visible dock tab
  const dockTab = useApp((s) => s.dockTab.tab);

  const [wrap, setWrap] = useState(() => localStorage.getItem(`log:wrap:${sourceId}`) !== "0");
  const [syntax, setSyntax] = useState(() => localStorage.getItem(`log:syntax:${sourceId}`) !== "0");
  const [showTime, setShowTime] = useState(() => localStorage.getItem(`log:time:${sourceId}`) === "1");
  /** level quick-filter chips (Err / Warn); empty = all levels */
  const [levelFilter, setLevelFilter] = useState<ReadonlySet<LogLevel>>(new Set());
  const [stdinValue, setStdinValue] = useState("");
  const [capValue, setCapValue] = useState("");

  // per-source retained-line budget — applied to the ring on mount, persisted on commit
  useEffect(() => {
    const stored = parseCap(localStorage.getItem(`log:cap:${sourceId}`) ?? "");
    if (stored) ring.setCap(stored);
    setCapValue(fmtCapValue(ring.capacity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  useEffect(() => {
    localStorage.setItem(`log:wrap:${sourceId}`, wrap ? "1" : "0");
  }, [sourceId, wrap]);
  useEffect(() => {
    localStorage.setItem(`log:syntax:${sourceId}`, syntax ? "1" : "0");
  }, [sourceId, syntax]);
  useEffect(() => {
    localStorage.setItem(`log:time:${sourceId}`, showTime ? "1" : "0");
  }, [sourceId, showTime]);

  // ── engine wiring ───────────────────────────────────────────────────────
  // search needs the viewport's jump and the viewport needs the search's filter
  // query — break the cycle with a ref the stable wrapper reads through
  const jumpToAddrRef = useRef<(seq: number) => boolean>(() => false);
  const jumpTo = useCallback((seq: number) => void jumpToAddrRef.current(seq), []);
  const search = useLogSearch(model, { active, version, jumpTo });

  // sync BEFORE the viewport reads model.length for this render pass
  model.sync({
    query: search.filterQ,
    caseSensitive: search.caseSensitive,
    regex: search.regexMode,
    levels: levelFilter,
  });

  const viewport = useLogViewport(model, {
    active,
    wrap,
    rowH,
    uiFontSize,
    version,
    reservedPx: showTime ? Math.round(uiFontSize * 0.62 * 8) + 8 : 0,
  });
  jumpToAddrRef.current = viewport.jumpToAddr;

  const publishLine = useCallback(
    (l: LogLine | null) =>
      setInspectLine(
        l ? { sourceId, seq: l.seq, raw: l.raw, stream: l.stream, level: l.level, traceId: l.traceId } : null,
      ),
    [setInspectLine, sourceId],
  );
  const publish = useCallback(
    (l: LogLine | null) => publishLine(l),
    [publishLine],
  );
  const selection = useLogSelection<number>(model, publish);

  const { isCollapsed, toggleExpand } = useJsonCollapse<number>(model, search.matches);

  const isCmd = def?.kind === "cmd";
  const live = rt.status === "live";
  const exited = isCmd && rt.status === "idle" && rt.exitCode !== undefined && rt.exitCode !== null;

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
    model.resetFilter();
    selection.clearSelection();
    search.clearMatches();
    useApp.getState().onBufferCleared(sourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring, sourceId, model, selection.clearSelection, search.clearMatches]);

  // ── copy & export ───────────────────────────────────────────────────────
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
    const selected = selection.collectSelected().map((p) => p.line);
    if (!selected.length) return;
    await copyText(copyTextForLines(selected), `${selected.length} selected line${selected.length === 1 ? "" : "s"}.`);
  }, [selection, copyText]);
  const copySelectionCb = useCallback(() => void copySelection(), [copySelection]);

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

  // row callbacks must be identity-stable — a fresh closure would defeat LogRow's memo
  const onRowClick = useCallback(
    (l: LogLine, addr: unknown, e: React.MouseEvent) => selection.onRowClick(l, addr as number, e),
    [selection.onRowClick],
  );
  const onInspect = useCallback(
    (l: LogLine, addr: unknown) => selection.selectSingle(l, addr as number),
    [selection.selectSingle],
  );
  const onCopyRaw = useCallback((raw: string) => void copyText(raw, "Complete raw line."), [copyText]);
  const onToggleExpand = useCallback(
    (l: LogLine, addr: unknown) => {
      toggleExpand(l, addr as number);
      if (wrap) requestAnimationFrame(() => viewport.virtualizer.measure());
    },
    [toggleExpand, wrap, viewport.virtualizer],
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

  const anchorViewIndex = useCallback(
    () => (selection.selection ? model.indexOf(selection.selection.anchor) : -1),
    [selection.selection, model],
  );
  const selectAt = useCallback(
    (line: LogLine, addr: number) => selection.selectSingle(line, addr),
    [selection.selectSingle],
  );

  useLogKeys<number>({
    active,
    yieldSearchToDock: dockTab === "errors",
    searchOpen: search.searchOpen,
    openSearch: search.openSearch,
    closeSearch: search.closeSearch,
    hasSelection: !!selection.selection,
    clearSelection: selection.clearSelection,
    copySelection: copySelectionCb,
    clearBuffer,
    model,
    anchorViewIndex,
    selectAt,
    jumpToIndex: viewport.jumpToIndex,
    ensureIndexVisible: viewport.ensureIndexVisible,
    pauseFollow: viewport.pauseFollow,
  });

  // error dock clicked a group — scroll to the line and flash it
  const jumpTarget = useApp((s) => s.jumpTarget);
  const jumpSeen = useRef(0);
  useEffect(() => {
    if (!active || !jumpTarget || jumpTarget.nonce === jumpSeen.current) return;
    // combined-scoped targets belong to the collection tab, not this view
    if (jumpTarget.sourceId !== sourceId || jumpTarget.combinedId) return;
    jumpSeen.current = jumpTarget.nonce;
    viewport.jumpToAddr(jumpTarget.seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget, active, sourceId]);

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

  const total = model.length;
  const filtered = model.filtered;
  const picks = selection.picks;
  const selectedCount = selection.selectedCount;
  const { qRaw, caseSensitive, regexMode, matches, matchIdx, regexInvalid, currentMatchKey } = search;

  const countText = regexInvalid
    ? "bad regex"
    : filtered
      ? `${fmtInt(total)} line${total === 1 ? "" : "s"}`
      : matches.length
        ? `${matchIdx + 1}/${matches.length >= 5_000 ? "5 000+" : matches.length}`
        : search.query
          ? "0"
          : "";

  const renderRow = (line: LogLine, idx: number, start: number, measure?: (n: HTMLDivElement | null) => void) => (
    <LogRow
      key={line.seq}
      line={line}
      addr={line.seq}
      idx={idx}
      wrap={!!measure}
      start={start}
      rowH={rowH}
      syntax={syntax}
      selected={!!picks?.has(String(line.seq))}
      current={currentMatchKey === String(line.seq)}
      flash={viewport.flashKey === String(line.seq)}
      collapsed={isCollapsed(line, line.seq)}
      qRaw={qRaw}
      caseSensitive={caseSensitive}
      regexMode={regexMode}
      time={showTime && line.at !== undefined ? fmtClock(line.at) : showTime ? "" : undefined}
      measure={measure}
      onRowClick={onRowClick}
      onToggleExpand={onToggleExpand}
      onInspect={onInspect}
      onCopyRaw={onCopyRaw}
      openLoc={openLoc}
    />
  );

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
          <ToolButton
            iconOnly
            title="Search (⌘F)"
            aria-label="Search"
            onClick={search.openSearch}
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
        {search.searchOpen && (
          <LogSearchBar
            inputRef={search.searchInputRef}
            query={search.query}
            onQueryChange={search.setQuery}
            placeholder={
              search.filterMode
                ? "Filter — only matching lines, live…"
                : regexMode
                  ? "Find in buffer (regex)…"
                  : "Find in buffer…"
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

      <div className="log-scroll" ref={viewport.scrollRef} onScroll={viewport.onScroll}>
        <div className={`log-spacer ${wrap ? "wrapped" : ""}`} style={{ height: viewport.totalPx }}>
          {wrap
            ? viewport.wrappedItems.map((item) => {
                const line = model.at(item.index);
                return line ? renderRow(line, item.index, item.start, viewport.virtualizer.measureElement) : null;
              })
            : (() => {
                const out = [];
                for (let i = viewport.range[0]; i < viewport.range[1]; i++) {
                  const line = model.at(i);
                  if (line) out.push(renderRow(line, i, i * rowH));
                }
                return out;
              })()}
        </div>
        {/* startup only: streaming batches clear it as soon as the first line lands */}
        <SectionVeil on={live && total === 0 && !filtered} label="Waiting for output…" />
        {total === 0 && !(live && !filtered) && (
          <div className="empty-note" style={{ padding: 24 }}>
            {filtered
              ? search.filterQ
                ? `No lines match “${search.filterQ}”. New matching output will appear here.`
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
