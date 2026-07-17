import { parseAnsi } from "./ansi";
import { detectLevel, TraceAssembler } from "./trace";
import type { BatchPayload, LogLine, ParsedBatch } from "./types";

/** per-source stateful trace detection — lives here so state survives across batches */
const assemblers = new Map<string, TraceAssembler>();
/** last line of the previous batch per source — the only possible retro-adoption target */
const lastLines = new Map<string, LogLine>();

function assemblerFor(sourceId: string): TraceAssembler {
  let a = assemblers.get(sourceId);
  if (!a) {
    a = new TraceAssembler();
    assemblers.set(sourceId, a);
  }
  return a;
}

const post = self.postMessage.bind(self) as (msg: ParsedBatch) => void;

self.onmessage = (e: MessageEvent<BatchPayload>) => {
  const { sourceId, lines, dropped } = e.data;
  const asm = assemblerFor(sourceId);
  const prev = lastLines.get(sourceId);
  const prevHadTrace = prev?.traceId !== undefined;
  const tagged: LogLine[] = lines.map((l) => {
    // ANSI: raw is stored stripped (search/copy stay clean), SGR colors kept as spans
    let raw = l.raw;
    let ansi: LogLine["ansi"];
    if (raw.includes("\x1b")) {
      const parsed = parseAnsi(raw);
      raw = parsed.clean;
      if (parsed.spans.length) ansi = parsed.spans;
    }
    const line: LogLine = { ...l, raw, ansi, level: detectLevel(raw) };
    asm.feed(line);
    return line;
  });
  // feeding this batch's first frame line can retro-adopt the previous batch's
  // last line as the trace head — that object already crossed the thread
  // boundary, so ship the mutation as a patch instead
  const patchPrev =
    prev && !prevHadTrace && prev.traceId !== undefined
      ? { traceId: prev.traceId, traceStart: true as const, level: "err" as const }
      : undefined;
  if (tagged.length) lastLines.set(sourceId, tagged[tagged.length - 1]);
  post({ sourceId, lines: tagged, dropped, patchPrev });
};
