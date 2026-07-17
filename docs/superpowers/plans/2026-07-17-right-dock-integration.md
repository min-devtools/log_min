# Integrated Right Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the right dock into a four-tab source workspace (Overview / Inspect / JSON / Errors) fed by a bounded per-source insight index and a rich selected-line snapshot.

**Architecture:** Three pure libs carry all new logic (`insight.ts` stats index, `dockTab.ts` tab-routing reducer, `shouldAutoRouteJson` in `json.ts`), wired through the existing outside-Zustand index pattern (like `ring.ts`/`errors.ts`). `Inspector.tsx` becomes a thin shell over four panel components. The center-pane JSON modal in `LogView.tsx` is removed.

**Tech Stack:** React 18 + Zustand 5 + Tauri 2 + Vitest 4. No new dependencies.

## Global Constraints

- **NO GIT COMMITS BY AGENTS.** Per user CLAUDE.md, committing is the human's job. Each task ends with a "checkpoint" step: stop, report the suggested commit message, let the human commit. Never run `git commit`/`git push`.
- No new npm or cargo dependencies.
- Pure vitest tests only — this repo has no jsdom/component-test infra; component behavior is covered by the pure reducer + manual verification in Task 8.
- App CSS lives ONLY in `src/styles/views.css`. The other files in `src/styles/` are symlinks into a shared design system — never edit them.
- Reuse existing CSS tokens: `--text-primary`, `--text-muted`, `--text-secondary`, `--border-default`, `--surface-raised`, `--status-danger`, `--font-mono`, `--editor-bg`.
- TypeScript check is `npm run build` (runs `tsc` first). Tests are `npm test` (`vitest run`).
- Per-source indexes (ring, error index, insight index) live outside Zustand; React subscribes via version counters already in the store.

## Design decisions resolved during spec review

These four decisions refine the spec (`docs/superpowers/specs/2026-07-17-right-dock-integration-design.md`) and are binding for this plan:

1. **JSON auto-route threshold:** a line auto-opens the JSON tab only when the extracted JSON is a non-empty object (anywhere in the line), or an array covering ≥ 50% of the trimmed line. Bare fragments like `[3]` inside prose route to Inspect. Manual clicks on the JSON tab always work.
2. **Selection-modifier stability:** only a plain click publishes a new selected line (and may re-route the dock). Shift-click / ⌘-click (range/toggle for copy) never change the published line — except ⌘-clicking away the *last* pick, which clears it.
3. **Deselect returns to Overview only from auto-opened tabs:** if the user manually chose a tab, clearing the selection leaves the tab alone.
4. **Insight index owns only what nothing else tracks:** 60 one-second buckets (lines/errors/warns) plus cumulative warn count. Total lines/errors/dropped stay in `SourceRuntime`; error groups stay in `ErrorIndex`. No double counting.

---

### Task 1: InsightIndex — bounded per-source ingest stats

**Files:**
- Create: `src/lib/insight.ts`
- Test: `src/lib/insight.test.ts`

**Interfaces:**
- Consumes: `LogLine` from `src/lib/types.ts` (uses only `.level`).
- Produces: `class InsightIndex { feed(lines: LogLine[], atMs: number): void; snapshot(atMs: number): InsightSnapshot; clear(): void }`, `interface InsightSnapshot { totalWarns: number; lines60: number; errors60: number; warns60: number; linesPerSec: number }`, `insightIndexFor(sourceId: string): InsightIndex`, `dropInsightIndex(sourceId: string): void`. Tasks 5–7 rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `src/lib/insight.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InsightIndex } from "./insight";
import type { LogLine } from "./types";

const line = (level?: LogLine["level"]): LogLine => ({ seq: 0, raw: "x", stream: "out", level });

describe("InsightIndex", () => {
  it("counts lines, errors, and warnings into the current window", () => {
    const ix = new InsightIndex();
    ix.feed([line(), line("err"), line("warn"), line("warn")], 10_000);
    const s = ix.snapshot(10_500);
    expect(s.lines60).toBe(4);
    expect(s.errors60).toBe(1);
    expect(s.warns60).toBe(2);
    expect(s.totalWarns).toBe(2);
  });

  it("keeps cumulative warns but expires windowed counts after 60s", () => {
    const ix = new InsightIndex();
    ix.feed([line("warn"), line("err")], 10_000);
    const s = ix.snapshot(10_000 + 61_000);
    expect(s.lines60).toBe(0);
    expect(s.errors60).toBe(0);
    expect(s.warns60).toBe(0);
    expect(s.totalWarns).toBe(1);
  });

  it("computes a rolling lines-per-second rate over the last 5 seconds", () => {
    const ix = new InsightIndex();
    // 10 lines/s for 5 consecutive seconds
    for (let t = 0; t < 5; t++) {
      ix.feed(Array.from({ length: 10 }, () => line()), 20_000 + t * 1000);
    }
    expect(ix.snapshot(24_500).linesPerSec).toBeCloseTo(10, 5);
    // 6s later the rate window is empty but the 60s window still counts them
    const later = ix.snapshot(24_500 + 6_000);
    expect(later.linesPerSec).toBe(0);
    expect(later.lines60).toBe(50);
  });

  it("drops buckets older than the window so memory stays bounded", () => {
    const ix = new InsightIndex();
    for (let t = 0; t < 200; t++) ix.feed([line()], t * 1000);
    // internal bucket array is private — bound is observable via snapshot correctness
    expect(ix.snapshot(199_500).lines60).toBe(60);
  });

  it("clear() resets everything", () => {
    const ix = new InsightIndex();
    ix.feed([line("warn")], 10_000);
    ix.clear();
    const s = ix.snapshot(10_000);
    expect(s.totalWarns).toBe(0);
    expect(s.lines60).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/insight.test.ts`
Expected: FAIL — `Cannot find module './insight'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `src/lib/insight.ts`:

```ts
import type { LogLine } from "./types";

/** seconds of per-second history retained per source */
export const INSIGHT_WINDOW = 60;
/** rolling lines/sec is averaged over this many seconds */
const RATE_WINDOW = 5;

interface Bucket {
  sec: number;
  lines: number;
  errors: number;
  warns: number;
}

export interface InsightSnapshot {
  /** cumulative warnings since start/clear (errors live in SourceRuntime) */
  totalWarns: number;
  lines60: number;
  errors60: number;
  warns60: number;
  linesPerSec: number;
}

/**
 * Bounded per-source ingest stats. Lives OUTSIDE the zustand store like
 * Ring/ErrorIndex; the Overview tab reads snapshots imperatively. The clock is
 * always a parameter so tests never sleep.
 */
export class InsightIndex {
  private buckets: Bucket[] = [];
  private totalWarns = 0;

  feed(lines: LogLine[], atMs: number): void {
    const sec = Math.floor(atMs / 1000);
    let bucket = this.buckets[this.buckets.length - 1];
    if (!bucket || bucket.sec !== sec) {
      bucket = { sec, lines: 0, errors: 0, warns: 0 };
      this.buckets.push(bucket);
      // drop expired buckets — the array never exceeds the 60s window
      const min = sec - INSIGHT_WINDOW + 1;
      let cut = 0;
      while (cut < this.buckets.length && this.buckets[cut].sec < min) cut++;
      if (cut) this.buckets.splice(0, cut);
    }
    for (const l of lines) {
      bucket.lines++;
      if (l.level === "err") bucket.errors++;
      else if (l.level === "warn") {
        bucket.warns++;
        this.totalWarns++;
      }
    }
  }

  snapshot(atMs: number): InsightSnapshot {
    const sec = Math.floor(atMs / 1000);
    const min = sec - INSIGHT_WINDOW + 1;
    let lines60 = 0;
    let errors60 = 0;
    let warns60 = 0;
    let rateLines = 0;
    for (const b of this.buckets) {
      if (b.sec < min || b.sec > sec) continue;
      lines60 += b.lines;
      errors60 += b.errors;
      warns60 += b.warns;
      if (b.sec > sec - RATE_WINDOW) rateLines += b.lines;
    }
    return { totalWarns: this.totalWarns, lines60, errors60, warns60, linesPerSec: rateLines / RATE_WINDOW };
  }

  clear(): void {
    this.buckets = [];
    this.totalWarns = 0;
  }
}

const indexes = new Map<string, InsightIndex>();

export function insightIndexFor(sourceId: string): InsightIndex {
  let index = indexes.get(sourceId);
  if (!index) {
    index = new InsightIndex();
    indexes.set(sourceId, index);
  }
  return index;
}

export function dropInsightIndex(sourceId: string): void {
  indexes.delete(sourceId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/insight.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Checkpoint — human commit**

Report: task done, suggested message `feat: bounded per-source insight index for the dock Overview tab`. Do NOT commit.

---

### Task 2: JSON auto-route rule

**Files:**
- Modify: `src/lib/json.ts` (append one function)
- Test: `src/lib/json.test.ts` (append one describe block)

**Interfaces:**
- Consumes: `extractJson(text)` already in `src/lib/json.ts`.
- Produces: `shouldAutoRouteJson(raw: string): boolean` — Task 7's Inspector shell calls this to pick the JSON vs Inspect tab.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/json.test.ts`:

```ts
import { shouldAutoRouteJson } from "./json";

describe("shouldAutoRouteJson", () => {
  it("routes whole-line and prefixed objects to JSON", () => {
    expect(shouldAutoRouteJson('{"level":30,"msg":"ok"}')).toBe(true);
    expect(shouldAutoRouteJson('2026-07-17 INFO payload {"a":1} tail')).toBe(true);
  });

  it("routes arrays only when they dominate the line", () => {
    expect(shouldAutoRouteJson('[{"a":1},{"b":2}]')).toBe(true);
    expect(shouldAutoRouteJson("retry [3] failed after 5 attempts")).toBe(false);
  });

  it("never routes prose, empty objects, or non-JSON", () => {
    expect(shouldAutoRouteJson("no json here")).toBe(false);
    expect(shouldAutoRouteJson("use {} braces for blocks")).toBe(false);
    expect(shouldAutoRouteJson("server started {unclosed")).toBe(false);
  });
});
```

(Merge the import with the existing `import { extractJson } from "./json";` line: `import { extractJson, shouldAutoRouteJson } from "./json";`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/json.test.ts`
Expected: FAIL — `shouldAutoRouteJson` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/json.ts`:

```ts
/** Should a click on this line auto-open the dock's JSON tab?
 * Only when the line is *about* the JSON: a non-empty object anywhere, or an
 * array covering most of the line — a bare `[3]` inside prose stays in Inspect. */
export function shouldAutoRouteJson(raw: string): boolean {
  const hit = extractJson(raw);
  if (!hit || typeof hit.value !== "object" || hit.value === null) return false;
  if (!Array.isArray(hit.value)) return Object.keys(hit.value).length > 0;
  return hit.end - hit.start >= raw.trim().length * 0.5;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/json.test.ts`
Expected: PASS (existing 4 extractJson tests + 3 new).

- [ ] **Step 5: Checkpoint — human commit**

Report: suggested message `feat: json auto-route rule for the dock`. Do NOT commit.

---

### Task 3: Dock tab reducer

**Files:**
- Create: `src/lib/dockTab.ts`
- Test: `src/lib/dockTab.test.ts`

**Interfaces:**
- Produces: `type DockTab = "overview" | "inspect" | "json" | "errors"`, `interface DockTabState { tab: DockTab; auto: boolean }`, `type DockTabEvent = { type: "select"; route: "json" | "inspect" } | { type: "deselect" } | { type: "manual"; tab: DockTab } | { type: "source-change" }`, `INITIAL_DOCK_TAB: DockTabState`, `dockTabNext(state, event): DockTabState`. Task 7 uses all of these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/dockTab.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INITIAL_DOCK_TAB, dockTabNext, type DockTabState } from "./dockTab";

describe("dockTabNext", () => {
  it("starts on Overview", () => {
    expect(INITIAL_DOCK_TAB).toEqual({ tab: "overview", auto: false });
  });

  it("routes a selection to json or inspect and marks it auto", () => {
    expect(dockTabNext(INITIAL_DOCK_TAB, { type: "select", route: "json" })).toEqual({ tab: "json", auto: true });
    expect(dockTabNext(INITIAL_DOCK_TAB, { type: "select", route: "inspect" })).toEqual({ tab: "inspect", auto: true });
  });

  it("returns to Overview on deselect only from an auto-opened tab", () => {
    const auto: DockTabState = { tab: "json", auto: true };
    const manual: DockTabState = { tab: "errors", auto: false };
    expect(dockTabNext(auto, { type: "deselect" })).toEqual(INITIAL_DOCK_TAB);
    expect(dockTabNext(manual, { type: "deselect" })).toBe(manual);
  });

  it("keeps a manual tab stable until the next selection or source change", () => {
    const manual = dockTabNext({ tab: "json", auto: true }, { type: "manual", tab: "errors" });
    expect(manual).toEqual({ tab: "errors", auto: false });
    expect(dockTabNext(manual, { type: "select", route: "json" })).toEqual({ tab: "json", auto: true });
    expect(dockTabNext(manual, { type: "source-change" })).toEqual(INITIAL_DOCK_TAB);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/dockTab.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dockTab.ts`:

```ts
export type DockTab = "overview" | "inspect" | "json" | "errors";

export interface DockTabState {
  tab: DockTab;
  /** true when the dock opened this tab itself (line selection) — deselect may undo it */
  auto: boolean;
}

export type DockTabEvent =
  | { type: "select"; route: "json" | "inspect" }
  | { type: "deselect" }
  | { type: "manual"; tab: DockTab }
  | { type: "source-change" };

export const INITIAL_DOCK_TAB: DockTabState = { tab: "overview", auto: false };

export function dockTabNext(state: DockTabState, event: DockTabEvent): DockTabState {
  switch (event.type) {
    case "select":
      return { tab: event.route, auto: true };
    case "deselect":
      return state.auto ? INITIAL_DOCK_TAB : state;
    case "manual":
      return { tab: event.tab, auto: false };
    case "source-change":
      return INITIAL_DOCK_TAB;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/dockTab.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Checkpoint — human commit**

Report: suggested message `feat: pure dock-tab routing reducer`. Do NOT commit.

---

### Task 4: ErrorGroup.headSeq — jump to the trace head

**Files:**
- Modify: `src/lib/errors.ts`
- Test: `src/lib/errors.test.ts` (append)

**Interfaces:**
- Produces: `ErrorGroup.headSeq: number` — seq of the FIRST line of the LATEST occurrence. Task 7's ErrorsPanel jumps to `group.headSeq` instead of `group.lastSeq`.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("ErrorIndex", ...)` block in `src/lib/errors.test.ts` (reuse the file's existing `tagged`/`feed` helpers):

```ts
  it("tracks headSeq as the first line of the latest occurrence", () => {
    const index = new ErrorIndex();
    const trace = [
      "TypeError: boom",
      "    at fn (/app/src/a.ts:10:5)",
    ];
    feed(index, tagged([...trace, "plain line"], 0));
    feed(index, tagged([...trace, "plain line"], 3));
    const group = index.snapshot().groups[0];
    expect(group.count).toBe(2);
    expect(group.headSeq).toBe(3); // head of the SECOND occurrence
    expect(group.firstSeq).toBe(0); // first-ever stays put
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/errors.test.ts`
Expected: FAIL — `headSeq` is `undefined` (and a TS error on the property until Step 3).

- [ ] **Step 3: Write the implementation**

In `src/lib/errors.ts`:

1. Add the field to the interface, after `lastSeq: number;`:

```ts
  /** seq of the first line of the LATEST occurrence — the jump target ("trace head") */
  headSeq: number;
```

2. In `occurrenceFrom`, add `headSeq: first.seq,` to the returned object (next to `firstSeq: first.seq,`).

Merging needs no change: both merge sites spread the NEW occurrence (`{ ...current, ... }` / `{ ...occurrence, ... }`) and only pin `firstSeq`/`firstAt` from the existing group, so `headSeq` naturally tracks the latest occurrence.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/errors.test.ts`
Expected: PASS (all existing tests + 1 new).

- [ ] **Step 5: Checkpoint — human commit**

Report: suggested message `feat: error groups expose the latest trace head seq`. Do NOT commit.

---

### Task 5: SelectedLine snapshot + store/ingest wiring

**Files:**
- Modify: `src/lib/types.ts` (add interface)
- Modify: `src/store.ts` (retype `inspectLine`, drop insight index on delete)
- Modify: `src/lib/logmin.ts` (feed the insight index)

No new pure test — this is type plumbing; `npm run build` is the check, and Task 1's tests already cover the index.

**Interfaces:**
- Consumes: `insightIndexFor`/`dropInsightIndex` from Task 1.
- Produces: `interface SelectedLine { sourceId: string; seq: number; raw: string; stream: LogStream; level?: LogLevel; traceId?: number }` in `src/lib/types.ts`; store field `inspectLine: SelectedLine | null` and `setInspectLine(line: SelectedLine | null)`. Tasks 6–7 rely on this exact shape.

- [ ] **Step 1: Add the type**

In `src/lib/types.ts`, after the `LogLine` interface:

```ts
/** snapshot of the line last plain-clicked in a LogView — drives the dock's
 * Inspect/JSON tabs and survives ring eviction */
export interface SelectedLine {
  sourceId: string;
  seq: number;
  raw: string;
  stream: LogStream;
  level?: LogLevel;
  traceId?: number;
}
```

- [ ] **Step 2: Retype the store field**

In `src/store.ts`:

1. Extend the type import: `import type { SelectedLine, SourceDef, SourceRuntime, StatusPayload, TabDef, TabKind } from "./lib/types";`
2. Add import: `import { dropInsightIndex } from "./lib/insight";`
3. Replace the `inspectLine` declaration (line ~90):

```ts
  /** line last plain-clicked in a LogView — routes and feeds the right dock */
  inspectLine: SelectedLine | null;
```

4. Retype the setter in the interface: `setInspectLine: (line: SelectedLine | null) => void;` (implementation body is unchanged).
5. In `deleteSource`, next to `dropBuffer(id); dropErrorIndex(id);` add `dropInsightIndex(id);`.

- [ ] **Step 3: Feed the index at ingest**

In `src/lib/logmin.ts`:

1. Add import: `import { insightIndexFor } from "./insight";`
2. In the `log:batch` listener, immediately after `bufferFor(sourceId).push(tagged);`:

```ts
    insightIndexFor(sourceId).feed(tagged, Date.now());
```

No new store version counter — `onBatch` already bumps `bufVersions` for every batch, which is what the Overview tab subscribes to.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: `tsc` clean, vite build succeeds.
Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 5: Checkpoint — human commit**

Report: suggested message `feat: rich selected-line snapshot + insight index wiring`. Do NOT commit.

---

### Task 6: LogView — selection publishing rules, modal removal

**Files:**
- Modify: `src/components/views/LogView.tsx`
- Delete: `src/ui/JsonView.tsx` (only if step 6 confirms it is unused)

**Interfaces:**
- Consumes: `SelectedLine` store shape from Task 5.
- Produces: LogView publishes `setInspectLine` ONLY on plain click / `{}` button / last-pick removal. No more `inspect` overlay state.

- [ ] **Step 1: Add the publish helper**

In `LogView.tsx`, after the `copyText` callback (~line 235), add:

```tsx
  const publishLine = useCallback(
    (l: LogLine | null) =>
      setInspectLine(
        l ? { sourceId, seq: l.seq, raw: l.raw, stream: l.stream, level: l.level, traceId: l.traceId } : null,
      ),
    [setInspectLine, sourceId],
  );
```

- [ ] **Step 2: Rewrite `onRowClick` with the modifier rules**

Replace the whole `onRowClick` function with:

```tsx
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
```

- [ ] **Step 3: Remove the modal**

Still in `LogView.tsx`, remove all of:

1. State: `const [inspect, setInspect] = useState<LogLine | null>(null);` and its comment (~line 62–63).
2. The Escape branch in the keydown handler (~line 263–266):

```tsx
      if (e.key === "Escape" && inspect) {
        setInspect(null);
        return;
      }
```

   and drop `inspect` from that effect's dependency array.
3. The `onDoubleClick={() => setInspect(l)}` prop on the row div (~line 414).
4. The entire `{inspect && (() => { ... })()}` overlay block (~lines 652–682).
5. The import `import { JsonView } from "../../ui/JsonView";` and the now-unused `LogLine`-typed modal code.

- [ ] **Step 4: Repoint the `{}` button at the dock**

Replace the `{}` button (~lines 417–430) with:

```tsx
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
```

- [ ] **Step 5: Clear the insight index with the buffer**

In the "Clear buffer" ToolButton onClick, next to `errorIndexFor(sourceId).clear();` add:

```tsx
              insightIndexFor(sourceId).clear();
```

with import `import { insightIndexFor } from "../../lib/insight";`.

- [ ] **Step 6: Delete JsonView if orphaned**

Run: `grep -rn "JsonView" src/`
Expected: no matches outside `src/ui/JsonView.tsx` itself. If so, delete `src/ui/JsonView.tsx`. If other matches exist, leave the file and note it in the report.

- [ ] **Step 7: Verify**

Run: `npm run build && npm test`
Expected: both PASS.

- [ ] **Step 8: Checkpoint — human commit**

Report: suggested message `feat: dock-first line selection; remove center JSON modal`. Do NOT commit.

---

### Task 7: Four-tab Inspector — shell + panels + CSS

**Files:**
- Rewrite: `src/components/Inspector.tsx` (becomes the shell)
- Create: `src/components/inspector/OverviewPanel.tsx`
- Create: `src/components/inspector/InspectPanel.tsx`
- Create: `src/components/inspector/JsonPanel.tsx`
- Create: `src/components/inspector/ErrorsPanel.tsx`
- Modify: `src/styles/views.css` (append dock styles)

**Interfaces:**
- Consumes: `dockTabNext`/`INITIAL_DOCK_TAB` (Task 3), `shouldAutoRouteJson` (Task 2), `insightIndexFor` (Task 1), `ErrorGroup.headSeq` (Task 4), `SelectedLine` (Task 5), existing `errorIndexFor`, `MiniTabs`, `JsonEditor`, `frameLocation`, `openFrame`.
- Produces: `Inspector` (same export, same import path — `App.tsx` needs no change).

- [ ] **Step 1: Create `src/components/inspector/ErrorsPanel.tsx`**

Move the existing error UI out of `Inspector.tsx` mechanically — `GroupButton`, `FrameRow`, `fmtTime`, and the error-dock JSX move here unchanged except: (a) jumps use `group.headSeq`, (b) the redundant `<span>Selected error</span>` label is dropped.

```tsx
import { type ReactNode } from "react";
import { openFrame } from "../../lib/editor";
import type { ErrorGroup, ErrorSnapshot } from "../../lib/errors";
import { frameLocation } from "../../lib/logPresentation";
import type { Frame, SourceDef } from "../../lib/types";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();

function GroupButton({ group, active, source, onClick }: {
  group: ErrorGroup;
  active: boolean;
  source?: SourceDef;
  onClick: () => void;
}) {
  const origin = group.topFrame ? frameLocation(group.topFrame, source) : null;
  return (
    <button
      type="button"
      className={`error-group ${active ? "active" : ""}`}
      title="Show details and flash the trace head in the log"
      onClick={onClick}
    >
      <span className="error-group-topline">
        <span className="error-group-kind">{group.frames.length ? "trace" : "error"}</span>
        <span className="error-group-count">{group.count}×</span>
      </span>
      <strong>{group.message}</strong>
      <span className="error-group-meta">
        <span>{origin ? `${origin.file}:${origin.position}` : "No application frame"}</span>
        <span>{fmtTime(group.lastAt)} · #{group.headSeq + 1}</span>
      </span>
    </button>
  );
}

function FrameRow({ frame, index, source, onOpen, onCopy }: {
  frame: Frame;
  index: number;
  source?: SourceDef;
  onOpen: (frame: Frame) => void;
  onCopy: (text: string) => void;
}) {
  const location = frameLocation(frame, source);
  return (
    <div className={`error-frame ${frame.isApp ? "app" : "runtime"}`}>
      <button
        type="button"
        className="error-frame-main"
        title={frame.isApp ? `Open ${location.full} · ⌥click copies` : `Copy ${location.full}`}
        onClick={(event) => {
          if (!frame.isApp || event.altKey) onCopy(location.full);
          else onOpen(frame);
        }}
      >
        <span className="error-frame-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="error-frame-content">
          <span className="error-frame-source">
            <strong>{location.file}</strong>
            <span>{location.position}</span>
          </span>
          <span className="error-frame-function">{frame.fn || "anonymous"}</span>
          <span className="error-frame-path">{location.parent || location.resolvedPath}</span>
        </span>
      </button>
      <button
        type="button"
        className="error-frame-copy"
        title={`Copy ${location.full}`}
        aria-label={`Copy source location ${location.full}`}
        onClick={() => onCopy(location.full)}
      >
        <Icon name="copy" size={12} />
      </button>
    </div>
  );
}

export function ErrorsPanel({ sourceId, source, snapshot, selectedFingerprint, onSelect, onCopy }: {
  sourceId?: string;
  source?: SourceDef;
  snapshot: ErrorSnapshot;
  selectedFingerprint: string | null;
  onSelect: (fingerprint: string) => void;
  onCopy: (text: string, label: string) => void;
}): ReactNode {
  const jumpToLine = useApp((s) => s.jumpToLine);
  const showToast = useApp((s) => s.showToast);
  const selected = snapshot.groups.find((g) => g.fingerprint === selectedFingerprint) ?? snapshot.groups[0];
  const origin = selected?.topFrame ? frameLocation(selected.topFrame, source) : null;
  const appFrameCount = selected?.frames.filter((f) => f.isApp).length ?? 0;

  const handleOpen = (frame: Frame) => {
    void openFrame(frame, source).then((opened) => {
      if (!opened) showToast("Copied", "Source location copied. Choose an editor in Settings to open it directly.");
    });
  };

  return (
    <div className="inspector-scroll error-dock">
      {snapshot.groups.length === 0 ? (
        <div className="error-dock-empty">
          <span className="error-dock-empty-icon"><Icon name="zap" size={18} /></span>
          <strong>No errors yet</strong>
          <p>The center stays raw. Parsed errors, stack frames, and source actions appear here.</p>
        </div>
      ) : (
        <>
          <div className="error-group-list" aria-label="Error groups">
            {snapshot.groups.map((group) => (
              <GroupButton
                key={group.fingerprint}
                group={group}
                active={group.fingerprint === selected?.fingerprint}
                source={source}
                onClick={() => {
                  onSelect(group.fingerprint);
                  if (sourceId) jumpToLine(sourceId, group.headSeq);
                }}
              />
            ))}
          </div>

          {selected && (
            <section className="error-detail" aria-label={selected.frames.length ? "Latest stack trace" : "Latest error occurrence"}>
              <div className="error-detail-head">
                <strong>latest #{selected.headSeq + 1} · {selected.count}×</strong>
                <div className="error-detail-actions">
                  <ToolButton
                    iconOnly
                    title="Flash the latest occurrence in the log"
                    aria-label="Jump to line in log"
                    onClick={() => sourceId && jumpToLine(sourceId, selected.headSeq)}
                  >
                    <Icon name="status" size={13} />
                  </ToolButton>
                  <ToolButton title={selected.frames.length ? "Copy the complete latest stack trace" : "Copy the complete raw error"} onClick={() => onCopy(selected.rawLines.join("\n"), selected.frames.length ? `Full stack trace · ${selected.rawLines.length} lines.` : "Complete raw error line.")}>
                    <Icon name="copy" size={13} /> {selected.frames.length ? "Copy trace" : "Copy error"}
                  </ToolButton>
                </div>
              </div>
              <p className="error-detail-message">{selected.message}</p>
              <p className="error-detail-when">
                first {fmtTime(selected.firstAt)} · last {fmtTime(selected.lastAt)}
                {selected.count > 1 ? ` · ${selected.count} occurrences` : ""}
              </p>
              {selected.topFrame && origin && (
                <div className="error-origin">
                  <div className="error-origin-copy">
                    <span>Application origin</span>
                    <strong>{origin.file}<em>{origin.position}</em></strong>
                    <small>{selected.topFrame.fn || "anonymous"}</small>
                    <code>{origin.parent || origin.resolvedPath}</code>
                  </div>
                  <div className="error-origin-actions">
                    <ToolButton className="error-origin-open" title={`Open ${origin.full}`} onClick={() => handleOpen(selected.topFrame!)}>
                      <Icon name="code" size={13} /> Open origin
                    </ToolButton>
                    <ToolButton iconOnly title={`Copy ${origin.full}`} aria-label="Copy application origin" onClick={() => onCopy(origin.full, "Application origin copied.")}>
                      <Icon name="copy" size={13} />
                    </ToolButton>
                  </div>
                </div>
              )}
              {selected.rawLines.length > 0 && (
                <details className="error-raw">
                  <summary>Raw output · {selected.rawLines.length} line{selected.rawLines.length === 1 ? "" : "s"}</summary>
                  <pre>{selected.rawLines.join("\n")}</pre>
                </details>
              )}
              {selected.frames.length > 0 && (
                <>
                  <div className="error-stack-head">
                    <strong>Stack trace</strong>
                    <span>{appFrameCount} app · {selected.frames.length - appFrameCount} runtime</span>
                  </div>
                  <div className="error-frame-list">
                    {selected.frames.map((frame, index) => (
                      <FrameRow
                        key={`${frame.path}:${frame.line}:${frame.col ?? 0}:${index}`}
                        frame={frame}
                        index={index}
                        source={source}
                        onOpen={handleOpen}
                        onCopy={(text) => onCopy(text, "Source location copied.")}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/inspector/OverviewPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { ErrorGroup } from "../../lib/errors";
import { insightIndexFor } from "../../lib/insight";
import { frameLocation } from "../../lib/logPresentation";
import { bufferFor } from "../../lib/ring";
import type { SourceDef } from "../../lib/types";
import { runtimeOf, useApp } from "../../store";
import { Icon } from "../../ui/Icon";

const fmtInt = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

function fmtUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

export function OverviewPanel({ sourceId, source, groups, onShowError }: {
  sourceId: string;
  source?: SourceDef;
  groups: ErrorGroup[];
  onShowError: (fingerprint: string) => void;
}) {
  const rt = useApp((s) => runtimeOf(s, sourceId));
  useApp((s) => s.bufVersions[sourceId] ?? 0); // re-render per batch
  const [, setTick] = useState(0);
  // 1s tick keeps uptime, rates, and 60s windows moving while the source is silent
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const now = Date.now();
  const ring = bufferFor(sourceId);
  const insight = insightIndexFor(sourceId).snapshot(now);
  const target = source?.command ?? source?.url ?? source?.path ?? "—";
  const recent = groups.slice(0, 5);

  return (
    <div className="inspector-scroll overview-dock">
      <section className="dock-section">
        <h4>Source</h4>
        <div className="dock-kv">
          <span>state</span><strong className={`dock-state-${rt.status}`}>{rt.status}</strong>
          <span>kind</span><strong>{source?.kind ?? "—"}</strong>
          <span>target</span><strong className="dock-target" title={target}>{target}</strong>
          {rt.pid !== undefined && <><span>pid</span><strong>{rt.pid}</strong></>}
          {rt.exitCode !== undefined && rt.exitCode !== null && <><span>exit code</span><strong>{rt.exitCode}</strong></>}
          {rt.status === "live" && rt.startedAt !== undefined && <><span>uptime</span><strong>{fmtUptime(now - rt.startedAt)}</strong></>}
        </div>
      </section>

      <section className="dock-section">
        <h4>Throughput</h4>
        <div className="dock-kv">
          <span>total lines</span><strong>{fmtInt(rt.lines)}</strong>
          <span>retained</span><strong>{fmtInt(ring.length)}</strong>
          <span>dropped</span><strong>{fmtInt(rt.dropped)}</strong>
          <span>lines/s</span><strong>{insight.linesPerSec.toFixed(1)}</strong>
        </div>
      </section>

      <section className="dock-section">
        <h4>Signals</h4>
        <div className="dock-kv">
          <span>errors</span>
          <strong>{fmtInt(rt.errors)}{insight.errors60 ? ` · ${fmtInt(insight.errors60)} in 60s` : ""}</strong>
          <span>warnings</span>
          <strong>{fmtInt(insight.totalWarns)}{insight.warns60 ? ` · ${fmtInt(insight.warns60)} in 60s` : ""}</strong>
        </div>
        {recent.length > 0 && (
          <div className="dock-signal-list" aria-label="Recent error groups">
            {recent.map((group) => {
              const origin = group.topFrame ? frameLocation(group.topFrame, source) : null;
              return (
                <button
                  key={group.fingerprint}
                  type="button"
                  className="dock-signal"
                  title="Open in the Errors tab"
                  onClick={() => onShowError(group.fingerprint)}
                >
                  <span className="dock-signal-count">{group.count}×</span>
                  <span className="dock-signal-copy">
                    <strong>{group.message}</strong>
                    {origin && <small>{origin.file}:{origin.position}</small>}
                  </span>
                  <Icon name="arrow-right" size={12} />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/inspector/InspectPanel.tsx`**

```tsx
import { Fragment, useMemo } from "react";
import { extractJson } from "../../lib/json";
import type { SelectedLine } from "../../lib/types";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

/** top-level primitive fields of embedded JSON — the "lightweight structured fields" */
function structuredFields(raw: string): [string, string][] {
  const hit = extractJson(raw);
  if (!hit || typeof hit.value !== "object" || hit.value === null || Array.isArray(hit.value)) return [];
  return Object.entries(hit.value as Record<string, unknown>)
    .filter(([, v]) => v === null || typeof v !== "object")
    .map(([k, v]) => [k, String(v)]);
}

export function InspectPanel({ line, onCopy, onJump }: {
  line: SelectedLine | null;
  onCopy: (text: string, label: string) => void;
  onJump: (seq: number) => void;
}) {
  const fields = useMemo(() => (line ? structuredFields(line.raw) : []), [line]);

  if (!line) {
    return (
      <div className="inspector-scroll inspect-dock">
        <div className="error-dock-empty">
          <span className="error-dock-empty-icon"><Icon name="search" size={18} /></span>
          <strong>No line selected</strong>
          <p>Click a log line to see its raw text and metadata here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector-scroll inspect-dock">
      <div className="dock-kv">
        <span>line</span><strong>#{line.seq + 1}</strong>
        <span>stream</span><strong>{line.stream}</strong>
        <span>level</span><strong>{line.level ?? "—"}</strong>
        <span>trace</span><strong>{line.traceId !== undefined ? `member of trace ${line.traceId}` : "—"}</strong>
      </div>
      <div className="dock-actions">
        <ToolButton title="Copy complete raw line" onClick={() => onCopy(line.raw, "Complete raw line.")}>
          <Icon name="copy" size={13} /> Copy raw
        </ToolButton>
        <ToolButton title="Scroll to and flash this line in the log" onClick={() => onJump(line.seq)}>
          <Icon name="status" size={13} /> Jump to line
        </ToolButton>
      </div>
      <pre className="inspect-raw">{line.raw}</pre>
      {fields.length > 0 && (
        <section className="dock-section" aria-label="Parsed fields">
          <h4>Fields</h4>
          <div className="dock-kv">
            {fields.map(([key, value]) => (
              <Fragment key={key}>
                <span>{key}</span><strong>{value}</strong>
              </Fragment>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/inspector/JsonPanel.tsx`**

```tsx
import { Suspense, lazy, useMemo } from "react";
import { extractJson } from "../../lib/json";
import type { SelectedLine } from "../../lib/types";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

// Monaco stays out of the main bundle until the JSON tab is first opened
const JsonEditor = lazy(() => import("../../ui/JsonEditor"));

export function JsonPanel({ line, onCopy }: {
  line: SelectedLine | null;
  onCopy: (text: string, label: string) => void;
}) {
  const pretty = useMemo(() => {
    if (!line) return null;
    const hit = extractJson(line.raw);
    return hit ? JSON.stringify(hit.value, null, 2) : null;
  }, [line]);

  if (!line) {
    return (
      <div className="inspector-scroll json-dock">
        <div className="error-dock-empty">
          <span className="error-dock-empty-icon"><Icon name="braces" size={18} /></span>
          <strong>No line selected</strong>
          <p>Click a log line containing JSON to see it formatted here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector-scroll json-dock">
      <div className="json-dock-head">
        <span>line #{line.seq + 1}{pretty ? "" : " · no JSON found"}</span>
        <div className="dock-actions">
          <ToolButton title="Copy the complete raw line" onClick={() => onCopy(line.raw, "Raw line.")}>
            <Icon name="copy" size={13} /> Raw
          </ToolButton>
          {pretty && (
            <ToolButton title="Copy the formatted JSON" onClick={() => onCopy(pretty, "Formatted JSON.")}>
              <Icon name="copy" size={13} /> Pretty
            </ToolButton>
          )}
        </div>
      </div>
      {pretty ? (
        <div className="json-dock-editor">
          <Suspense fallback={<div className="empty-note" style={{ padding: 12 }}>Loading editor…</div>}>
            <JsonEditor value={pretty} />
          </Suspense>
        </div>
      ) : (
        <pre className="json-dock-raw">{line.raw}</pre>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `src/components/Inspector.tsx` as the shell**

Replace the entire file with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { INITIAL_DOCK_TAB, dockTabNext, type DockTab, type DockTabEvent } from "../lib/dockTab";
import { errorIndexFor } from "../lib/errors";
import { shouldAutoRouteJson } from "../lib/json";
import { useApp } from "../store";
import { MiniTabs } from "../ui/MiniTabs";
import { ErrorsPanel } from "./inspector/ErrorsPanel";
import { InspectPanel } from "./inspector/InspectPanel";
import { JsonPanel } from "./inspector/JsonPanel";
import { OverviewPanel } from "./inspector/OverviewPanel";

/** Right dock: Overview / Inspect / JSON / Errors for the active source. */
export function Inspector() {
  const activeTab = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const sourceId = activeTab?.kind === "source" ? activeTab.sourceId : undefined;
  const source = useApp((state) => state.sources.find((item) => item.id === sourceId));
  const errorVersion = useApp((state) => (sourceId ? state.errorVersions[sourceId] ?? 0 : 0));
  const inspectLine = useApp((state) => state.inspectLine);
  const showToast = useApp((state) => state.showToast);
  const jumpToLine = useApp((state) => state.jumpToLine);

  const [dock, setDock] = useState(INITIAL_DOCK_TAB);
  const dispatch = (event: DockTabEvent) => setDock((state) => dockTabNext(state, event));
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);

  const line = inspectLine?.sourceId === sourceId ? inspectLine : null;

  useEffect(() => {
    setDock(INITIAL_DOCK_TAB);
    setSelectedFingerprint(null);
  }, [sourceId]);

  // a plain click routes the dock; clearing the last selection returns to Overview
  const lineKey = line ? `${line.sourceId}:${line.seq}` : null;
  useEffect(() => {
    if (line) dispatch({ type: "select", route: shouldAutoRouteJson(line.raw) ? "json" : "inspect" });
    else dispatch({ type: "deselect" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey]);

  const snapshot = useMemo(
    () => (sourceId ? errorIndexFor(sourceId).snapshot() : { totalOccurrences: 0, groups: [] }),
    [sourceId, errorVersion],
  );

  const copy = async (text: string, label: string) => {
    try {
      await writeText(text);
      showToast("Copied", label);
    } catch (error) {
      showToast("Copy failed", String(error), "err");
    }
  };
  const handleCopy = (text: string, label: string) => void copy(text, label);

  return (
    <aside className="inspector error-inspector">
      <div className="inspector-head">
        <MiniTabs
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "inspect", label: "Inspect" },
            { id: "json", label: "JSON" },
            { id: "errors", label: `Errors${snapshot.groups.length ? ` · ${snapshot.groups.length}` : ""}` },
          ]}
          active={dock.tab}
          onChange={(id) => dispatch({ type: "manual", tab: id as DockTab })}
        />
      </div>

      {dock.tab === "overview" && sourceId && (
        <OverviewPanel
          sourceId={sourceId}
          source={source}
          groups={snapshot.groups}
          onShowError={(fingerprint) => {
            setSelectedFingerprint(fingerprint);
            dispatch({ type: "manual", tab: "errors" });
          }}
        />
      )}
      {dock.tab === "inspect" && (
        <InspectPanel line={line} onCopy={handleCopy} onJump={(seq) => sourceId && jumpToLine(sourceId, seq)} />
      )}
      {dock.tab === "json" && <JsonPanel line={line} onCopy={handleCopy} />}
      {dock.tab === "errors" && (
        <ErrorsPanel
          sourceId={sourceId}
          source={source}
          snapshot={snapshot}
          selectedFingerprint={selectedFingerprint}
          onSelect={setSelectedFingerprint}
          onCopy={handleCopy}
        />
      )}
    </aside>
  );
}
```

- [ ] **Step 6: Append dock CSS to `src/styles/views.css`**

```css
/* ── integrated right dock: Overview / Inspect panels ─────────────────── */

.overview-dock,
.inspect-dock {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dock-section h4 {
  margin: 0 0 6px;
  font-size: 0.7692rem;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.dock-kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 0.8462rem;
}

.dock-kv > span { color: var(--text-muted); }
.dock-kv > strong { font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }

.dock-target {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dock-state-live { color: var(--accent-secondary); }
.dock-state-error { color: var(--status-danger); }

.dock-actions { display: flex; gap: 6px; flex-wrap: wrap; }

.inspect-raw {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--editor-bg);
  font-family: var(--font-mono);
  font-size: 0.8077rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.dock-signal-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}

.dock-signal {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--surface-raised);
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.dock-signal:hover { border-color: var(--status-danger); }

.dock-signal-count {
  flex: none;
  font-size: 0.7692rem;
  color: var(--status-danger);
}

.dock-signal-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; }

.dock-signal-copy strong {
  font-size: 0.8462rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dock-signal-copy small { font-size: 0.7308rem; color: var(--text-muted); }
```

- [ ] **Step 7: Verify**

Run: `npm run build && npm test`
Expected: both PASS.

- [ ] **Step 8: Checkpoint — human commit**

Report: suggested message `feat: four-tab right dock (Overview / Inspect / JSON / Errors)`. Do NOT commit.

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: TypeScript + frontend tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 2: Rust tests + formatting**

Run: `cd src-tauri && cargo test && cargo fmt --check && cd ..`
Expected: PASS, no formatting diffs.

- [ ] **Step 3: Whitespace check**

Run: `git diff --check`
Expected: no output.

- [ ] **Step 4: Manual visual check (human, packaged app)**

Run: `npm run run:release`

Checklist for the human (from the spec):
- plain text line → click → Inspect tab, metadata + raw text
- prefixed JSON line (`INFO payload {"a":1}`) → click → JSON tab, pretty-printed, Raw/Pretty copy both work
- `retry [3] failed` line → click → Inspect (NOT JSON)
- malformed JSON (`{unclosed`) → click → Inspect, no exception
- shift-click a range → dock tab does not change; ⌘C copies the range
- deselect the last line → dock returns to Overview (unless a tab was chosen manually)
- warnings + repeated errors → Overview counters and 60s windows move; badge count on Errors tab; no focus stealing while new batches arrive
- Node stack trace → Errors tab group; clicking jumps to the trace HEAD line; Open origin works
- Overview uptime/lines-per-second tick while the source is silent
- dock resizes and stays usable at the default width

- [ ] **Step 5: Final report**

Report results of every check to the human. Remind: commits are theirs to make.
