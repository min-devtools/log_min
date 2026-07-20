import type { IconName } from "../ui/Icon";
import type { ConnColor } from "./connColor";

export type SourceKind = "file" | "cmd" | "http";

/** persisted sidebar folder grouping sources (tauri-plugin-store log.json) */
export interface CollectionDef {
  id: string;
  name: string;
  /** user-assigned identity color, drawn as the dot on every tab bound to this collection */
  color?: ConnColor;
}

/** persisted definition of a source (tauri-plugin-store log.json) */
export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  /** sidebar collection membership; undefined = root level */
  collectionId?: string;
  /** file: absolute path to tail */
  path?: string;
  /** cmd: shell command run via $SHELL -lc */
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** http: remote log file URL, polled with Range */
  url?: string;
  /** http: extra request headers (e.g. Authorization) */
  headers?: Record<string, string>;
}

/** the docker picker just creates a plain cmd source running `docker logs -f ...` */
const isDockerSource = (def: SourceDef) => def.kind === "cmd" && /^docker\s/.test(def.command ?? "");

export function sourceIcon(def: SourceDef): IconName {
  if (def.kind === "file") return "docs";
  if (def.kind === "http") return "globe";
  return isDockerSource(def) ? "topics" : "terminal";
}

export type SourceStatus = "live" | "idle" | "error";

/** volatile per-source runtime state (never persisted) */
export interface SourceRuntime {
  status: SourceStatus;
  pid?: number;
  exitCode?: number | null;
  error?: string;
  /** ms epoch of the current run */
  startedAt?: number;
  /** total lines ever received (ring may have evicted older ones) */
  lines: number;
  errors: number;
  dropped: number;
}

export type LogStream = "file" | "out" | "err";
export type LogLevel = "err" | "warn" | "info" | "debug";

export interface Frame {
  fn: string;
  path: string;
  line: number;
  col?: number;
  /** false for node internals / node_modules — rendered dimmed, not linked */
  isApp: boolean;
}

export interface LogLine {
  seq: number;
  raw: string;
  stream: LogStream;
  level?: LogLevel;
  /** set on every line belonging to a detected stack trace */
  traceId?: number;
  /** set on the trace's message line */
  traceStart?: boolean;
  /** set on parsed frame lines */
  frame?: Frame;
  /** display color spans parsed from ANSI SGR codes (raw is stored stripped) */
  ansi?: { start: number; end: number; cls: string }[];
}

/** snapshot of the line last plain-clicked in a LogView — drives the dock's
 * Inspect/JSON tabs and survives ring eviction */
export interface SelectedLine {
  sourceId: string;
  seq: number;
  raw: string;
  stream: LogStream;
  level?: LogLevel;
  traceId?: number;
}

/** payload of the Rust `log:batch` event */
export interface BatchPayload {
  sourceId: string;
  firstSeq: number;
  lines: { seq: number; raw: string; stream: LogStream }[];
  dropped: number;
}

/** parse worker → main: tagged batch, plus a patch when the previous batch's
 * last line was retroactively adopted as a trace head */
export interface ParsedBatch {
  sourceId: string;
  lines: LogLine[];
  dropped: number;
  patchPrev?: { traceId: number; traceStart: true; level: "err" };
}

/** payload of the Rust `log:status` event */
export interface StatusPayload {
  sourceId: string;
  status: SourceStatus;
  pid?: number;
  exitCode?: number | null;
  error?: string;
  startedAt?: number;
}

export type TabKind = "welcome" | "source" | "source-edit" | "settings" | "error-trace";

export interface TabDef {
  id: string;
  kind: TabKind;
  title: string;
  icon: IconName;
  iconClass: string;
  /** kind === "source" | "error-trace" */
  sourceId?: string;
  /** kind === "error-trace": the ErrorGroup this tab traces */
  fingerprint?: string;
}
