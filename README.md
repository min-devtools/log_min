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

### Windows

- `src/styles/` holds **git symlinks** into `../design-systems` (5 of the 6
  files). Windows needs that repo cloned next to this one *and* `git config
  core.symlinks true` (Developer Mode) — otherwise git writes the link target as
  plain text, the token/theme cascade silently drops and the app renders
  unstyled.
- cmd sources run under `pwsh.exe` → `powershell.exe` → `cmd.exe`, whichever is
  found first; `LOGMIN_SHELL` overrides on every platform.
- Stopping a cmd source uses `taskkill /T /F`: the whole tree dies, but children
  get no chance to run shutdown hooks (nothing equivalent to SIGTERM reaches a
  console child from outside its console).
- Open-With / double-click arrives as argv; macOS gets `RunEvent::Opened`.
- **No animations?** Windows *Settings → Accessibility → Visual effects →
  Animation effects* off makes WebView2 report `prefers-reduced-motion: reduce`,
  and `design-systems/base.css` then collapses every duration to 1ms app-wide.
  It is the OS setting, not a regression.

## Release build (macOS)

```bash
./bundle-macos.sh
```
