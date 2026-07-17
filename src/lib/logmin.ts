import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { bufferFor } from "./ring";
import { archiveFor } from "./errorArchive";
import { errorIndexFor } from "./errors";
import { insightIndexFor } from "./insight";
import { useApp } from "../store";
import type { BatchPayload, LogLine, ParsedBatch, SourceDef, StatusPayload } from "./types";

// ─── typed command wrappers ───────────────────────────────────────────────

export function sourceStart(def: SourceDef): Promise<void> {
  const config =
    def.kind === "file"
      ? { kind: "file", path: def.path ?? "" }
      : def.kind === "http"
        ? { kind: "http", url: def.url ?? "", headers: def.headers ?? null }
        : { kind: "cmd", command: def.command ?? "", cwd: def.cwd || null, env: def.env ?? null };
  return invoke("source_start", { id: def.id, config });
}

export function sourceStop(id: string): Promise<void> {
  return invoke("source_stop", { id });
}

export function cmdStdin(id: string, line: string): Promise<void> {
  return invoke("cmd_stdin", { id, line });
}

export function listFonts(): Promise<string[]> {
  return invoke("list_fonts");
}

/** write text to an absolute path (buffer export) */
export function saveText(path: string, contents: string): Promise<void> {
  return invoke("save_text", { path, contents });
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  ports: string;
  status: string;
}

/** running containers via `docker ps` — throws with docker's stderr if unavailable */
export async function dockerPs(): Promise<DockerContainer[]> {
  const raw = await invoke<string>("docker_ps");
  const out: DockerContainer[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      out.push({ id: j.ID ?? "", name: j.Names ?? j.ID ?? "", image: j.Image ?? "", ports: j.Ports ?? "", status: j.Status ?? "" });
    } catch {
      // non-JSON noise from shell profiles — skip
    }
  }
  return out;
}

// ─── event wiring ─────────────────────────────────────────────────────────

/** last pushed line per source — patch target for cross-batch trace adoption */
const lastPushed = new Map<string, LogLine>();

/** stateful indexing on tagged lines — ring/insight/archive/error state stays main-thread */
function ingestParsed({ sourceId, lines: tagged, dropped, patchPrev }: ParsedBatch): void {
  if (patchPrev) {
    const prev = lastPushed.get(sourceId);
    if (prev) Object.assign(prev, patchPrev);
  }
  const errorIndex = errorIndexFor(sourceId);
  bufferFor(sourceId).push(tagged);
  insightIndexFor(sourceId).feed(tagged, Date.now());
  // archive first so ErrorIndex commits can tag snippets that already hold their lines
  const archive = archiveFor(sourceId);
  for (const line of tagged) archive.feed(line);
  errorIndex.onOccurrence = (occ) => archive.tagFingerprint(occ.fingerprint, occ.lastSeq);
  let errorIndexChanged = false;
  for (const line of tagged) errorIndexChanged = errorIndex.feed(line) || errorIndexChanged;
  let errors = 0;
  for (const l of tagged) if (l.traceStart || (l.level === "err" && !l.traceId)) errors++;
  if (tagged.length) lastPushed.set(sourceId, tagged[tagged.length - 1]);
  useApp.getState().onBatch(sourceId, tagged.length, errors, dropped);
  if (errorIndexChanged) useApp.getState().onErrorIndexChange(sourceId);
}

/** subscribe once at startup; batches route through the parse worker so
 * ANSI/level/trace regex work never blocks the UI thread under burst load */
export async function initLogEvents(): Promise<void> {
  const worker = new Worker(new URL("./parseWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<ParsedBatch>) => ingestParsed(e.data);

  await listen<BatchPayload>("log:batch", (e) => worker.postMessage(e.payload));

  await listen<StatusPayload>("log:status", (e) => {
    useApp.getState().onStatus(e.payload);
  });
}
