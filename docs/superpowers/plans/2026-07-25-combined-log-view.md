# Combined Log View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tab per collection that interleaves member sources' live output in arrival order, docker-compose style: colored `name |` prefix, follow, search, mute chips, start/stop all.

**Architecture:** A global append-only batch ledger (`{sourceId, startSeq, endSeq}` per parsed batch) records arrival order at the single ingest point. A per-view `MergedIndex` expands ledger entries for member sources into `{sourceId, seq}` rows, pruning evicted seqs against each source's existing `Ring`. `CombinedView` renders those rows with fixed-height windowing (LogView's non-wrap path), reusing `lineTokens`/`renderSpans` for per-line rendering. Line click jumps to the source's own tab (existing `jumpToLine`).

**Tech Stack:** React + zustand + vitest (existing). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-25-combined-log-view-design.md`

## Global Constraints

- **NO git commits, ever.** Committing is the human's job (user CLAUDE.md). At each "checkpoint" step just report what is ready; do not run `git add`/`git commit`.
- The working tree already has the user's own uncommitted work (many files). Do not revert or reformat anything you didn't change.
- Pre-existing test failure: `highlight.test.ts` "lineTokens keeps guessed tokens…" already fails before this work. Ignore it; do not fix; do not count it as a regression.
- Test runner: `npm test` (vitest run). Targeted: `npx vitest run src/lib/merged.test.ts`.
- Style: match existing code — comments only for non-obvious constraints, 2-space indent, no semicolonless style.
- No new dependencies, no timestamps in the merge (arrival order only), no error dock / inspect dock / stdin in the combined view.

---

### Task 1: Merged ledger + MergedIndex (`src/lib/merged.ts`)

**Files:**
- Create: `src/lib/merged.ts`
- Create: `src/lib/merged.test.ts`

**Interfaces:**
- Consumes: `bufferFor(sourceId)` / `Ring` from `src/lib/ring.ts` (`startSeq`, `indexOfSeq(seq)`, `push`).
- Produces (later tasks rely on these exact names):
  - `recordBatch(sourceId: string, startSeq: number, endSeq: number): void`
  - `interface MergedRef { sourceId: string; seq: number }`
  - `class MergedIndex { constructor(cap?: number); update(members: ReadonlySet<string>): readonly MergedRef[]; reset(): void }`
  - `_resetLedgerForTests(): void`

- [ ] **Step 1: Write the failing test**

Create `src/lib/merged.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { bufferFor, dropBuffer } from "./ring";
import { MergedIndex, recordBatch, _resetLedgerForTests } from "./merged";
import type { LogLine } from "./types";

let n = 0;
const uid = () => `m${n++}`;

const mk = (count: number, tag: string): LogLine[] =>
  Array.from({ length: count }, (_, i) => ({ seq: 0, raw: `${tag}${i}`, stream: "out" as const }));

/** mirrors ingestParsed: ring.push renumbers seqs, then the batch is recorded */
function push(id: string, count: number, tag = "x"): void {
  const ring = bufferFor(id);
  const lines = mk(count, tag);
  ring.push(lines);
  recordBatch(id, lines[0].seq, lines[lines.length - 1].seq);
}

beforeEach(() => _resetLedgerForTests());

describe("MergedIndex", () => {
  test("interleaves batches across sources in arrival order", () => {
    const a = uid(), b = uid();
    push(a, 2, "a"); // a0 a1
    push(b, 1, "b"); // b0
    push(a, 1, "a-late-");
    const idx = new MergedIndex();
    const rows = idx.update(new Set([a, b]));
    expect(rows.map((r) => r.sourceId)).toEqual([a, a, b, a]);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 0, 2]);
    dropBuffer(a); dropBuffer(b);
  });

  test("ignores non-member sources", () => {
    const a = uid(), other = uid();
    push(a, 1);
    push(other, 5);
    const rows = new MergedIndex().update(new Set([a]));
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe(a);
    dropBuffer(a); dropBuffer(other);
  });

  test("update is incremental — second call appends only new batches", () => {
    const a = uid();
    const idx = new MergedIndex();
    push(a, 2);
    expect(idx.update(new Set([a]))).toHaveLength(2);
    push(a, 3);
    expect(idx.update(new Set([a]))).toHaveLength(5);
    dropBuffer(a);
  });

  test("prunes rows whose lines were evicted from the ring", () => {
    const a = uid();
    bufferFor(a).setCap(100);
    const idx = new MergedIndex();
    push(a, 100);
    idx.update(new Set([a]));
    push(a, 100); // ring evicts in chunks; older seqs leave the ring
    const rows = idx.update(new Set([a]));
    const start = bufferFor(a).startSeq;
    expect(rows.every((r) => r.seq >= start)).toBe(true);
    expect(rows).toHaveLength(bufferFor(a).length);
    dropBuffer(a);
  });

  test("caps its own row count", () => {
    const a = uid();
    const idx = new MergedIndex(50);
    push(a, 200);
    const rows = idx.update(new Set([a]));
    expect(rows.length).toBeLessThanOrEqual(50);
    // the newest lines survive the trim
    expect(rows[rows.length - 1].seq).toBe(199);
    dropBuffer(a);
  });

  test("survives ledger trimming without re-adding or corrupting", () => {
    const a = uid();
    bufferFor(a).setCap(100);
    const idx = new MergedIndex();
    for (let i = 0; i < 25_000; i++) push(a, 1); // exceeds LEDGER_CAP, forces trim
    const rows = idx.update(new Set([a]));
    expect(rows).toHaveLength(bufferFor(a).length);
    expect(rows[rows.length - 1].seq).toBe(24_999);
    dropBuffer(a);
  });

  test("reset clears rows and re-reads the surviving ledger", () => {
    const a = uid();
    const idx = new MergedIndex();
    push(a, 3);
    idx.update(new Set([a]));
    idx.reset();
    expect(idx.update(new Set([a]))).toHaveLength(3);
    dropBuffer(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/merged.test.ts`
Expected: FAIL — cannot resolve `./merged`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/merged.ts`:

```ts
import { bufferFor } from "./ring";

/** one entry per parsed batch, in arrival order — the only cross-source ordering that exists */
interface LedgerEntry {
  sourceId: string;
  startSeq: number;
  endSeq: number;
}

/** ~20k batches ≈ several rings' worth of lines; entries are 3 numbers, so this is tiny */
const LEDGER_CAP = 20_000;
/** default row budget per combined view — same ceiling philosophy as RING_CAP */
const MERGED_CAP = 100_000;

const ledger: LedgerEntry[] = [];
/** entries dropped from the head so far — consumers hold ABSOLUTE positions */
let trimmed = 0;

export function recordBatch(sourceId: string, startSeq: number, endSeq: number): void {
  ledger.push({ sourceId, startSeq, endSeq });
  const over = ledger.length - LEDGER_CAP;
  if (over > 0) {
    ledger.splice(0, over);
    trimmed += over;
  }
}

export function _resetLedgerForTests(): void {
  ledger.length = 0;
  trimmed = 0;
}

export interface MergedRef {
  sourceId: string;
  seq: number;
}

/**
 * Per-view merged line index. Expands ledger entries for member sources into
 * per-line refs, incrementally per update; rows whose lines the ring evicted
 * are pruned. Lives OUTSIDE the store for the same reason Ring does.
 */
export class MergedIndex {
  private rows: MergedRef[] = [];
  /** absolute ledger position consumed so far */
  private pos = 0;
  /** last seen ring startSeq per member — change means eviction happened */
  private starts = new Map<string, number>();
  private readonly cap: number;

  constructor(cap = MERGED_CAP) {
    this.cap = cap;
  }

  update(members: ReadonlySet<string>): readonly MergedRef[] {
    const end = trimmed + ledger.length;
    for (let i = Math.max(this.pos, trimmed); i < end; i++) {
      const e = ledger[i - trimmed];
      if (!members.has(e.sourceId)) continue;
      for (let seq = e.startSeq; seq <= e.endSeq; seq++) this.rows.push({ sourceId: e.sourceId, seq });
    }
    this.pos = end;

    let evicted = false;
    for (const id of members) {
      const start = bufferFor(id).startSeq;
      if (this.starts.get(id) !== start) {
        this.starts.set(id, start);
        evicted = true;
      }
    }
    if (evicted || this.rows.length > this.cap) {
      this.rows = this.rows.filter((r) => bufferFor(r.sourceId).indexOfSeq(r.seq) >= 0);
      const over = this.rows.length - this.cap;
      if (over > 0) this.rows.splice(0, over);
    }
    return this.rows;
  }

  reset(): void {
    this.rows = [];
    this.pos = 0;
    this.starts.clear();
  }
}
```

Note the first `update()` on a fresh index sets `starts` for every member, which flips `evicted` and runs one full filter pass — harmless (rows are freshly expanded and all present) and it seeds the eviction watermark.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/merged.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Checkpoint** — report Task 1 done. Do NOT commit.

---

### Task 2: Record batches at the ingest point

**Files:**
- Modify: `src/lib/logmin.ts` (function `ingestParsed`, ~line 73)

**Interfaces:**
- Consumes: `recordBatch` from Task 1.
- Produces: every parsed batch lands in the ledger with post-renumber seqs; nothing else observable.

- [ ] **Step 1: Wire recordBatch**

In `src/lib/logmin.ts` add the import:

```ts
import { recordBatch } from "./merged";
```

In `ingestParsed`, `bufferFor(sourceId).push(tagged)` renumbers `tagged[*].seq` in place. Immediately AFTER that line, add:

```ts
  if (tagged.length) recordBatch(sourceId, tagged[0].seq, tagged[tagged.length - 1].seq);
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — expected: no NEW errors (run it before editing once to snapshot pre-existing ones, if any).
Run: `npx vitest run src/lib/merged.test.ts` — expected: PASS.

- [ ] **Step 3: Checkpoint** — report Task 2 done. Do NOT commit.

---

### Task 3: Tab plumbing + entry points + stub view

**Files:**
- Modify: `src/lib/types.ts` (`TabKind`, `TabDef`)
- Modify: `src/store.ts` (`TAB_META`, `openCombinedTab`, `deleteCollection`, `renameCollection`)
- Modify: `src/App.tsx` (`renderView`)
- Modify: `src/components/TabsBar.tsx` (~line 44, color derivation)
- Modify: `src/components/Sidebar.tsx` (~line 357, `colMenuItems`)
- Modify: `src/components/CommandPalette.tsx` (command list, ~line 86)
- Create: `src/components/views/CombinedView.tsx` (stub)

**Interfaces:**
- Consumes: existing store shape, `ContextMenuItem`, `connStyle`.
- Produces (Task 4 relies on these):
  - `TabKind` includes `"combined"`; `TabDef.collectionId?: string`
  - store action `openCombinedTab(collectionId: string): void`; tab id is `` `comb-${collectionId}` ``
  - `CombinedView` props: `{ tabId: string; collectionId: string; active: boolean }`

- [ ] **Step 1: Types**

`src/lib/types.ts`:

```ts
export type TabKind = "welcome" | "source" | "source-edit" | "settings" | "error-trace" | "combined";
```

In `TabDef`, after the `fingerprint` field add:

```ts
  /** kind === "combined": the collection whose sources this tab interleaves */
  collectionId?: string;
```

- [ ] **Step 2: Store**

`src/store.ts` — add to `TAB_META`:

```ts
  combined: { title: "Combined", icon: "rows", iconClass: "soft-blue" },
```

Add to the `AppState` interface, next to `openSourceTab`:

```ts
  /** open (or focus) the combined docker-compose-style view for a collection */
  openCombinedTab: (collectionId: string) => void;
```

Add the implementation next to `openSourceTab`:

```ts
  openCombinedTab: (collectionId) => {
    const s = get();
    const id = `comb-${collectionId}`;
    if (s.tabs.some((t) => t.id === id)) return set({ activeTabId: id });
    const col = s.collections.find((c) => c.id === collectionId);
    if (!col) return;
    set({
      tabs: [
        ...s.tabs,
        { id, kind: "combined", title: col.name, icon: "rows", iconClass: "soft-blue", collectionId },
      ],
      activeTabId: id,
    });
  },
```

Extend `deleteCollection` so the combined tab dies with its owner — replace the current body with:

```ts
  deleteCollection: (id) => {
    get().closeTab(`comb-${id}`);
    set((s) => ({
      collections: s.collections.filter((c) => c.id !== id),
      sources: s.sources.map((x) => (x.collectionId === id ? { ...x, collectionId: undefined } : x)),
    }));
  },
```

Extend `renameCollection` to keep the tab title in sync (same pattern `saveSource` uses):

```ts
  renameCollection: (id, name) =>
    set((s) => ({
      collections: s.collections.map((c) => (c.id === id ? { ...c, name } : c)),
      tabs: s.tabs.map((t) => (t.collectionId === id ? { ...t, title: name } : t)),
    })),
```

`loadSession` needs no change — combined tabs are neither `error-trace` nor `transient`, so they already restore.

- [ ] **Step 3: Stub view + App wiring**

Create `src/components/views/CombinedView.tsx`:

```tsx
interface Props {
  tabId: string;
  collectionId: string;
  active: boolean;
}

export function CombinedView({ active }: Props) {
  return (
    <section className={`content log-view combined-view ${active ? "active" : ""}`}>
      <div className="empty-note" style={{ padding: 24 }}>Combined view — coming in Task 4.</div>
    </section>
  );
}
```

`src/App.tsx` — import and add the case in `renderView`:

```tsx
import { CombinedView } from "./components/views/CombinedView";
```

```tsx
    case "combined": return <CombinedView key={tab.id} tabId={tab.id} collectionId={tab.collectionId!} active={active} />;
```

- [ ] **Step 4: Tab color**

`src/components/TabsBar.tsx` (~line 44) — combined tabs carry `collectionId` directly; replace the `col` derivation:

```tsx
          const src = tab.sourceId ? sources.find((s) => s.id === tab.sourceId) : undefined;
          const colId = src?.collectionId ?? tab.collectionId;
          const col = colId ? collections.find((c) => c.id === colId) : undefined;
```

- [ ] **Step 5: Entry points**

`src/components/Sidebar.tsx` — prepend to `colMenuItems` (~line 357):

```ts
        { icon: "rows", label: "Open combined view", strong: true, onClick: () => openCombinedTab(menuCollection.id) },
```

Get `openCombinedTab` the same way the file gets its other actions (add it to the existing `useApp.getState()` destructure or equivalent already present in the file).

`src/components/CommandPalette.tsx` — the palette builds commands from `sources`; add per-collection entries after the static commands (~line 86), reading `collections` from the store the same way `sources` is read:

```ts
    ...collections.map((c) => ({
      icon: "rows" as const,
      label: `Combined logs: ${c.name}`,
      action: () => openCombinedTab(c.id),
    })),
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` — no new errors.
Run: `npm test` — same result as baseline (only the pre-existing `highlight.test.ts` failure).
Manual: `npm run tauri dev` → right-click a collection → "Open combined view" → tab opens titled with the collection name, collection color dot, stub text. Rename collection → tab retitles. Delete collection → tab closes.

- [ ] **Step 7: Checkpoint** — report Task 3 done. Do NOT commit.

---

### Task 4: CombinedView — merged render, follow, chips, search, start/stop all

**Files:**
- Rewrite: `src/components/views/CombinedView.tsx`
- Modify: `src/styles/views.css` (append combined styles at the end)

**Interfaces:**
- Consumes: `MergedIndex`/`MergedRef` (Task 1), `bufferFor`, `lineTokens`/`renderSpans`/`findMarks` from `src/lib/highlight`, `rawLogText` from `src/lib/logPresentation`, store actions `startSource`/`stopSource`/`openSourceTab`/`jumpToLine`, `CONN_COLORS` from `src/lib/connColor`, `ToolButton`, `Icon`.
- Produces: the complete feature; nothing downstream.

- [ ] **Step 1: Implement the view**

Replace `src/components/views/CombinedView.tsx` with:

```tsx
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
  const membersKey = members.join(" ");
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
    [rows, muted],
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
```

- [ ] **Step 2: CSS**

Append to `src/styles/views.css`:

```css
/* ── combined (docker-compose-style) view ─────────────────────────────── */
.combined-prefix {
  display: inline-block;
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  margin-right: 10px;
  padding-right: 8px;
  border-right: 1px solid var(--border);
  opacity: 0.9;
  user-select: none;
}
.combined-chips {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}
.combined-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  white-space: nowrap;
}
.combined-chip .conn-dot { background: var(--conn); }
.combined-chip.muted { opacity: 0.45; }
.combined-chip.muted .conn-dot { background: var(--text-dim); }
```

Check `--border` / `--text` / `--text-dim` are the token names this codebase actually uses (`grep -o -- '--[a-z-]*' src/styles/views.css | sort -u | head -30`) and substitute the real ones if they differ. `.log-line` already positions rows absolutely inside `.log-spacer`; if `.log-line` is not `display: flex`, add `.combined-view .log-line { display: flex; align-items: baseline; }`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — no new errors.
Run: `npm test` — baseline only.
Manual (`npm run tauri dev`):
1. Collection with 2+ cmd sources → Open combined view → ▶ starts all; lines interleave with colored right-aligned prefixes.
2. Chip click hides that source's lines; click again restores.
3. Scroll up → follow pauses; scroll to bottom → resumes; ⌘↵ toggles.
4. ⌘F, type a string → count shows, ↵ cycles, matches highlighted.
5. Click a line → source's own tab opens/focuses and flashes that line.
6. ■ stops everything.

- [ ] **Step 4: Checkpoint** — report Task 4 done. Do NOT commit.

---

### Task 5: Final verification

- [ ] **Step 1:** `npx tsc --noEmit` — no new errors vs baseline.
- [ ] **Step 2:** `npm test` — everything passes except the pre-existing `highlight.test.ts` failure.
- [ ] **Step 3:** Manual smoke of the full flow (open, start all, mute, search, jump, rename collection → tab retitles, delete collection → tab closes, relaunch app → combined tab restores).
- [ ] **Step 4:** Report done with a summary of every file touched. The human reviews and commits.
