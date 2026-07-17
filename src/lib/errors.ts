import { fingerprint } from "./trace";
import type { Frame, LogLine } from "./types";

const MAX_GROUPS = 100;

export interface ErrorGroup {
  fingerprint: string;
  message: string;
  count: number;
  firstSeq: number;
  lastSeq: number;
  /** seq of the first line of the LATEST occurrence — the jump target ("trace head") */
  headSeq: number;
  /** wall-clock ms of first/last occurrence (arrival time, not parsed from the log) */
  firstAt: number;
  lastAt: number;
  traceId: number;
  frames: Frame[];
  topFrame?: Frame;
  rawLines: string[];
}

export interface ErrorSnapshot {
  totalOccurrences: number;
  groups: ErrorGroup[];
}

export class ErrorIndex {
  private groups = new Map<string, ErrorGroup>();
  private open: { traceId: number; lines: LogLine[] } | null = null;

  feed(line: LogLine): boolean {
    if (line.traceId !== undefined) {
      if (this.open && this.open.traceId !== line.traceId) this.commitOpen();
      if (!this.open) this.open = { traceId: line.traceId, lines: [] };
      this.open.lines.push(line);
      return true;
    }
    const committedTrace = this.commitOpen();
    if (line.level === "err") {
      this.commitOccurrence(occurrenceFrom(-(line.seq + 1), [line]));
      return true;
    }
    return committedTrace;
  }

  snapshot(): ErrorSnapshot {
    const groups = new Map<string, ErrorGroup>();
    for (const [key, group] of this.groups) groups.set(key, { ...group });

    if (this.open?.lines.length) {
      const current = occurrenceFrom(this.open.traceId, this.open.lines);
      const existing = groups.get(current.fingerprint);
      groups.set(
        current.fingerprint,
        existing
          ? { ...current, count: existing.count + 1, firstSeq: existing.firstSeq, firstAt: existing.firstAt }
          : current,
      );
    }

    const allGroups = [...groups.values()];
    const sorted = allGroups.sort((a, b) => b.lastSeq - a.lastSeq).slice(0, MAX_GROUPS);
    return {
      totalOccurrences: allGroups.reduce((sum, group) => sum + group.count, 0),
      groups: sorted,
    };
  }

  clear(): void {
    this.groups.clear();
    this.open = null;
  }

  private commitOpen(): boolean {
    if (!this.open?.lines.length) return false;
    const occurrence = occurrenceFrom(this.open.traceId, this.open.lines);
    this.commitOccurrence(occurrence);
    this.open = null;
    return true;
  }

  private commitOccurrence(occurrence: ErrorGroup): void {
    const existing = this.groups.get(occurrence.fingerprint);
    this.groups.set(
      occurrence.fingerprint,
      existing
        ? { ...occurrence, count: existing.count + 1, firstSeq: existing.firstSeq, firstAt: existing.firstAt }
        : occurrence,
    );
  }
}

function occurrenceFrom(traceId: number, lines: LogLine[]): ErrorGroup {
  const frames = lines.flatMap((line) => (line.frame ? [line.frame] : []));
  const first = lines[0];
  const last = lines[lines.length - 1];
  const message = displayErrorMessage(lines.find((line) => line.traceStart)?.raw ?? first.raw);
  const now = Date.now();
  return {
    fingerprint: fingerprint(message, frames),
    message,
    count: 1,
    firstSeq: first.seq,
    lastSeq: last.seq,
    headSeq: first.seq,
    firstAt: now,
    lastAt: now,
    traceId,
    frames,
    topFrame: frames.find((frame) => frame.isApp),
    rawLines: lines.map((line) => line.raw),
  };
}

export function displayErrorMessage(raw: string): string {
  const match = /\b(?:(?:[A-Z][A-Za-z0-9]*)?(?:Error|Exception)|UnhandledPromiseRejection\w*)\b/.exec(raw);
  return (match ? raw.slice(match.index) : raw).trim();
}

export function copyTextForLines(lines: LogLine[]): string {
  return lines.map((line) => line.raw).join("\n");
}

const indexes = new Map<string, ErrorIndex>();

export function errorIndexFor(sourceId: string): ErrorIndex {
  let index = indexes.get(sourceId);
  if (!index) {
    index = new ErrorIndex();
    indexes.set(sourceId, index);
  }
  return index;
}

export function dropErrorIndex(sourceId: string): void {
  indexes.delete(sourceId);
}
