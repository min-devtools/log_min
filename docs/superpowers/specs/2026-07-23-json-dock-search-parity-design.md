# JSON Dock Search Parity

## Goal

Make the JSON tab in the right dock use the same search field behavior as the Value and Payload inspector panels in `redis_min` and `kafka_ui_min`.

## Design

- Add a local `SearchBar` component in `src/components/inspector/JsonPanel.tsx`, matching the referenced panels.
- Keep the existing JSON-specific placeholder: `Find in JSON...`.
- Pass query state, case-sensitivity state, match count, and a close handler into this component.
- Centralize closing the search field in `closeSearch()`, which closes the field and clears the query.
- Keep existing Cmd/Ctrl+F focus selection, matching, highlighting, and ancestor expansion behavior unchanged.

## Validation

- Run the project's typecheck/build command.
- Manually verify Cmd/Ctrl+F opens and focuses the JSON search field; Escape clears and closes it; case sensitivity and match count work in the JSON tree.
