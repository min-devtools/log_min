import { useLayoutEffect, useMemo, useState } from "react";
import { extractJson, jsonChildPath, jsonContainerPaths } from "../../lib/json";
import type { SelectedLine } from "../../lib/types";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

function primitiveClass(value: unknown): string {
  if (value === null || typeof value === "boolean") return "tok-bool";
  if (typeof value === "number") return "tok-num";
  return "tok-str";
}

function JsonNode({ value, path, name, depth, trailing, collapsed, onToggle }: {
  value: unknown;
  path: string;
  name: string | null;
  depth: number;
  trailing: boolean;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
}) {
  const prefix = name === null ? null : <><span className="tok-key">{JSON.stringify(name)}</span><span className="json-tree-colon">: </span></>;
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object" && !isArray;

  if (!isArray && !isObject) {
    return (
      <div className="json-tree-line" style={{ paddingLeft: depth * 16 }}>
        <span className="json-tree-toggle-spacer" />
        {prefix}
        <span className={primitiveClass(value)}>{JSON.stringify(value)}</span>
        {trailing && <span className="json-tree-punc">,</span>}
      </div>
    );
  }

  const entries = isArray
    ? value.map((child, index) => ({ id: String(index), name: null, value: child, path: jsonChildPath(path, index) }))
    : Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => ({ id: key, name: key, value: child, path: jsonChildPath(path, key) }));
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  const count = entries.length;
  const canCollapse = count > 0;
  const isCollapsed = canCollapse && collapsed.has(path);
  const summary = `${count} ${isArray ? (count === 1 ? "item" : "items") : (count === 1 ? "field" : "fields")}`;

  return (
    <>
      <div className="json-tree-line" style={{ paddingLeft: depth * 16 }}>
        {canCollapse ? (
          <button
            type="button"
            className="json-tree-toggle"
            title={`${isCollapsed ? "Expand" : "Collapse"} ${path}`}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${path}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(path)}
          >
            <Icon name="arrow-right" size={12} />
          </button>
        ) : <span className="json-tree-toggle-spacer" />}
        {prefix}
        <span className={`json-tree-bracket tok-br-${depth % 3}`}>{open}</span>
        {isCollapsed && (
          <>
            <span className="json-tree-ellipsis">…</span>
            <span className={`json-tree-bracket tok-br-${depth % 3}`}>{close}</span>
            <span className="json-tree-summary">{summary}</span>
            {trailing && <span className="json-tree-punc">,</span>}
          </>
        )}
        {!isCollapsed && !canCollapse && (
          <>
            <span className={`json-tree-bracket tok-br-${depth % 3}`}>{close}</span>
            {trailing && <span className="json-tree-punc">,</span>}
          </>
        )}
      </div>
      {!isCollapsed && canCollapse && (
        <>
          {entries.map((entry, index) => (
            <JsonNode
              key={`${path}:${entry.id}`}
              value={entry.value}
              path={entry.path}
              name={entry.name}
              depth={depth + 1}
              trailing={index < entries.length - 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
          <div className="json-tree-line" style={{ paddingLeft: depth * 16 }}>
            <span className="json-tree-toggle-spacer" />
            <span className={`json-tree-bracket tok-br-${depth % 3}`}>{close}</span>
            {trailing && <span className="json-tree-punc">,</span>}
          </div>
        </>
      )}
    </>
  );
}

export function JsonPanel({ line, onCopy }: {
  line: SelectedLine | null;
  onCopy: (text: string, label: string) => void;
}) {
  const hit = useMemo(() => {
    if (!line) return null;
    return extractJson(line.raw);
  }, [line]);
  const pretty = useMemo(() => hit ? JSON.stringify(hit.value, null, 2) : null, [hit]);
  const containers = useMemo(() => hit ? jsonContainerPaths(hit.value) : [], [hit]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const collapsedCount = containers.reduce((count, path) => count + Number(collapsed.has(path)), 0);

  useLayoutEffect(() => setCollapsed(new Set()), [line]);

  const toggle = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

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
            <>
              <ToolButton title="Copy the formatted JSON" onClick={() => onCopy(pretty, "Formatted JSON.")}>
                <Icon name="copy" size={13} /> Pretty
              </ToolButton>
              <ToolButton iconOnly title="Expand all JSON nodes" aria-label="Expand all JSON nodes" disabled={collapsedCount === 0} onClick={() => setCollapsed(new Set())}>
                <Icon name="unfold" size={13} />
              </ToolButton>
              <ToolButton iconOnly title="Collapse all JSON nodes" aria-label="Collapse all JSON nodes" disabled={containers.length === 0 || collapsedCount === containers.length} onClick={() => setCollapsed(new Set(containers))}>
                <Icon name="fold" size={13} />
              </ToolButton>
            </>
          )}
        </div>
      </div>
      {pretty ? (
        <div className="json-tree-view" role="tree" aria-label="JSON tree">
          <div className="json-tree-content">
            <JsonNode value={hit!.value} path="$" name={null} depth={0} trailing={false} collapsed={collapsed} onToggle={toggle} />
          </div>
        </div>
      ) : (
        <div className="error-dock-empty json-dock-empty">
          <span className="error-dock-empty-icon"><Icon name="braces" size={18} /></span>
          <strong>No JSON found</strong>
          <p>Use the Raw button above to copy the complete line.</p>
        </div>
      )}
    </div>
  );
}
