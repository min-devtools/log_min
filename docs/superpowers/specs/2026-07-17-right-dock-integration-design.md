# Integrated right dock design

**Status:** Approved direction; pending written-spec review.

## Goal

Turn the right dock into a developer-facing source workspace instead of an error-only sidebar. The dock must answer two questions quickly: "Is this source healthy?" and "What does this selected log line contain?" Existing JSON formatting and error navigation become dedicated tabs in the same dock.

## Information architecture

The dock has four task-oriented tabs in this order:

1. **Overview** — live source health and current signals.
2. **Inspect** — raw and parsed context for the selected line.
3. **JSON** — formatted JSON for the selected line when JSON is detected.
4. **Errors** — grouped error occurrences, stack frames, copy, jump, and open-source actions.

Opening a source starts on Overview. Selecting a line opens JSON when the line contains a valid JSON object or array; otherwise it opens Inspect. New errors update the Errors badge without stealing focus. Manual tab changes remain stable until another explicit line selection or source change.

## Overview tab

Overview shows only operational data a developer can act on:

- source state, source kind, target, PID or exit code, and uptime when available;
- total lines seen, retained lines, dropped lines, and rolling lines per second;
- cumulative error and warning counts plus counts seen in the latest 60 seconds;
- the most recent error groups with occurrence count and application origin.

Overview reads an incremental per-source insight index. The ingestion path updates small one-second buckets and cumulative counters while it already classifies each incoming line. Rendering a dock snapshot is bounded by the 60 retained buckets and never scans the 200,000-line ring.

Clicking a recent error signal opens the Errors tab and selects that group. Overview does not invent health scores or AI summaries.

## Inspect tab

The selected-line contract carries the source id and the complete `LogLine` metadata needed by the dock. Inspect presents:

- sequence number, stream, detected level, and trace membership;
- the complete raw line with wrapping and text selection;
- parsed key/value fields when lightweight structured fields are available;
- actions to copy the raw line and jump/flash it in the center log.

Multi-line selection continues to serve range-copy behavior. The last explicitly selected line drives Inspect and JSON. Clearing the final selection returns the dock to Overview.

## JSON tab

JSON detection uses the existing bracket-aware extractor rather than a regular expression. It supports a complete object or array and JSON embedded after a textual prefix while respecting quoted braces and escapes.

When detection succeeds, JSON is pretty-printed in the existing lazy-loaded read-only editor with folding, search, and selection. The tab exposes separate `Copy raw` and `Copy pretty` actions. The raw log in the center pane is never rewritten.

When detection fails, the dock opens Inspect instead of showing an empty JSON editor. JSON strings nested inside fields are not recursively decoded automatically; this avoids silently changing the meaning of data.

The current center-pane JSON modal is removed after equivalent dock behavior is available, avoiding two competing inspector surfaces.

## Errors tab

The existing incremental `ErrorIndex`, grouping, raw trace copy, application/runtime frame hierarchy, and open-in-editor behavior remain. The tab receives a badge with the number of unique groups.

The tab layout is simplified for a narrow dock: group browsing and selected detail remain distinct regions, repeated labels are removed, and the selected error jumps to the trace head rather than the final frame line.

Node/TypeScript stack parsing remains the current supported trace format. The Overview and Inspect tabs still provide useful information for other log formats, so the entire dock no longer depends on stack detection.

## State and data flow

1. A Tauri log batch arrives.
2. Existing level and trace classification runs once per line.
3. The ring buffer, error index, and new bounded insight index consume the tagged lines.
4. Zustand version counters notify the active LogView and Inspector without storing large line arrays in React state.
5. A user line selection publishes one selected-line snapshot to the store.
6. Inspector chooses JSON or Inspect using the pure JSON extraction result.

Per-source indexes live outside Zustand, matching the existing ring and error-index architecture. Deleting a source drops all three indexes.

## Error handling and performance

- Clipboard and editor-open failures continue to use in-app toasts.
- A selected line evicted from the ring remains inspectable from its small stored snapshot.
- Insight history is capped at 60 one-second buckets per source.
- JSON parsing happens for the selected line and explicit JSON affordances, not for the entire retained ring.
- A malformed or truncated JSON fragment falls back to Inspect without an exception or modal.
- The dock remains resizable and usable at the canonical 328 px default width.

## Testing and verification

- Pure tests cover insight counters, rolling rates, bucket expiry, and cleanup.
- Pure tests cover strict JSON, prefixed JSON, quoted braces, malformed JSON, and tab routing.
- Store/component behavior covers selection, deselection, source changes, error badges, and no focus stealing on new batches.
- Existing error-index, trace, ring, and raw-presentation tests continue to pass.
- TypeScript build, Vitest, Rust tests, formatting checks, and `git diff --check` must pass.
- The packaged Tauri app is visually checked with plain text, prefixed JSON, malformed JSON, warnings, repeated errors, and a Node stack trace.

## Out of scope

- AI-generated root-cause summaries.
- Cross-source correlation and distributed trace lookup.
- New stack parsers beyond the current Node/TypeScript support.
- Persisting log contents or dock metrics across application restarts.
