#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/LogMin.app"
ICON_SOURCE="$ROOT_DIR/src/assets/logo.png"

[[ "$(uname -s)" == "Darwin" ]] || { echo "Error: macOS is required." >&2; exit 1; }
[[ "$(uname -m)" == "arm64" ]] || { echo "Error: Apple Silicon (arm64) is required." >&2; exit 1; }

for command in node npm cargo codesign; do
  command -v "$command" >/dev/null || { echo "Error: '$command' is required." >&2; exit 1; }
done

cd "$ROOT_DIR"
[[ -d node_modules ]] || npm ci
[[ -f "$ICON_SOURCE" ]] || { echo "Error: app icon source is missing at $ICON_SOURCE" >&2; exit 1; }
npm run tauri icon -- "$ICON_SOURCE"
VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
npm run tauri build -- --bundles app --config "{\"version\":\"$VERSION\"}"

[[ -d "$APP_PATH" ]] || { echo "Error: bundle was not created at $APP_PATH" >&2; exit 1; }

# Seal the complete app bundle so copied internal builds launch after quarantine is cleared.
codesign --force --deep --sign - "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"

printf '\nBuilt: %s\n\nOn the receiving Mac:\n' "$APP_PATH"
printf '  sudo xattr -rd com.apple.quarantine /Applications/LogMin.app\n'
printf '  open /Applications/LogMin.app\n'
