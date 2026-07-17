import { Suspense, lazy, useMemo } from "react";
import { extractJson } from "../../lib/json";
import type { SelectedLine } from "../../lib/types";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

// Monaco stays out of the main bundle until the JSON tab is first opened
const JsonEditor = lazy(() => import("../../ui/JsonEditor"));

export function JsonPanel({ line, onCopy }: {
  line: SelectedLine | null;
  onCopy: (text: string, label: string) => void;
}) {
  const pretty = useMemo(() => {
    if (!line) return null;
    const hit = extractJson(line.raw);
    return hit ? JSON.stringify(hit.value, null, 2) : null;
  }, [line]);

  if (!line) {
    return (
      <div className="inspector-scroll json-dock">
        <div className="error-dock-empty">
          <span className="error-dock-empty-icon"><Icon name="braces" size={18} /></span>
          <strong>No line selected</strong>
          <p>Click a log line containing JSON to see it formatted here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector-scroll json-dock">
      <div className="json-dock-head">
        <span>line #{line.seq + 1}{pretty ? "" : " · no JSON found"}</span>
        <div className="dock-actions">
          <ToolButton title="Copy the complete raw line" onClick={() => onCopy(line.raw, "Raw line.")}>
            <Icon name="copy" size={13} /> Raw
          </ToolButton>
          {pretty && (
            <ToolButton title="Copy the formatted JSON" onClick={() => onCopy(pretty, "Formatted JSON.")}>
              <Icon name="copy" size={13} /> Pretty
            </ToolButton>
          )}
        </div>
      </div>
      {pretty ? (
        <div className="json-dock-editor">
          <Suspense fallback={<div className="empty-note" style={{ padding: 12 }}>Loading editor…</div>}>
            <JsonEditor value={pretty} />
          </Suspense>
        </div>
      ) : (
        <pre className="json-dock-raw">{line.raw}</pre>
      )}
    </div>
  );
}
