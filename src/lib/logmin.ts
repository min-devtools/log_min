import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { bufferFor } from "./ring";
import { errorIndexFor } from "./errors";
import { detectLevel, TraceAssembler } from "./trace";
import { useApp } from "../store";
import type { BatchPayload, LogLine, SourceDef, StatusPayload } from "./types";

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

// eslint-disable-next-line no-control-regex
const RE_ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/** per-source stateful trace detection */
const assemblers = new Map<string, TraceAssembler>();

function assemblerFor(sourceId: string): TraceAssembler {
  let a = assemblers.get(sourceId);
  if (!a) {
    a = new TraceAssembler();
    assemblers.set(sourceId, a);
  }
  return a;
}

/** subscribe once at startup; events flow into rings + store counters */
export async function initLogEvents(): Promise<void> {
  await listen<BatchPayload>("log:batch", (e) => {
    const { sourceId, lines, dropped } = e.payload;
    const asm = assemblerFor(sourceId);
    const errorIndex = errorIndexFor(sourceId);
    const tagged: LogLine[] = lines.map((l) => {
      // ponytail: ANSI codes stripped, not rendered — colored terminal output lands as plain text
      const raw = l.raw.includes("\x1b") ? l.raw.replace(RE_ANSI, "") : l.raw;
      const line: LogLine = { ...l, raw, level: detectLevel(raw) };
      asm.feed(line);
      return line;
    });
    bufferFor(sourceId).push(tagged);
    let errorIndexChanged = false;
    for (const line of tagged) errorIndexChanged = errorIndex.feed(line) || errorIndexChanged;
    let errors = 0;
    for (const l of tagged) if (l.traceStart || (l.level === "err" && !l.traceId)) errors++;
    useApp.getState().onBatch(sourceId, tagged.length, errors, dropped);
    if (errorIndexChanged) useApp.getState().onErrorIndexChange(sourceId);
  });

  await listen<StatusPayload>("log:status", (e) => {
    useApp.getState().onStatus(e.payload);
  });
}
