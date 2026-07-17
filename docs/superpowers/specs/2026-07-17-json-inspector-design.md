# JSON and Inspect Dock Design

## Problem

The JSON tab recognizes the selected Apache HTTP Wire payload—the presence of the Pretty action proves extraction succeeded—but its lazy Monaco editor can leave the dock visually blank. The Inspect tab exposes only line metadata, repeats the complete raw line, and lists primitive fields only at the JSON root, so nested production payloads provide almost no inspectable information.

## Chosen design

Use one parser and one structured field model for both dock tabs.

- `extractJson` remains the single boundary for locating JSON inside plain, prefixed, quoted, and escaped log lines.
- The JSON tab renders a native syntax-colored JSON tree. Every object and array has a chevron that independently expands or collapses it, while toolbar actions expand or collapse the complete document. A collapsed node keeps its opening/closing delimiter visible and shows its field/item count.
- The tree does not depend on Monaco, workers, lazy loading, or an editor layout measurement, so folding cannot reintroduce the blank-editor failure.
- The Inspect tab renders line metadata followed by a searchable, flattened tree of every JSON node. Each row shows its JSON path, type, compact value, and actions to copy the path or full value.
- Nested objects and arrays are represented by depth and path rather than nested cards. This keeps large payloads scannable in the narrow dock.
- The complete raw line remains available only in a collapsed disclosure for forensic comparison. It is no longer the primary content.

## Data flow

Selecting a log line publishes a `SelectedLine`. `Inspector` routes JSON-bearing lines to JSON as it does today. Both panels call the shared extractor. JSON derives deterministic container paths for fold state and resets them when the selected line changes. Inspect converts the extracted value into deterministic `JsonField` rows; its local query filters on path, type, and rendered value.

## Error handling

When no JSON exists, JSON shows an explicit empty state instead of echoing raw text as though formatting worked. Inspect still shows line metadata and the collapsed raw disclosure, plus a clear message that there are no structured fields.

## Verification

Regression tests cover the real Apache HTTP Wire wrapper, nested field paths, array paths, types, filtering, compact/full values, and the complete set of collapsible container paths. The full Vitest suite and production build must pass. The local app must be opened in a browser and verified with a representative long nested payload so per-node folding, expand/collapse-all, visible content, scrolling, filtering, and tab switching are confirmed.
