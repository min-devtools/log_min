# Raw Log and Error Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the center pane a faithful raw log stream and move all parsed stack/source context into a stronger right dock.

**Architecture:** Add a tiny pure presentation module that defines the center-row and frame-location contracts. `LogView` consumes only the raw-row contract, while `Inspector` consumes the existing incremental `ErrorIndex` plus the frame-location presentation model. Styling stays app-local but uses the already-symlinked canonical design-system tokens and shared button component.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, TanStack Virtual, Tauri 2, canonical CSS design system.

---

### Task 1: Lock the presentation contract with tests

**Files:**
- Create: `src/lib/logPresentation.ts`
- Create: `src/lib/logPresentation.test.ts`

- [x] **Step 1: Write failing tests for raw row text and frame locations**

```ts
expect(rawLogText("2026 ERROR TypeError: boom")).toBe("2026 ERROR TypeError: boom");
expect(rawLogText("    at run (/work/src/main.ts:3:7)")).toBe("    at run (/work/src/main.ts:3:7)");
expect(frameLocation(frame, source)).toMatchObject({ file: "main.ts", position: "3:7" });
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/lib/logPresentation.test.ts`

Expected: FAIL because `logPresentation.ts` does not exist.

- [x] **Step 3: Add the minimal pure presentation functions**

```ts
export const rawLogText = (raw: string) => raw || "\u00a0";
export function frameLocation(frame: Frame, source?: SourceDef): FrameLocation {
  const resolved = resolveFramePath(frame, source);
  return { resolved, file, position, label: `${file}:${position}`, full: `${resolved}:${position}` };
}
```

- [x] **Step 4: Re-run the focused test and verify GREEN**

Run: `npm test -- src/lib/logPresentation.test.ts`

Expected: all focused tests pass.

### Task 2: Strip synthesized data from LogView

**Files:**
- Modify: `src/components/views/LogView.tsx`
- Modify: `src/styles/views.css`

- [x] **Step 1: Replace the semantic stack-row renderer with raw text**

Render one `.log-raw` span containing `rawLogText(line.raw)` for every line. Remove the visible gutter, inferred level column, file/function/position controls, trace rail classes, and row-level `Copy trace` action.

- [x] **Step 2: Preserve raw interactions**

Keep wrapping, following, searching, selection, range copy, and the hover/focus raw-line copy action. Keep detected level only as a CSS class for restrained color treatment.

- [x] **Step 3: Remove obsolete trace-row CSS**

Delete the main-pane `.log-frame*`, `.trace-start`, `.trace-end`, and `.log-copy.trace` presentation rules. Rebalance row padding and wrapped-line measurement around a single raw text column.

- [x] **Step 4: Run the focused and full frontend tests**

Run: `npm test -- src/lib/logPresentation.test.ts && npm test`

Expected: all tests pass.

### Task 3: Turn Inspector into the parsed error navigator

**Files:**
- Modify: `src/components/Inspector.tsx`
- Modify: `src/styles/views.css`

- [x] **Step 1: Add a selected-error summary and origin action**

Show occurrence count, latest raw position, message, and an `Open origin` action when `topFrame` exists. Use `frameLocation()` so the displayed and copied locations agree.

- [x] **Step 2: Make frames scannable**

Present application frames with file name and line/column as the primary row, function and resolved parent path as secondary text, and an explicit copy-location action. Runtime/dependency frames remain in stack order with lower contrast.

- [x] **Step 3: Align the dock to canonical controls and tokens**

Use `ToolButton`, semantic surface/text/border/accent/status variables, canonical radii, visible focus states, and no new raw color literals.

- [x] **Step 4: Verify TypeScript and production bundle**

Run: `npm run build`

Expected: TypeScript and Vite exit 0.

### Task 4: Runtime and package verification

**Files:**
- Verify: `src-tauri/src/lib.rs`
- Verify: `src-tauri/src/sources.rs`

- [x] **Step 1: Run frontend, Rust, formatting, and diff checks**

Run: `npm test && npm run build && cargo fmt --check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml && git diff --check`

Expected: every command exits 0.

- [x] **Step 2: Build the macOS app bundle**

Run: `npm run app`

Expected: `src-tauri/target/release/bundle/macos/LogMin.app` is produced.

- [x] **Step 3: Check the packaged app visually**

Start the mixed trace source, verify the center pane contains the exact emitted strings, toggle Wrap, select/copy raw rows, inspect repeated error grouping, check app/runtime frame hierarchy, and click an application source location.
