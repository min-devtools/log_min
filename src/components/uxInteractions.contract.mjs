import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("log shortcuts yield to every editable control, including textareas", async () => {
  const keys = await read("./log/useLogKeys.ts");
  assert.match(keys, /isEditableTarget\(e\.target\)/);
  assert.doesNotMatch(keys, /tagName === "INPUT"/);
});

test("global shortcuts stop while a modal interaction owns the window", async () => {
  const app = await read("../App.tsx");
  assert.match(app, /globalShortcutsBlocked/);
  assert.match(app, /if \(globalShortcutsBlocked\(/);
});

test("sidebar rows are keyboard controls and collapsed children leave the interaction tree", async () => {
  const sidebar = await read("./Sidebar.tsx");
  assert.match(sidebar, /<motion\.button[\s\S]*data-drop-kind="source"/);
  assert.match(sidebar, /aria-hidden=\{isCollapsed\}/);
  assert.match(sidebar, /inert=\{isCollapsed\}/);
  assert.match(sidebar, /<button[\s\S]*className=\{`nav-item/);
});

test("temporary files are labelled and can be kept as saved sources", async () => {
  const titlebar = await read("./Titlebar.tsx");
  const logView = await read("./views/LogView.tsx");
  assert.match(titlebar, /filter\(\(x\) => !x\.transient\)/);
  assert.match(logView, /Temporary/);
  assert.match(logView, /Keep source/);
  assert.match(logView, /transient: undefined/);
});

test("welcome actions never render a dead button", async () => {
  const welcome = await read("./views/WelcomeView.tsx");
  assert.doesNotMatch(welcome, /onClick:\s*\(\)\s*=>\s*\{\s*\}/);
});
