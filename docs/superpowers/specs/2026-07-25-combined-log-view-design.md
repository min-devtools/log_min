# Combined Log View (docker-compose-style) — Design

2026-07-25. Approved by Min.

## Goal

One tab that interleaves the live output of every source in a collection, the way
`docker compose logs -f` interleaves services: arrival order, colored
`name |` prefix per source, follow by default.

## Scope decisions (Min)

- **Collection-scoped only.** Open from a collection's context menu (and ⌘K
  palette). No ad-hoc multi-select of arbitrary sources.
- **Lean first.** Merged stream + search + follow/pause + per-source mute
  chips. No error dock, no inspect/JSON dock, no stdin in the combined view —
  clicking a line jumps to that source's own tab where all of that already
  exists.
- **Start/Stop all.** Toolbar ▶/■ run `startSource`/`stopSource` over every
  member (compose up/down feel).

## Ordering model

`LogLine` has no timestamp; the only cross-source ordering that exists is
arrival order — exactly what compose shows. Merge granularity is the **batch**
(≤500 lines), not the line:

- New module `src/lib/merged.ts` keeps one global append-only ledger:
  `{ sourceId, startSeq, endSeq }` pushed for every parsed batch, in arrival
  order, at the single place batches already land (App.tsx batch handler).
- Batch-level entries make the ledger tiny (one object per batch, not per
  line). A ledger byte/entry cap mirrors the ring philosophy; entries whose
  `endSeq < ring.startSeq` (fully evicted) are pruned on scan.
- The combined view derives its visible line list by filtering the ledger to
  member sourceIds, expanding entries against each source's existing `Ring`,
  and skipping seqs the ring has evicted.

History opened later is interleaved at batch resolution — acceptable; compose
gives no better guarantee.

## Tab model

- New `TabKind: "combined"`, tab id `comb-${collectionId}`, singleton per
  collection (owner-scoped, per family convention). Title = collection name,
  dot/color = collection's `ConnColor`.
- Store: `openCombinedTab(collectionId)`. Deleting the collection closes the
  tab. Tab restores with the session like other non-transient tabs.

## Rendering

- New `src/components/views/CombinedView.tsx`, virtualized like LogView.
- Each row: fixed-width colored source-name prefix (`api      | ...`), then the
  line rendered with the existing level/ANSI span logic — reuse LogView's row
  pieces where extraction is cheap; do not restructure LogView.
- Per-source prefix colors auto-assigned deterministically from the `--conn-*`
  palette by member index. Not persisted, no picker.

## Toolbar

- ▶ Start all / ■ Stop all (loop existing store actions).
- Follow toggle (auto-scroll, pause on user scroll — same behavior as LogView).
- Search over the merged visible list (reuse the existing search UI pattern).
- One chip per member source (name + color); click toggles that source's lines
  visible/hidden. Mute state is view-local, not persisted.

## Interactions

- Click a line → `jumpToLine(sourceId, seq)`: focuses/opens the source's own
  tab and flashes the line (mechanism already exists).
- Reactivity: subscribe to member sources' existing `bufVersions`; no new
  event plumbing.

## Explicitly out (add by need)

Timestamps/clock-based merge, error dock inside combined, stdin box, ad-hoc
source selection, persisting the merged buffer, per-source color picker.
