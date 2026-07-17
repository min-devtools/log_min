# Log Workbench UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the source view into a readable live error workbench with wrapping, structured traces, a useful right dock, and predictable copy actions.

**Architecture:** Preserve the Rust ingestion engine and existing ring buffer. Add a pure incremental error index beside the ring, expose it through a per-source version counter, and have LogView/Inspector consume small presentation models. Keep the fast fixed-row renderer for no-wrap and add an estimated variable-height virtual window for wrap mode.

**Tech Stack:** Tauri 2, React 18, TypeScript, zustand 5, Vitest, existing CSS token cascade.

---

### Task 1: Error presentation model

**Files:**
- Create: `src/lib/errors.ts`
- Test: `src/lib/errors.test.ts`
- Modify: `src/lib/logmin.ts`
- Modify: `src/store.ts`

- [ ] Write failing tests proving a trace becomes one group, repeated fingerprints increment the count, the latest raw trace replaces the previous sample, and app frames keep resolved file/line data.
- [ ] Run `npm test -- src/lib/errors.test.ts` and verify the new tests fail because the index does not exist.
- [ ] Implement `ErrorIndex.feed`, `snapshot`, `errorIndexFor`, and `dropErrorIndex`; cap snapshots to the 100 most recent groups.
- [ ] Feed the index after `TraceAssembler` marks each line and bump `errorVersions[sourceId]` only when the index changes.
- [ ] Run the focused tests and the full Vitest suite.

### Task 2: Trace-aware log rows and reliable copy

**Files:**
- Modify: `src/components/views/LogView.tsx`
- Modify: `src/lib/editor.ts`
- Modify: `src/styles/views.css`

- [ ] Write a failing pure test for trace/selection copy payload formatting in `src/lib/errors.test.ts`.
- [ ] Add a clipboard helper in LogView that reports success and failure consistently.
- [ ] Replace raw frame substring styling with semantic function/path/file/line elements and preserve click-to-editor plus Option-click copy.
- [ ] Show `Copy trace` persistently on a trace header and `Copy N lines` persistently while a range is selected; leave a compact line-copy action on row hover/focus.
- [ ] Add focus-visible, pressed, hover, and narrow-width states.

### Task 3: Live wrap with bounded rendering

**Files:**
- Create: `src/lib/wrapLayout.ts`
- Test: `src/lib/wrapLayout.test.ts`
- Modify: `src/components/views/LogView.tsx`
- Modify: `src/styles/views.css`

- [ ] Write failing tests for estimated wrapped row height, prefix offsets, and finding the visible index at a scroll offset.
- [ ] Implement pure wrap layout helpers using viewport width, gutter/action allowance, font size, and raw character count.
- [ ] Add labeled `Follow` and `Wrap` controls with `aria-pressed`; persist wrap per source in localStorage.
- [ ] In wrap mode, render an overscanned variable-height window using the helpers and flow-wrapped rows; keep the existing absolute fixed-row path when wrap is off.
- [ ] Verify resizing, searching, follow-to-bottom, selection, and trace actions in both modes.

### Task 4: Functional right error dock

**Files:**
- Modify: `src/components/Inspector.tsx`
- Modify: `src/store.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/views.css`

- [ ] Change `inspectorAvailable` to return true for an active source tab and make the source/error context discoverable to Inspector.
- [ ] Render group summaries ordered by latest occurrence with count, exception message, top app frame, and latest sequence.
- [ ] Render the selected group's complete latest trace and explicit copy/open actions.
- [ ] Automatically reveal the dock on the first detected trace without overriding a later manual collapse.
- [ ] Verify `Cmd/Ctrl+R`, the corner toggle, resize handle, source switching, and empty state.

### Task 5: End-to-end verification

**Files:**
- Modify only if verification exposes a root-cause defect.

- [ ] Run `npm test` and require zero failing tests.
- [ ] Run `npm run build` and require a successful TypeScript/Vite production build.
- [ ] Run `cargo test` in `src-tauri` and require zero failing tests.
- [ ] Launch the Tauri app with a command source that emits normal lines, long wrapped JSON, repeated Node traces, dependency frames, and app frames.
- [ ] Visually verify hierarchy, wrapping, right dock, file/line emphasis, copy payloads, follow behavior, search, and responsive resizing.
- [ ] Review `git diff --check` and `git diff --stat`; do not commit because the project plan reserves commits for the human owner.

