import { useEffect, useMemo, useState } from "react";
import { extractKv } from "../../lib/kv";
import type { SelectedLine } from "../../lib/types";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { Kv } from "../../ui/Kv";

export function InspectPanel({ line, onCopy, onJump }: {
  line: SelectedLine | null;
  onCopy: (text: string, label: string) => void;
  onJump: (seq: number) => void;
}) {
  const [query, setQuery] = useState("");
  const pairs = useMemo(() => (line ? extractKv(line.raw) : []), [line]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pairs;
    return pairs.filter((p) => p.key.toLowerCase().includes(q) || p.value.toLowerCase().includes(q));
  }, [pairs, query]);

  useEffect(() => setQuery(""), [line]);

  if (!line) {
    return (
      <div className="inspector-scroll inspect-dock">
        <div className="error-dock-empty">
          <span className="error-dock-empty-icon"><Icon name="search" size={18} /></span>
          <strong>No line selected</strong>
          <p>Click a log line to see its metadata and key/value pairs here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector-scroll inspect-dock">
      <section className="dock-section panel inspect-meta">
        <div className="dock-section-head">
          <h3>Selected line</h3>
          <ToolButton title="Scroll to and flash this line in the log" onClick={() => onJump(line.seq)}>
            <Icon name="status" size={13} /> Jump
          </ToolButton>
        </div>
        <Kv label="line">#{line.seq + 1}</Kv>
        <Kv label="stream">{line.stream}</Kv>
        <Kv label="level">{line.level ?? "—"}</Kv>
        <Kv label="trace">{line.traceId !== undefined ? `member of trace ${line.traceId}` : "—"}</Kv>
      </section>

      <section className="dock-section panel inspect-fields" aria-label="Key/value pairs">
        <div className="dock-section-head">
          <h3>Key / value</h3>
          <span className="inspect-field-count">{visible.length} / {pairs.length}</span>
        </div>
        {pairs.length > 0 ? (
          <>
            <label className="inspect-search">
              <Icon name="search" size={13} />
              <input
                value={query}
                placeholder="Filter key or value…"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button type="button" title="Clear filter" aria-label="Clear filter" onClick={() => setQuery("")}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </label>
            <div className="inspect-field-list">
              {visible.map((pair, i) => (
                <div
                  className="inspect-field inspect-pair"
                  key={`${pair.key}=${pair.value}-${i}`}
                  title={`Click to copy value: ${pair.value}`}
                  onClick={() => onCopy(pair.value, `Value of ${pair.key}.`)}
                >
                  <div className="inspect-field-main">
                    <code title={pair.key}>{pair.key}</code>
                    <span title={pair.value}>{pair.value}</span>
                  </div>
                  <div className="inspect-field-actions">
                    <ToolButton
                      iconOnly
                      title={`Copy key: ${pair.key}`}
                      aria-label={`Copy key ${pair.key}`}
                      onClick={(e) => { e.stopPropagation(); onCopy(pair.key, "Key."); }}
                    >
                      <Icon name="key" size={12} />
                    </ToolButton>
                    <ToolButton
                      iconOnly
                      title={`Copy ${pair.key}=${pair.value}`}
                      aria-label={`Copy pair ${pair.key}`}
                      onClick={(e) => { e.stopPropagation(); onCopy(`${pair.key}=${pair.value}`, "Pair."); }}
                    >
                      <Icon name="copy" size={12} />
                    </ToolButton>
                  </div>
                </div>
              ))}
              {visible.length === 0 && (
                <div className="inspect-no-fields">No pairs match “{query.trim()}”.</div>
              )}
            </div>
          </>
        ) : (
          <div className="inspect-no-fields">No key=value or “field: value” pairs on this line.</div>
        )}
      </section>
    </div>
  );
}
