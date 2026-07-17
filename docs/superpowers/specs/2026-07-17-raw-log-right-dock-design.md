# Raw Log and Error Dock Design

## Goal

Keep the center pane faithful to the source: every row displays the complete raw log line and nothing synthesized by LogMin. Move parsed error context, stack navigation, and source actions into the right dock.

## Center log pane

- Render `line.raw` verbatim for normal lines, error heads, and stack-frame lines.
- Do not add detected level labels, visible sequence numbers, trace rails, shortened exception messages, file chips, function labels, line badges, or trace-copy actions to a log row.
- Detection may tint the raw text and row background, but it must not replace or reorder source content.
- Preserve live follow, wrap, search, row/range selection, raw-line copy, source lifecycle controls, and stdin.
- Keep a compact hover/focus copy action because it operates on the raw line rather than adding parsed data.

## Right error dock

- Keep errors grouped by fingerprint and ordered by latest occurrence.
- Make each group show its message, occurrence count, latest raw-line position, and top application location when available.
- The selected group exposes one latest raw sample and its parsed stack.
- Application frames have stronger contrast than runtime/dependency frames.
- Each frame presents function, file, line, column, and resolved path. Clicking an application frame opens it in the configured editor; Option-click and a dedicated copy action copy the resolved location.
- A prominent origin action at the top of the selected error opens the first application frame immediately.
- Copying a trace always copies the original raw lines, not formatted dock labels.

## Design-system contract

- Continue consuming canonical `tokens.css`, `themes.css`, `base.css`, `layout.css`, and `components.css` through the existing symlinks.
- Keep view-specific composition in `src/styles/views.css` and use semantic canonical tokens only: `--surface-*`, `--text-*`, `--border-*`, `--accent-*`, and `--status-*`.
- Reuse the canonical `ToolButton` contract for actions and match its radius, focus, hover, and pressed states.
- Do not add a new font, palette, shadow system, or component dependency.

## Verification

- Pure tests prove that raw center text is never normalized and that dock locations retain file/line/column data.
- Existing trace-index tests continue to prove grouping and raw-copy behavior.
- The packaged Tauri app is checked with a mixed command source for raw row fidelity, live wrap, dock grouping, app/runtime frame hierarchy, copy, and click-to-open behavior.

