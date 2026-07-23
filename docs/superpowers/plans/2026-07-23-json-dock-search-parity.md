# JSON Dock Search Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the right-dock JSON search field behave and be structured the same as the Redis Value and Kafka Payload inspector search fields.

**Architecture:** Keep all state and JSON matching logic inside `JsonPanel`. Extract only its presentational search row to a local `SearchBar`, then route all close actions through one `closeSearch` function so Escape consistently clears state.

**Tech Stack:** React 18, TypeScript, Vitest, Vite.

## Global Constraints

- Modify only `src/components/inspector/JsonPanel.tsx` for the product behavior.
- Preserve existing JSON matching, highlighting, ancestor auto-expansion, collapse state, Cmd/Ctrl+F focus behavior, and the existing `.json-tree-search` CSS.
- Use the exact search placeholder `Find in JSON...`.
- Do not add dependencies or change other right-dock tabs.

---

## File Structure

- Modify `src/components/inspector/JsonPanel.tsx`: define a local typed `SearchBar` and centralize search dismissal.
- Modify `docs/superpowers/specs/2026-07-23-json-dock-search-parity-design.md`: retain the approved implementation record. No production CSS or test-file changes are required because the current tree helper tests cover matching and the component behavior is a local UI composition change.

### Task 1: Align JSON Search Field With Payload Panels

**Files:**
- Modify: `src/components/inspector/JsonPanel.tsx:143-290`
- Verify: `src/lib/jsonTree.test.ts:1-39`

**Interfaces:**
- Consumes: existing `findMarks`, `filterJsonFields`, `Icon`, and `JsonPanel` state: `query`, `caseSensitive`, `searchInputRef`.
- Produces: local `SearchBar(props)` where `props` includes `inputRef: React.RefObject<HTMLInputElement>`, `query: string`, `onQuery: (query: string) => void`, `caseSensitive: boolean`, `onCaseSensitive: (caseSensitive: boolean) => void`, `count: string`, and `onClose: () => void`.

- [ ] **Step 1: Confirm the existing matching helper tests pass before the UI-only refactor**

Run: `npm test -- src/lib/jsonTree.test.ts`

Expected: Vitest reports 5 passing tests for JSON fields, container paths, filtering, and case-sensitive or case-insensitive marks.

- [ ] **Step 2: Add the typed local search row above `JsonPanel`**

Add the same component boundary used by the Redis and Kafka payload panels, retaining the JSON-specific placeholder:

```tsx
function SearchBar({
  inputRef,
  query,
  onQuery,
  caseSensitive,
  onCaseSensitive,
  count,
  onClose,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  query: string;
  onQuery: (query: string) => void;
  caseSensitive: boolean;
  onCaseSensitive: (caseSensitive: boolean) => void;
  count: string;
  onClose: () => void;
}) {
  return (
    <div className="json-tree-search">
      <Icon name="search" size={13} />
      <input
        ref={inputRef}
        value={query}
        placeholder="Find in JSON..."
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      />
      <button
        type="button"
        className={`case-toggle ${caseSensitive ? "active" : ""}`}
        title={`Case ${caseSensitive ? "sensitive" : "insensitive"}`}
        onClick={() => onCaseSensitive(!caseSensitive)}
      >
        Aa
      </button>
      <span className="match-count">{count}</span>
    </div>
  );
}
```

- [ ] **Step 3: Centralize dismissal and render the local `SearchBar`**

After the keyboard effect, add a close handler that resets both state values:

```tsx
const closeSearch = () => {
  setSearchOpen(false);
  setQuery("");
};
```

Replace both existing Escape reset calls with `closeSearch()`. Replace the inline `.json-tree-search` JSX with:

```tsx
{searchOpen && (
  <SearchBar
    inputRef={searchInputRef}
    query={query}
    onQuery={setQuery}
    caseSensitive={caseSensitive}
    onCaseSensitive={setCaseSensitive}
    count={q ? `${matchCount}/${totalCount}` : ""}
    onClose={closeSearch}
  />
)}
```

- [ ] **Step 4: Verify behavior and compilation**

Run: `npm test -- src/lib/jsonTree.test.ts && npm run build`

Expected: Vitest reports 5 passing tests and `tsc && vite build` completes without TypeScript or Vite errors.

Manually verify in the app:

1. Select a JSON log line, open the right-dock `JSON` tab, and press Cmd/Ctrl+F.
2. Confirm the focused field says `Find in JSON...`, shows the `Aa` toggle, and shows `matched/total` after input.
3. Confirm a query highlights keys and values and opens ancestor nodes.
4. Press Escape while the field is focused. Confirm the field closes and the JSON header no longer reports matches.
5. Reopen with Cmd/Ctrl+F, enter a query, then press Escape outside the field. Confirm the same reset result.

- [ ] **Step 5: Commit the completed change**

```bash
git add src/components/inspector/JsonPanel.tsx docs/superpowers/specs/2026-07-23-json-dock-search-parity-design.md docs/superpowers/plans/2026-07-23-json-dock-search-parity.md
git commit -m "feat: align JSON dock search"
```

Expected: Git creates one commit containing the JSON search-field parity implementation and its design records.
