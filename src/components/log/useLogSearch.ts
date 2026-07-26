import { useCallback, useEffect, useRef, useState } from "react";
import { COLLAPSE_LEN, isJsonLike } from "./LogRow";
import type { LogModel } from "../../lib/logModel";
import type { LogLine } from "../../lib/types";

export interface LogSearchOpts<A> {
  active: boolean;
  version: number;
  /** center + flash a match (viewport.jumpToAddr) */
  jumpTo: (addr: A) => void;
}

/** query/matches half of a log view's find bar, generic over line address */
export function useLogSearch<A>(model: LogModel<A>, { active, version, jumpTo }: LogSearchOpts<A>) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  /** live filter: the view shows only matching lines, updated per batch */
  const [filterMode, setFilterMode] = useState(false);
  /** search hits as addresses — view indexes shift on eviction, addresses don't */
  const [matches, setMatches] = useState<A[]>([]);
  const [matchIdx, setMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback(
    (q: string) => {
      const found = model.search(q.trim(), { caseSensitive, regex: regexMode });
      setMatches(found);
      setMatchIdx(0);
      if (found.length) jumpTo(found[0]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [model, version, caseSensitive, regexMode, jumpTo],
  );

  const jumpMatch = useCallback(
    (dir: 1 | -1) => {
      if (!matches.length) return;
      const next = (matchIdx + dir + matches.length) % matches.length;
      setMatchIdx(next);
      jumpTo(matches[next]);
    },
    [matches, matchIdx, jumpTo],
  );

  // eviction while search is open: drop addrs that left the buffer so ↵ never
  // lands wrong — matches are in buffer order, so a live first means none left
  useEffect(() => {
    if (!matches.length || model.isAlive(matches[0])) return;
    const next = matches.filter((a) => model.isAlive(a));
    setMatches(next);
    setMatchIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
  }, [version, matches, model]);

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

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.select());
  }, []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  /** buffer cleared — stale addresses must not survive the seq restart */
  const clearMatches = useCallback(() => {
    setMatches([]);
    setMatchIdx(0);
  }, []);

  const qRaw = searchOpen ? query.trim() : "";
  /** the query while filter mode is active — feeds the model's filter */
  const filterQ = searchOpen && filterMode ? query.trim() : "";

  // matching itself lives in LogRow (memoized); the caller only validates for the badge
  let regexInvalid = false;
  if (qRaw && regexMode) {
    try {
      new RegExp(qRaw);
    } catch {
      regexInvalid = true;
    }
  }

  return {
    searchOpen,
    openSearch,
    closeSearch,
    clearMatches,
    query,
    setQuery,
    caseSensitive,
    setCaseSensitive,
    regexMode,
    setRegexMode,
    filterMode,
    setFilterMode,
    matches,
    matchIdx,
    jumpMatch,
    searchInputRef,
    qRaw,
    filterQ,
    regexInvalid,
    currentMatchKey: matches.length ? model.key(matches[matchIdx]) : null,
    // suppress stale search state while the tab is hidden
    activeSearch: active && searchOpen,
  };
}

/** long-JSON collapse state + auto-expand of search matches, keyed by model.key */
export function useJsonCollapse<A>(model: LogModel<A>, matches: A[]) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const isCollapsed = (l: LogLine, addr: A) =>
    l.raw.length > COLLAPSE_LEN && isJsonLike(l.raw) && !expandedKeys.has(model.key(addr));

  const toggleExpand = useCallback(
    (_l: LogLine, addr: A) => {
      const key = model.key(addr);
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [model],
  );

  // auto-expand long JSON lines that are search matches so highlights are visible
  useEffect(() => {
    if (!matches.length) return;
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const addr of matches) {
        const key = model.key(addr);
        if (!next.has(key)) {
          const line = model.lineOf(addr);
          if (line && line.raw.length > COLLAPSE_LEN && isJsonLike(line.raw)) {
            next.add(key);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [matches, model]);

  return { isCollapsed, toggleExpand };
}
