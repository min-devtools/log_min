# JSON and Inspect Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make JSON reliably visible and turn Inspect into a useful nested-field explorer for real log payloads.

**Architecture:** Keep JSON extraction in `src/lib/json.ts`, add pure field-model helpers there, and let both dock panels consume that shared result. Replace the layout-sensitive Monaco dock with a native formatted code view; keep interaction state local to Inspect.

**Tech Stack:** React 18, TypeScript, Vitest, Vite, existing logmin CSS tokens.

---

### Task 1: Lock parser and field-model behavior

**Files:**
- Modify: `src/lib/json.test.ts`
- Modify: `src/lib/json.ts`

- [x] Add a regression fixture matching `prefix << "{"took":25,...}"` and assert `extractJson` returns the nested object.
- [x] Add failing tests for `jsonFields(value)` covering root, dotted object paths, bracketed array indexes, node types, compact previews, and full copy values.
- [x] Run `npm test -- src/lib/json.test.ts` and confirm the missing `jsonFields` export fails.
- [x] Implement `JsonField`, `jsonFields`, `filterJsonFields`, and JSONPath escaping with bounded preview strings.
- [x] Run `npm test -- src/lib/json.test.ts` and confirm all JSON tests pass.

### Task 2: Replace the blank JSON viewer

**Files:**
- Modify: `src/components/inspector/JsonPanel.tsx`
- Modify: `src/styles/views.css`
- Delete: `src/ui/JsonEditor.tsx`
- Delete: `src/lib/monaco.ts`

- [x] Replace lazy Monaco loading with a native `<pre><code>` renderer over the formatted payload, using existing JSON syntax token classes.
- [x] Preserve Raw and Pretty copy actions and add explicit no-JSON messaging.
- [x] Remove Monaco-only files and verify no imports remain with `rg -n "JsonEditor|lib/monaco|monaco-editor" src`.

### Task 3: Build the Inspect field explorer

**Files:**
- Modify: `src/components/inspector/InspectPanel.tsx`
- Modify: `src/styles/views.css`

- [x] Replace root-only primitive extraction with `jsonFields` and `filterJsonFields`.
- [x] Add a search input with match count and a flat depth-indented field list.
- [x] Add per-row Copy path and Copy value actions while retaining line metadata and Jump to line.
- [x] Move the raw line into a collapsed `<details>` disclosure and show a useful no-fields state.

### Task 4: Verify behavior

**Files:**
- Modify only if verification exposes a defect in the files above.

- [x] Run `npm test` and require zero failures.
- [x] Run `npm run build` and require exit code 0.
- [x] Run `git diff --check`.
- [x] Start the local Vite app, open it in the in-app browser, and verify JSON content is visible and Inspect filtering/actions remain usable with a long nested Apache Wire payload.

### Task 5: Add native JSON folding

**Files:**
- Modify: `src/lib/json.test.ts`
- Modify: `src/lib/json.ts`
- Modify: `src/components/inspector/JsonPanel.tsx`
- Modify: `src/styles/views.css`

- [x] Add failing tests asserting that `jsonContainerPaths(value)` returns every object/array JSONPath in pre-order and excludes primitive paths.
- [x] Run `npm test -- src/lib/json.test.ts` and confirm the missing helper fails.
- [x] Implement `jsonContainerPaths` from the shared `jsonFields` model.
- [x] Replace the static pretty-text renderer with recursive JSON rows whose object/array chevrons toggle a `Set<string>` of collapsed paths.
- [x] Add Expand all and Collapse all actions; reset fold state whenever the selected line changes.
- [x] Style tree rows, chevrons, delimiters, collapsed counts, and syntax values with existing theme tokens.
- [x] Run `npm test`, `npm run build`, and `git diff --check`.
- [x] Verify in the local browser that one nested node toggles independently and the two global actions change all container nodes.
