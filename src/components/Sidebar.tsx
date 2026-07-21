import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "../ui/Badge";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { newSourceId, useApp } from "../store";
import { connStyle } from "../lib/connColor";
import { ColorPicker } from "../ui/ColorPicker";
import { sourceIcon } from "../lib/types";
import type { CollectionDef, SourceDef, SourceStatus, TabKind } from "../lib/types";
import { Icon, type IconName } from "../ui/Icon";

const WORKSPACE_NAV: { kind: TabKind; icon: IconName; iconClass: string; label: string; meta?: string }[] = [
  { kind: "welcome", icon: "sparkles", iconClass: "soft-blue", label: "Welcome" },
  { kind: "settings", icon: "settings", iconClass: "soft-orange", label: "Settings", meta: "⌘," },
];

const statusTone = (status: string): "green" | "red" | "idle" =>
  status === "live" ? "green" : status === "error" ? "red" : "idle";

type DragItem = { kind: "collection"; id: string } | { kind: "source"; id: string };

const COLLAPSED_KEY = "log:collapsed-collections";

export function Sidebar() {
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [colMenu, setColMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [pickingColor, setPickingColor] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[]); }
    catch { return new Set(); }
  });
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [dragOverCollection, setDragOverCollection] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<string | null>(null);
  const sources = useApp((s) => s.sources);
  const collections = useApp((s) => s.collections);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  // statuses only — per-batch counter updates must not redraw the sidebar
  const statuses = useApp(
    useShallow((s) => {
      const out: Record<string, SourceStatus> = {};
      for (const id in s.runtimes) out[id] = s.runtimes[id].status;
      return out;
    }),
  );
  const {
    openTab, openSourceTab, editSource, deleteSource, startSource, stopSource,
    openDialog, saveSource, showToast, createCollection, renameCollection,
    deleteCollection, reorderCollection, moveSource, setCollections,
  } = useApp.getState();
  const statusOf = (id: string): SourceStatus => statuses[id] ?? "idle";

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeSource = activeTab?.kind === "source" ? sources.find((s) => s.id === activeTab.sourceId) : undefined;

  const duplicateSrc = (src: SourceDef) => {
    const def: SourceDef = { ...src, id: newSourceId(), name: `${src.name} copy` };
    saveSource(def);
    openSourceTab(def.id);
    showToast("Source duplicated", def.name);
  };

  const renameSrc = async (src: SourceDef) => {
    const name = await openDialog({ kind: "prompt", title: "Rename source", defaultValue: src.name, confirmLabel: "Rename" });
    if (name == null || !name.trim() || name.trim() === src.name) return;
    saveSource({ ...src, name: name.trim() });
  };

  const removeSrc = (src: SourceDef) => {
    void openDialog({
      kind: "confirm",
      title: "Remove source?",
      message: `"${src.name}" and its buffered lines are removed. ${statusOf(src.id) === "live" ? "The running process is stopped first." : ""}`,
      confirmLabel: "Remove",
      danger: true,
    }).then((ok) => {
      if (ok !== null) void deleteSource(src.id);
    });
  };

  const newCollection = async () => {
    const name = await openDialog({ kind: "prompt", title: "New collection", confirmLabel: "Create" });
    if (name?.trim()) createCollection(name.trim());
  };

  const renameCol = async (c: CollectionDef) => {
    const name = await openDialog({ kind: "prompt", title: "Rename collection", defaultValue: c.name, confirmLabel: "Rename" });
    if (name != null && name.trim() && name.trim() !== c.name) renameCollection(c.id, name.trim());
  };

  const removeCol = (c: CollectionDef) => {
    void openDialog({
      kind: "confirm",
      title: "Delete collection?",
      message: `"${c.name}" is removed. Its sources move back to the root list.`,
      confirmLabel: "Delete",
      danger: true,
    }).then((ok) => {
      if (ok !== null) deleteCollection(c.id);
    });
  };

  // WebKit (Tauri macOS) doesn't focus rows on click, so per-node onKeyDown won't fire.
  // Listen globally and act on the active source; stay out of inputs and open dialogs.
  useEffect(() => {
    if (!activeSource) return;
    const onKey = (event: KeyboardEvent) => {
      if (useApp.getState().dialog) return;
      const el = document.activeElement as HTMLElement | null;
      const editable = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (editable) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "d") { event.preventDefault(); duplicateSrc(activeSource); }
      else if (mod && key === "e") { event.preventDefault(); void renameSrc(activeSource); }
      // ⌘⌫ only — a plain Backspace outside inputs is too easy to hit by accident
      else if (mod && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault(); removeSrc(activeSource); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource]);

  // activating a source's tab unfolds its collection so the highlighted row is visible
  useEffect(() => {
    const cid = activeSource?.collectionId;
    if (!cid) return;
    setCollapsed((current) => {
      if (!current.has(cid)) return current;
      const next = new Set(current);
      next.delete(cid);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, [activeSource?.id, activeSource?.collectionId]);

  const q = filter.trim().toLowerCase();
  const matches = (s: SourceDef) =>
    !q || s.name.toLowerCase().includes(q) || (s.path ?? s.command ?? "").toLowerCase().includes(q);

  const toggleCollection = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  // ── drag & drop (HTML5, same scheme as requests_min) ─────────────────────
  const startDrag = (event: React.DragEvent, item: DragItem) => {
    setDragging(item);
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify(item));
  };
  const endDrag = () => {
    setDragging(null);
    setDropIndicator(null);
    setDragOverCollection(null);
  };
  const parseDrop = (event: React.DragEvent): DragItem | null => {
    try { return JSON.parse(event.dataTransfer.getData("application/json")) as DragItem; }
    catch { return null; }
  };
  /** id of the source right after `s` in the global array (insert-after target) */
  const afterOf = (s: SourceDef): string | null =>
    sources[sources.findIndex((x) => x.id === s.id) + 1]?.id ?? null;

  const onDropOnSource = (event: React.DragEvent, target: SourceDef) => {
    event.preventDefault();
    event.stopPropagation();
    setDropIndicator(null);
    setDragOverCollection(null);
    const item = parseDrop(event);
    if (!item || item.kind !== "source" || item.id === target.id) return;
    const before = event.clientY < event.currentTarget.getBoundingClientRect().top + (event.currentTarget as HTMLElement).offsetHeight / 2;
    moveSource(item.id, target.collectionId, before ? target.id : afterOf(target));
  };

  const onDropOnCollection = (event: React.DragEvent, collectionId: string) => {
    event.preventDefault();
    setDragOverCollection(null);
    setDropIndicator(null);
    const item = parseDrop(event);
    if (!item) return;
    if (item.kind === "collection") {
      const row = (event.target as HTMLElement).closest(".collection-node")?.getBoundingClientRect();
      if (!row || event.clientY < row.top + row.height / 2) reorderCollection(item.id, collectionId);
      else reorderCollection(item.id, collections[collections.findIndex((c) => c.id === collectionId) + 1]?.id ?? null);
      return;
    }
    moveSource(item.id, collectionId, null);
  };

  const onDropOnRoot = (event: React.DragEvent) => {
    event.preventDefault();
    setDropIndicator(null);
    setDragOverCollection(null);
    const item = parseDrop(event);
    if (item?.kind === "source") moveSource(item.id, undefined, null);
  };

  const sourceRow = (s: SourceDef) => {
    const status = statusOf(s.id);
    return (
      <div
        key={s.id}
        className={`nav-item request-node ${activeTab?.sourceId === s.id ? "active" : ""} ${dropIndicator === `src:${s.id}` ? "drop-prefix" : ""}`}
        title={s.path ?? s.command}
        draggable
        onDragStart={(e) => startDrag(e, { kind: "source", id: s.id })}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragging?.kind === "source" && dragging.id !== s.id) setDropIndicator(`src:${s.id}`);
        }}
        onDragLeave={() => setDropIndicator((d) => (d === `src:${s.id}` ? null : d))}
        onDrop={(e) => onDropOnSource(e, s)}
        onClick={() => openSourceTab(s.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, id: s.id });
        }}
      >
        <Icon name={sourceIcon(s)} className={status === "live" ? "soft-green" : undefined} />
        <span>{s.name}</span>
        <Badge tone={statusTone(status)}>
          {status === "live" ? "live" : status === "error" ? "error" : "idle"}
        </Badge>
      </div>
    );
  };

  const rootSources = sources.filter(
    (s) => !s.transient && (!s.collectionId || !collections.some((c) => c.id === s.collectionId)),
  );

  const menuSource = menu ? sources.find((s) => s.id === menu.id) : undefined;
  const menuItems: ContextMenuItem[] = menuSource
    ? [
        { icon: "docs", label: "Open", strong: true, onClick: () => openSourceTab(menuSource.id) },
        statusOf(menuSource.id) === "live"
          ? { icon: "stop", label: "Stop", onClick: () => void stopSource(menuSource.id) }
          : {
              icon: "play",
              label: menuSource.kind === "cmd" ? "Run" : menuSource.kind === "http" ? "Stream" : "Tail",
              onClick: () => {
                openSourceTab(menuSource.id);
                void startSource(menuSource.id);
              },
            },
        { icon: "pencil", label: "Edit source", onClick: () => editSource(menuSource.id) },
        { icon: "pencil", label: "Rename", kbd: "⌘E", onClick: () => void renameSrc(menuSource) },
        { icon: "copy", label: "Duplicate", kbd: "⌘D", onClick: () => duplicateSrc(menuSource) },
        ...(menuSource.collectionId
          ? [{ icon: "x" as IconName, label: "Remove from collection", onClick: () => moveSource(menuSource.id, undefined, null) }]
          : []),
        { icon: "trash", label: "Remove", kbd: "⌘⌫", onClick: () => removeSrc(menuSource) },
      ]
    : [];

  const menuCollection = colMenu ? collections.find((c) => c.id === colMenu.id) : undefined;
  const colMenuItems: ContextMenuItem[] = menuCollection
    ? [
        { icon: "pencil", label: "Rename", onClick: () => void renameCol(menuCollection) },
        { icon: "status", label: "Set color…", onClick: () => setPickingColor(menuCollection.id) },
        { icon: "trash", label: "Delete (keep sources)", onClick: () => removeCol(menuCollection) },
      ]
    : [];

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <input
          className="side-search"
          placeholder="Search sources"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="side-scroll">
        <div className="group">
          <div className="group-title"><span>Workspace</span><span /></div>
          {WORKSPACE_NAV.map((item) => (
            <div
              key={item.kind}
              className={`nav-item ${activeTab?.kind === item.kind ? "active" : ""}`}
              onClick={() => openTab(item.kind)}
            >
              <Icon name={item.icon} className={item.iconClass} />
              <span>{item.label}</span>
              <span>
                {item.meta?.startsWith("⌘") ? <span className="kbd">{item.meta}</span> : item.meta ?? ""}
              </span>
            </div>
          ))}
        </div>

        <div className="group">
          <div className="group-title"><span>Sources</span><span>{sources.length ? String(sources.length) : ""}</span></div>
          <div
            className={`nav-item ${activeTab?.kind === "source-edit" ? "active" : ""}`}
            onClick={() => editSource(null)}
          >
            <Icon name="plus" className="soft-blue" /><span>New Source</span><span className="kbd">⌘N</span>
          </div>
          <div className="nav-item" onClick={() => void newCollection()}>
            <Icon name="folder-plus" className="soft-orange" /><span>New Collection</span><span />
          </div>

          {collections.map((c) => {
            const members = sources.filter((s) => s.collectionId === c.id && !s.transient);
            const shown = members.filter((s) => matches(s) || c.name.toLowerCase().includes(q));
            if (q && shown.length === 0 && !c.name.toLowerCase().includes(q)) return null;
            const isCollapsed = !q && collapsed.has(c.id);
            return (
              <div
                key={c.id}
                className={`collection-tree ${isCollapsed ? "collapsed" : ""} ${dragOverCollection === c.id ? "drop-target" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragging?.kind === "collection") setDropIndicator(`col:${c.id}`);
                  else if (dragOverCollection !== c.id) setDragOverCollection(c.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverCollection(null);
                    setDropIndicator(null);
                  }
                }}
                onDrop={(e) => onDropOnCollection(e, c.id)}
              >
                {/* div, not <button>: WebKit refuses to start HTML5 drags from form controls */}
                <div
                  role="button"
                  tabIndex={0}
                  className={`nav-item collection-node with-conn-dot ${dropIndicator === `col:${c.id}` ? "drop-prefix" : ""}`}
                  draggable
                  aria-expanded={!isCollapsed}
                  onDragStart={(e) => startDrag(e, { kind: "collection", id: c.id })}
                  onDragEnd={endDrag}
                  onClick={() => toggleCollection(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleCollection(c.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setColMenu({ x: e.clientX, y: e.clientY, id: c.id });
                  }}
                >
                  <Icon name="chevron-down" className="collection-chevron" size={13} />
                  <span
                    className="conn-dot"
                    style={connStyle(c.color)}
                    title={c.color ? `Color: ${c.color}` : "No color — set one from the right-click menu"}
                  />
                  <span>{c.name}</span>
                  <Badge>{members.length || ""}</Badge>
                </div>
                <div className="collection-requests">
                  {shown.map(sourceRow)}
                  {members.length === 0 && <div className="empty-note collection-empty">Drag sources here.</div>}
                </div>
              </div>
            );
          })}

          <div
            className="root-sources"
            onDragOver={(e) => {
              if (dragging?.kind === "source") e.preventDefault();
            }}
            onDrop={onDropOnRoot}
          >
            {rootSources.filter(matches).map(sourceRow)}
          </div>
          {!sources.length && (
            <div className="empty-note">No sources yet. Add a file to tail or a command to run.</div>
          )}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
      {colMenu && (
        <ContextMenu x={colMenu.x} y={colMenu.y} items={colMenuItems} onClose={() => setColMenu(null)} />
      )}
      {pickingColor && (
        <ColorPicker
          value={collections.find((c) => c.id === pickingColor)?.color}
          onPick={(color) =>
            setCollections(
              collections.map((c) => (c.id === pickingColor ? { ...c, color: color ?? undefined } : c)),
            )
          }
          onClose={() => setPickingColor(null)}
        />
      )}
    </aside>
  );
}
