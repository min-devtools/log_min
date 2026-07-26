# Combined view v2 — shared log engine, dock, jump, search parity

Approved 2026-07-26 (user picked approach A: full engine extraction).

## Goal

Bring the collection ("combined", docker-compose-style) view up to Docker
Desktop / Dozzle standards: rich search, right-dock integration with
jump-back-to-line, timestamps, selection/copy, wrap — by extracting LogView's
battle-tested machinery into a shared engine both views consume.

## Architecture

LogView addresses lines by `seq` (one ring); CombinedView by `(sourceId, seq)`.
The engine is generic over a line address `A`:

```ts
// src/lib/logModel.ts
interface LogModel<A> {
  length: number;                 // lines in the (possibly filtered) view
  at(i): LogLine | undefined;     // by view index
  addrAt(i): A | undefined;
  indexOf(addr): number;          // view index; -1 = evicted or filtered out
  lineOf(addr): LogLine | undefined;  // ignores filter — copy/prune need it
  isAlive(addr): boolean;         // evicted check only (filter-independent)
  key(addr): string;              // stable row key
  totalAppended: number;          // monotonic — feeds the "N new lines" pill
  search(q, opts, cap?): A[];     // over the unfiltered buffer (mute still applies)
  expandRange(a, b): A[];         // shift-select policy (model-specific)
  sortAddrs(addrs): A[];          // copy order
}
```

- **RingModel** (`A = seq`): wraps `Ring` + `LiveFilter`. `expandRange` =
  numeric seq range (preserves LogView shift-select semantics exactly).
- **MergedModel** (`A = MergedRef`): wraps `MergedIndex` + mute + level +
  query filter. Filtering is incremental: view holds refs; new rows are
  scanned per batch; a `rowsGeneration` bump (eviction prune / reset) prunes
  the view by line-existence and a `WeakSet` of seen refs prevents re-scans.
  `expandRange` = view-order range (seqs aren't comparable across sources).

Extracted pieces (in `src/components/log/`), all moved from LogView with
behavior preserved:

| Piece | Contents |
|---|---|
| `LogRow.tsx` | memoized row + spanCache; new optional `prefix`, `time`, `addr` props |
| `LogSearchBar.tsx` | search bar UI (Aa, `.*`, filter, prev/next, count, close) |
| `useFrameVersion.ts` | rAF-gated version subscription, generic selector |
| `useLogViewport.ts` | scroll/follow/stick/virtualizer/savedAddr restore/flash/jump/pill counter |
| `useLogSearch.ts` | query state, debounce, matches (addresses), eviction prune; + `useJsonCollapse` |
| `useLogSelection.ts` | anchor/picks (keyed by `model.key`), shift/⌘-click, copy |
| `useLogKeys.ts` | ⌘F yield-to-errors-dock, Esc, ⌘C, Ctrl+L (optional), F8, ↑/↓ |

## Combined view behaviors

- **Click a row** = select + publish `inspectLine` (routes right dock), no tab
  switch. "Open source tab" moves into the dock.
- **Search**: regex + match-case + live filter mode + level chips (Err/Warn) +
  match count/prev/next with flash — full LogView parity.
- **Timestamps**: `LogLine.at` stamped once per batch in parseWorker
  (receive time, ≤33 ms precision). Toggleable `HH:MM:SS` column; combined
  defaults on, LogView gains the same toggle defaulting off.
- **Wrap**, **multi-line selection/copy** (compose format `name  | raw`),
  **"↓ N new lines" pill**, **saved scroll restore** across tab switches.
- **Chips**: click = mute/unmute; ⌥click = solo (mute all others) / un-solo.
- **Syntax toggle** like LogView, persisted per collection.

## Right dock (Inspector) on combined tabs

- `inspectorAvailable` includes `combined`.
- Tabs: **Inspect / JSON / Errors** (no Overview — toolbar already has
  start/stop all). `overview` dock state renders as `inspect` on combined.
- Inspect panel shows an **origin badge** (source name + conn color) and two
  actions: **Jump** → `jumpToCombinedLine` (focus + flash in the combined
  view; auto-unmutes the source if muted; toast if evicted) and
  **Open source tab** → `openSourceTab` + `jumpToLine`.
- **Errors** aggregates every member's error index into one list sorted by
  `lastAt` desc, each group tagged with a source chip. Clear clears all
  members (confirm dialog). `ErrorsPanel` is generalized to take
  `(group, sourceId, source)` entries; the single-source dock builds entries
  from its own snapshot.

## Store

- `jumpTarget` gains optional `combinedId`; `jumpToCombinedLine(collectionId,
  sourceId, seq)` activates the combined tab. LogView ignores combined-scoped
  targets; CombinedView consumes targets whose `combinedId` matches.

## Error handling

- Invalid regex → "bad regex" badge; search/filter match nothing (existing).
- Matches pruned by `isAlive` on version bumps (evicted lines only —
  filtered-out matches are kept, jump skips them; parity with LogView).
- Deleted collection / membership change → index reset (existing).
- Dock jump to a muted source unmutes then jumps; to an evicted line → toast.

## Performance guardrails

- Merged filtering is incremental per batch; full regex rescans only on
  option changes (debounced 150 ms). Prune passes are Set/existence checks,
  not regex.
- Combined moves to the rAF-gated frame version (was: one render per batch).
- Wrap height estimates subtract the prefix/time column width.
- After the refactor, the `?bench` FPS harness must show no LogView
  regression.

## Testing

- `logModel.test.ts`: RingModel filter/search/expandRange parity incl.
  eviction; MergedModel interleave, mute/level/query, incremental scan
  correctness across eviction, totalAppended, view-order expandRange.
- Existing `merged.test.ts` suite stays green (additions covered there).
- Component layer: manual verify + bench (no component test harness exists).

## Deliberate behavior deltas (documented, intended)

1. Combined: click no longer switches to the source tab (moved to dock).
2. Combined re-renders are rAF-coalesced (perf win).
3. Combined gains scroll restore across tab switches (was lost before).
