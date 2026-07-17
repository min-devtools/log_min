# Log workbench UX design

**Status:** Approved for inline execution by the user's instruction to proceed without further confirmation.

## Goal

Make the source view useful at first glance: live output can wrap, errors read as stack traces instead of flat text, source locations stand out and open in the configured editor, the right dock explains and groups failures, and copy actions state exactly what they copy.

## Product decisions

- Keep the existing Tauri source engine, per-source ring, React shell, theme tokens, and fixed-height virtual list for the default unwrapped mode.
- Add a visible `Follow` control and a visible `Wrap` control. Wrap is a presentation preference per open source view; it must not change ingestion or parsing.
- In wrapped mode, use a bounded virtual window with estimated multi-line heights so long lines are readable without mounting the whole 200k-line ring.
- Render Node/TS traces with three visual roles: error header, app frame, runtime/dependency frame. App frames expose the file name and line/column as the strongest target.
- Build an incremental per-source error index during ingestion. The right dock reads that index instead of rescanning the ring on every batch.
- The right dock is available only for source tabs, opens by default when the first trace is detected, and remains manually collapsible.
- Replace ambiguous hover-only copy icons with explicit actions: trace rows show `Copy trace`; ordinary rows show a single copy action; selected ranges show a persistent `Copy N lines` toolbar action.

## Interaction model

### Log toolbar

The left side retains the source target. The right side groups source lifecycle actions first, then viewing controls (`Follow`, `Wrap`, `Search`), then destructive/settings actions. Active controls use `aria-pressed` and a stable highlighted state.

### Trace presentation

The trace head carries an `ERROR` eyebrow, the exception message, frame count, and `Copy trace`. Each app frame shows the function in muted text, the project-relative file name prominently, then a separate `line:column` badge. Runtime frames stay visible but subdued. Clicking an app location opens the configured editor; Option-click copies the resolved location.

### Error dock

The dock header shows unique groups and occurrence count. Group summaries are ordered by most recently seen. Selecting a group reveals its latest complete stack trace, including all app frames and a `Copy trace` action. Empty state explains that only detected stack traces appear there.

## Error handling and performance

- Clipboard failures surface an error toast instead of silently failing.
- The error index is capped by unique group count and stores one latest raw trace per group, not every occurrence.
- Wrap height estimates are derived from viewport width and monospace metrics; the rendered window is overscanned and recalculated on resize.
- Unwrapped mode keeps the existing O(viewport) renderer and is the default for maximum throughput.

## Verification

- Pure tests cover trace summaries, fingerprint grouping, repeated occurrences, and copy payloads.
- Component-level behavior is verified through the running app with mixed logs and repeated Node traces.
- Full TypeScript build, Vitest suite, Rust tests, and a production Vite build must pass before completion is reported.

