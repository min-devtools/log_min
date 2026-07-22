import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebarUrl = new URL("./Sidebar.tsx", import.meta.url);
const tauriConfigUrl = new URL("../../src-tauri/tauri.conf.json", import.meta.url);

test("sidebar reorder uses pointer events so native file drop stays available", async () => {
  const sidebar = await readFile(sidebarUrl, "utf8");
  assert.match(sidebar, /onPointerDown/);
  assert.match(sidebar, /document\.elementFromPoint/);
  assert.match(sidebar, /data-drop-kind="source"/);
  assert.match(sidebar, /data-drop-kind="collection"/);
  assert.match(sidebar, /data-drop-kind="root"/);
  assert.doesNotMatch(sidebar, /\bdraggable\b|onDrag(?:Start|Over|Leave|End)|\bonDrop=|dataTransfer/);
});

test("hovering each valid source and collection target exposes immediate feedback", async () => {
  const sidebar = await readFile(sidebarUrl, "utf8");
  assert.match(sidebar, /setDropIndicator\(`src:\$\{target\.id\}`\)/);
  assert.match(sidebar, /dropIndicator === `src:\$\{s\.id\}` \? "drop-prefix"/);
  assert.match(sidebar, /setDragOverCollection\(id\)/);
  assert.match(sidebar, /dragOverCollection === c\.id \? "drop-target"/);
  assert.match(sidebar, /drop-before/);
  assert.match(sidebar, /drop-after/);
});

test("source rows match requests_min semantics across collection boundaries", async () => {
  const sidebar = await readFile(sidebarUrl, "utf8");
  assert.match(sidebar, /item\.collectionId === target\.collectionId/);
  assert.match(sidebar, /moveSource\(item\.id, target\.collectionId, null\)/);
});

test("the webview keeps native file drop enabled", async () => {
  const config = JSON.parse(await readFile(tauriConfigUrl, "utf8"));
  assert.equal(config.app.windows[0].dragDropEnabled, true);
});

test("the app listens to typed native webview file-drop events", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /getCurrentWebview\(\)\.onDragDropEvent/);
  assert.match(app, /payload\.type === "drop"/);
  assert.match(app, /openTransientFiles\(payload\.paths\)/);
});
