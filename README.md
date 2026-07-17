# log_min

Minimal log viewer + command runner. Part of the `_min` desktop family
(requests_min, elatic_min, kafka_ui_min, redis_min) — same shell, same tokens,
canonical design source in `../design-systems`.

- **Sources**: tail files (rotation-aware), run & manage dev commands
  (`npm run dev`, `mvn …`) with ▶/⏹/⟳, pid, exit code, kill-tree.
  Port listener + HTTP(S) sources land in M3.
- **View**: virtual list (200k lines/source ring buffer), level coloring,
  follow mode that never steals your scroll, ⌘F search, one-click copy.
- **M2**: stack-trace detection (Node/Python first), error groups, click
  `file:line` → editor.

Spec: design artifact + `docs/superpowers/plans/2026-07-17-log-min-m1.md`.

## Dev

```bash
npm install
npm run tauri dev
```

## Release build (macOS)

```bash
./bundle-macos.sh
```
