import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { extractJson, jsonChildPath, jsonContainerPaths } from "../../lib/json";
import { findMarks, filterJsonFields, jsonFields } from "../../lib/jsonTree";
import type { SelectedLine } from "../../lib/types";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

function primitiveClass(value: unknown): string {
  if (value === null || typeof value === "boolean") return "tok-bool";
  if (typeof value === "number") return "tok-num";
  return "tok-str";
}

function highlightText(text: string, q: string, caseSensitive: boolean): ReactNode {
  const marks = findMarks(text, q, caseSensitive);
  if (!marks.length) return text;
  const nodes: ReactNode[] = [];
  let key = 0;
  let cur = 0;
  for (const [ms, me] of marks) {
    if (ms > cur) nodes.push(<span key={key++}>{text.slice(cur, ms)}</span>);
    nodes.push(<mark key={key++}>{text.slice(ms, me)}</mark>);
    cur = me;
  }
  if (cur < text.length) nodes.push(<span key={key++}>{text.slice(cur)}</span>);
  return nodes;
}

function JsonNode({ value, path, name, depth, trailing, collapsed, query, caseSensitive, onToggle }: {
  value: unknown;
  path: string;
  name: string | null;
  depth: number;
  trailing: boolean;
  collapsed: ReadonlySet<string>;
  query: string;
  caseSensitive: boolean;
  onToggle: (path: string) => void;
}) {
  const prefix = name === null ? null : (
    <>
      <span className="tok-key">{highlightText(JSON.stringify(name), query, caseSensitive)}</span>
      <span className="json-tree-colon">: </span>
    </>
  );
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object" && !isArray;

  if (!isArray && !isObject) {
    return (
      <div className="json-tree-line" style={{ paddingLeft: depth * 16 }}>
        <span className="json-tree-toggle-spacer" />
        {prefix}
        <span className={primitiveClass(value)}>{highlightText(JSON.stringify(value), query, caseSensitive)}</span>
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
            <Icon name="chevron-right" size={12} />
          </button>
        ) : <span className="json-tree-toggle-spacer" />}
        {prefix}
        <span className={`json-tree-bracket tok-br-${depth % 3}`}>{open}</span>
        {isCollapsed && (
          <>
            <span className="json-tree-ellipsis">…</span>
            <span className={`json-tree-bracket tok-br-${depth % 3}`}>{close}</span>
            <span className="json-tree-summary">{highlightText(summary, query, caseSensitive)}</span>
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
              query={query}
              caseSensitive={caseSensitive}
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

function ancestorPaths(path: string): string[] {
  const out: string[] = [];
  let i = path.length;
  while (true) {
    const dot = path.lastIndexOf(".", i - 1);
    const bracket = path.lastIndexOf("[", i - 1);
    i = Math.max(dot, bracket);
    if (i <= 0) break;
    out.push(path.slice(0, i));
  }
  return out;
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
  const allFields = useMemo(() => hit ? jsonFields(hit.value) : [], [hit]);
  const [userCollapsed, setUserCollapsed] = useState<Set<string>>(() => new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const bigPayload = !!pretty && containers.length > 0 && pretty.length > 50_000;
  useLayoutEffect(
    () => setUserCollapsed(new Set(bigPayload ? containers : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [line],
  );

  const q = query.trim();
  const filtered = useMemo(() => (q ? filterJsonFields(allFields, q, caseSensitive) : allFields), [allFields, q, caseSensitive]);

  // auto-expand ancestors of search matches so highlights are visible; never hide nodes
  const collapsed = useMemo(() => {
    if (!q) return userCollapsed;
    const forceExpand = new Set<string>();
    for (const field of filtered) {
      for (const ancestor of ancestorPaths(field.path)) forceExpand.add(ancestor);
    }
    const next = new Set(userCollapsed);
    for (const path of forceExpand) next.delete(path);
    return next;
  }, [q, filtered, userCollapsed]);

  const toggle = (path: string) => {
    setUserCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.select());
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const collapsedCount = containers.reduce((count, path) => count + Number(collapsed.has(path)), 0);
  const matchCount = q ? filtered.length : 0;
  const totalCount = allFields.length;

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
      {searchOpen && (
        <div className="json-tree-search">
          <Icon name="search" size={13} />
          <input
            ref={searchInputRef}
            value={query}
            placeholder="Find in JSON…"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                setQuery("");
              }
            }}
          />
          <button
            type="button"
            className={`case-toggle ${caseSensitive ? "active" : ""}`}
            title={`Case ${caseSensitive ? "sensitive" : "insensitive"}`}
            onClick={() => setCaseSensitive((v) => !v)}
          >
            Aa
          </button>
          <span className="match-count">{q ? `${matchCount}/${totalCount}` : ""}</span>
        </div>
      )}
      <div className="json-dock-head">
        <span>
          line #{line.seq + 1}{pretty ? "" : " · no JSON found"}
          {q && pretty ? ` · ${matchCount} match${matchCount === 1 ? "" : "es"}` : ""}
        </span>
        <div className="dock-actions">
          <ToolButton title="Copy the complete raw line" onClick={() => onCopy(line.raw, "Raw line.")}>
            <Icon name="copy" size={13} /> Raw
          </ToolButton>
          {pretty && (
            <>
              <ToolButton title="Copy the formatted JSON" onClick={() => onCopy(pretty, "Formatted JSON.")}>
                <Icon name="copy" size={13} /> Pretty
              </ToolButton>
              <ToolButton iconOnly title="Expand all JSON nodes" aria-label="Expand all JSON nodes" disabled={collapsedCount === 0} onClick={() => setUserCollapsed(new Set())}>
                <Icon name="chevrons-down" size={13} />
              </ToolButton>
              <ToolButton iconOnly title="Collapse all JSON nodes" aria-label="Collapse all JSON nodes" disabled={containers.length === 0 || collapsedCount === containers.length} onClick={() => setUserCollapsed(new Set(containers))}>
                <Icon name="chevrons-up" size={13} />
              </ToolButton>
            </>
          )}
        </div>
      </div>
      {pretty ? (
        <div className="json-tree-view" role="tree" aria-label="JSON tree">
          <div className="json-tree-content">
            <JsonNode value={hit!.value} path="$" name={null} depth={0} trailing={false} collapsed={collapsed} query={q} caseSensitive={caseSensitive} onToggle={toggle} />
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
