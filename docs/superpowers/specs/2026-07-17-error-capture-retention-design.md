# Error capture, retention control, Ctrl+L — design

**Status:** Approved direction (user chose options via Q&A; implementation proceeding directly on user request).

Baseline: current working tree (includes in-progress json-inspector changes; Monaco/JsonEditor removed).

## Decisions (from Q&A)

1. Dock Errors tab keeps fingerprint grouping; clicking a group opens a dedicated **error-trace tab** in the center tab bar. Main log tab keeps flowing.
2. Context capture: ±10 lines around error lines; errors whose capture windows overlap (new error ≤ 20 lines after the previous error line) merge into ONE snippet with the outermost range.
3. Retention: per-source combobox on the log toolbar (free input + presets 1k/5k/10k/50k/100k/200k), persisted in localStorage per source, default 200k.
4. Error archive lives in RAM for the app session: survives Ctrl+L / clear buffer / ring eviction / source restart; lost on app exit.
5. Shortcut: literal **Ctrl+L** (all platforms) clears the log buffer of the active source tab. Errors are NOT cleared.
6. Capture approach: archive at ingest (ErrorArchive per source, outside Zustand, like ring/errorIndex).

## ErrorArchive (`src/lib/errorArchive.ts`)

- `ArchivedLine { seq, raw, isError }`; `ErrorOccurrence { id, fingerprints[], firstErrSeq, lastErrSeq, at, lines[], open, truncated }`.
- `feed(line)` on every ingested line (after ring renumbering): keeps a 30-line tail; error line (traceId or level err) opens an occurrence with 10 tail lines before, or extends the last occurrence when `0 < seq − lastErrSeq ≤ 20` (backfilling gap lines from the tail); ordinary lines append while open, occurrence closes 10 lines after the last error line.
- Seq going backwards (buffer cleared / source restart) resets the tail and never merges — new occurrence.
- `tagFingerprint(fingerprint, seq)` links ErrorIndex occurrences (called from `ErrorIndex.onOccurrence` hook) to the snippet containing that seq; one snippet may carry several fingerprints (adjacent different errors merged).
- Bounds: 500 occurrences/source (drop oldest), 400 lines/occurrence (`truncated` flag). No clear on Ctrl+L; `dropArchive` on source delete.

## Error-trace tab

- New `TabKind "error-trace"`, `TabDef.fingerprint`. Store action `openErrorTab(sourceId, fingerprint, message)`; tab id `err-{sourceId}-{fingerprint}` (re-click focuses existing tab). Not restored across app restart (archive is RAM-only).
- View: group header (message, count ×N, first/last time, application origin + stack frames — reused FrameRow), then occurrences newest-first, each a read-only snippet with line numbers and error lines highlighted, plus copy-snippet.
- Dock ErrorsPanel slims to the group list only (badge stays); the detail section including the "Raw output" toggle is removed — the trace tab replaces it. Overview recent-error click also opens the trace tab. No more jump/flash on click.

## Retention

- `Ring` gets a mutable `cap` (`setCap`, clamp 100…200 000); push eviction overshoot becomes `min(4096, cap/4)` so small caps aren't wiped. Byte cap unchanged.
- Toolbar input with `<datalist>` presets; accepts `5k` shorthand; commit on Enter/blur; persisted `log:cap:{sourceId}`.

## Clear semantics (button + Ctrl+L)

Clears ring + insight + selection/search; keeps ErrorIndex, ErrorArchive, and the runtime `errors` counter (errors are preserved by design). Resets `lines`/`dropped`, publishes `inspectLine: null`.

## Testing

Pure vitest: errorArchive (capture window, merge ≤20 outermost, far errors separate, trace capture, seq-reset guard, caps, fingerprint tagging), ring setCap eviction. UI verified manually.
