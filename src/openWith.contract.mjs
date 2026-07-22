import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("bundle registers LogMin as an alternate viewer for common text formats", async () => {
  const config = JSON.parse(await readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"));
  const associations = config.bundle.fileAssociations ?? [];
  const extensions = new Set(associations.flatMap((association) => association.ext));
  const expected = [
    "log", "txt", "text", "out", "err", "trace",
    "json", "jsonl", "ndjson", "csv", "tsv",
    "yaml", "yml", "xml", "md", "markdown",
    "conf", "config", "ini", "env", "properties",
  ];

  for (const extension of expected) assert.ok(extensions.has(extension), `missing .${extension}`);
  for (const association of associations) {
    assert.equal(association.role, "Viewer");
    assert.equal(association.rank, "Alternate");
  }
});

test("Rust queues macOS open-file events and exposes a drain command", async () => {
  const rust = await readFile(new URL("src-tauri/src/lib.rs", root), "utf8");
  assert.match(rust, /struct OpenedFiles/);
  assert.match(rust, /RunEvent::Opened \{ urls \}/);
  assert.match(rust, /take_opened_files/);
  assert.match(rust, /app:open-files-ready/);
});

test("frontend drains queued files only after persistence is ready", async () => {
  const logmin = await readFile(new URL("src/lib/logmin.ts", root), "utf8");
  const main = await readFile(new URL("src/main.tsx", root), "utf8");
  assert.match(logmin, /initOpenedFileEvents/);
  assert.match(logmin, /invoke<string\[\]>\("take_opened_files"\)/);
  assert.match(logmin, /openTransientFiles\(paths\)/);
  assert.match(main, /await initPersistence\(\)/);
  assert.match(main, /initOpenedFileEvents\(\)/);
});
