import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single source of truth for this app's release version.
const version = readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim();

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    // PORT override lets a second dev instance (benchmarks/preview) coexist with
    // `tauri dev`, which needs exactly 1420 (tauri.conf.json devUrl)
    port: Number(process.env.PORT) || 1420,
    strictPort: true,
    // src/styles/*.css are symlinks into the sibling ../design-systems repo, and
    // their url() font paths resolve to that real path — outside the project
    // root, so dev serving needs the parent directory allowed explicitly.
    fs: { allow: [".."] },
  },
  build: {
    target: "safari15",
    chunkSizeWarningLimit: 4000,
  },
});
