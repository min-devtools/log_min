import { Fragment, useMemo } from "react";
import { extractJson } from "../../lib/json";
import type { SelectedLine } from "../../lib/types";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

/** top-level primitive fields of embedded JSON — the "lightweight structured fields" */
function structuredFields(raw: string): [string, string][] {
  const hit = extractJson(raw);
  if (!hit || typeof hit.value !== "object" || hit.value === null || Array.isArray(hit.value)) return [];
  return Object.entries(hit.value as Record<string, unknown>)
    .filter(([, v]) => v === null || typeof v !== "object")
    .map(([k, v]) => [k, String(v)]);
}

export function InspectPanel({ line, onCopy, onJump }: {
  line: SelectedLine | null;
  onCopy: (text: string, label: string) => void;
  onJump: (seq: number) => void;
}) {
  const fields = useMemo(() => (line ? structuredFields(line.raw) : []), [line]);

  if (!line) {
    return (
      <div className="inspector-scroll inspect-dock">
        <div className="error-dock-empty">
          <span className="error-dock-empty-icon"><Icon name="search" size={18} /></span>
          <strong>No line selected</strong>
          <p>Click a log line to see its raw text and metadata here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector-scroll inspect-dock">
      <div className="dock-kv">
        <span>line</span><strong>#{line.seq + 1}</strong>
        <span>stream</span><strong>{line.stream}</strong>
        <span>level</span><strong>{line.level ?? "—"}</strong>
        <span>trace</span><strong>{line.traceId !== undefined ? `member of trace ${line.traceId}` : "—"}</strong>
      </div>
      <div className="dock-actions">
        <ToolButton title="Copy complete raw line" onClick={() => onCopy(line.raw, "Complete raw line.")}>
          <Icon name="copy" size={13} /> Copy raw
        </ToolButton>
        <ToolButton title="Scroll to and flash this line in the log" onClick={() => onJump(line.seq)}>
          <Icon name="status" size={13} /> Jump to line
        </ToolButton>
      </div>
      <pre className="inspect-raw">{line.raw}</pre>
      {fields.length > 0 && (
        <section className="dock-section" aria-label="Parsed fields">
          <h4>Fields</h4>
          <div className="dock-kv">
            {fields.map(([key, value]) => (
              <Fragment key={key}>
                <span>{key}</span><strong>{value}</strong>
              </Fragment>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
