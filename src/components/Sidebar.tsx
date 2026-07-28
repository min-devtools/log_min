import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { motion, AnimatePresence } from "motion/react";
import { Badge } from "../ui/Badge";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { newSourceId, useApp } from "../store";
import { connStyle } from "../lib/connColor";
import { ColorPicker } from "../ui/ColorPicker";
import { sourceIcon } from "../lib/types";
import type { CollectionDef, SourceDef, SourceStatus, TabKind } from "../lib/types";
import { Icon, type IconName } from "../ui/Icon";
import { collectionDropTarget } from "../lib/collectionDrop";

const WORKSPACE_NAV: { kind: TabKind; icon: IconName; iconClass: string; label: string; meta?: string }[] = [
  { kind: "welcome", icon: "sparkles", iconClass: "soft-blue", label: "Welcome" },
  { kind: "settings", icon: "settings", iconClass: "soft-orange", label: "Settings", meta: "⌘," },
];

const statusTone = (status: string): "green" | "red" | "idle" =>
  status === "live" ? "green" : status === "error" ? "red" : "idle";

type DragItem =
  | { kind: "collection"; id: string }
  | { kind: "source"; id: string; collectionId?: string };

const COLLAPSED_KEY = "log:collapsed-collections";
const ROW_SPRING = { type: "spring", stiffness: 450, damping: 32 } as const;

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
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const pointerDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    item: DragItem;
    active: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
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
    openTab, openSourceTab, openCombinedTab, editSource, deleteSource, startSource, stopSource,
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

  // Pointer-based reorder leaves Tauri's native drag channel free for OS files.
  const clearDrag = () => {
    pointerDrag.current = null;
    setDragging(null);
    setDropIndicator(null);
    setDragOverCollection(null);
    setDragOverRoot(false);
  };

  // Listeners live on window, not the row: WKWebView drops pointer capture, and a drop
  // that lands on a gap, the collection body or the "Drag sources here" note has no row
  // under it at all — a row-scoped release handler simply never fires there.
  const beginPointerDrag = (event: React.PointerEvent<HTMLElement>, item: DragItem) => {
    if (event.button !== 0 || pointerDrag.current) return;
    suppressClick.current = false;
    const pending = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      item,
      active: false,
    };
    pointerDrag.current = pending;

    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pending.pointerId) return;
      if (!pending.active) {
        if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) < 4) return;
        pending.active = true;
        setDragging(pending.item);
      }
      e.preventDefault();
      showPointerTarget(e.clientX, e.clientY, pending.item);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pending.pointerId) return;
      detach();
      if (pending.active) {
        suppressClick.current = true;
        commitPointerDrop(e.clientX, e.clientY, pending.item);
      }
      clearDrag();
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== pending.pointerId) return;
      detach();
      clearDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  // the click that trails a completed drag must not also open/toggle the row
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  const afterSource = (source: SourceDef): string | null => {
    const members = sources.filter((candidate) => candidate.collectionId === source.collectionId && !candidate.transient);
    return members[members.findIndex((candidate) => candidate.id === source.id) + 1]?.id ?? null;
  };

  const dropElementAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop-kind]") ?? null;

  const showPointerTarget = (x: number, y: number, item: DragItem) => {
    const element = dropElementAt(x, y);
    setDropIndicator(null);
    setDragOverCollection(null);
    setDragOverRoot(false);

    if (!element) return;
    const kind = element.dataset.dropKind;
    const id = element.dataset.dropId;
    if (item.kind === "collection") {
      if (kind !== "collection" || !id) return;
      const target = collectionDropTarget(collections.map((collection) => collection.id), item.id, id);
      if (target) setDropIndicator(`col:${id}:${target.edge}`);
      return;
    }

    if (kind === "source" && id) {
      const target = sources.find((source) => source.id === id);
      if (!target || target.id === item.id) return;
      if (item.collectionId === target.collectionId) setDropIndicator(`src:${target.id}`);
      else if (target.collectionId) setDragOverCollection(target.collectionId);
      else setDragOverRoot(true);
      return;
    }
    if (kind === "collection" && id) setDragOverCollection(id);
    if (kind === "root") setDragOverRoot(true);
  };

  const commitPointerDrop = (x: number, y: number, item: DragItem) => {
    const element = dropElementAt(x, y);
    const kind = element?.dataset.dropKind;
    const id = element?.dataset.dropId;

    if (item.kind === "collection") {
      if (kind !== "collection" || !id) return;
      const target = collectionDropTarget(collections.map((collection) => collection.id), item.id, id);
      if (target) reorderCollection(item.id, target.beforeId);
      return;
    }
    if (kind === "source" && id) {
      const target = sources.find((source) => source.id === id);
      if (!target || target.id === item.id) return;
      if (item.collectionId !== target.collectionId) {
        moveSource(item.id, target.collectionId, null);
        return;
      }
      const rect = element!.getBoundingClientRect();
      moveSource(item.id, target.collectionId, y < rect.top + rect.height / 2 ? target.id : afterSource(target));
      return;
    }
    if (kind === "collection" && id && item.collectionId !== id) moveSource(item.id, id, null);
    if (kind === "root" && item.collectionId) moveSource(item.id, undefined, null);
  };

  const sourceRow = (s: SourceDef) => {
    const status = statusOf(s.id);
    return (
      <motion.button
        type="button"
        key={s.id}
        layout
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={ROW_SPRING}
        className={`nav-item request-node ${activeTab?.sourceId === s.id ? "active" : ""} ${dropIndicator === `src:${s.id}` ? "drop-prefix" : ""} ${dragging?.kind === "source" && dragging.id === s.id ? "dragging" : ""}`}
        title={s.path ?? s.command}
        data-drop-kind="source"
        data-drop-id={s.id}
        onPointerDown={(event) => beginPointerDrag(event, { kind: "source", id: s.id, collectionId: s.collectionId })}
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
      </motion.button>
    );
  };

  const rootSources = sources.filter(
    (s) => !s.transient && (!s.collectionId || !collections.some((c) => c.id === s.collectionId)),
  );
  const savedSourceCount = sources.filter((source) => !source.transient).length;

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
        { icon: "rows", label: "Open combined view", strong: true, onClick: () => openCombinedTab(menuCollection.id) },
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
            <button
              type="button"
              key={item.kind}
              className={`nav-item ${activeTab?.kind === item.kind ? "active" : ""}`}
              onClick={() => openTab(item.kind)}
            >
              <Icon name={item.icon} className={item.iconClass} />
              <span>{item.label}</span>
              <span>
                {item.meta?.startsWith("⌘") ? <span className="kbd">{item.meta}</span> : item.meta ?? ""}
              </span>
            </button>
          ))}
        </div>

        <div className="group">
          <div className="group-title"><span>Sources</span><span>{savedSourceCount ? String(savedSourceCount) : ""}</span></div>
          <button
            type="button"
            className={`nav-item ${activeTab?.kind === "source-edit" ? "active" : ""}`}
            onClick={() => editSource(null)}
          >
            <Icon name="plus" className="soft-blue" /><span>New Source</span><span className="kbd">⌘N</span>
          </button>
          <button type="button" className="nav-item" onClick={() => void newCollection()}>
            <Icon name="folder-plus" className="soft-orange" /><span>New Collection</span><span />
          </button>

          <AnimatePresence initial={false}>
          {collections.map((c) => {
            const members = sources.filter((s) => s.collectionId === c.id && !s.transient);
            const shown = members.filter((s) => matches(s) || c.name.toLowerCase().includes(q));
            if (q && shown.length === 0 && !c.name.toLowerCase().includes(q)) return null;
            const isCollapsed = !q && collapsed.has(c.id);
            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={ROW_SPRING}
                className={`collection-tree ${isCollapsed ? "collapsed" : ""} ${dragOverCollection === c.id ? "drop-target" : ""}`}
                data-drop-kind="collection"
                data-drop-id={c.id}
              >
                <button
                  type="button"
                  className={`nav-item collection-node with-conn-dot ${dropIndicator === `col:${c.id}:before` ? "drop-before" : ""} ${dropIndicator === `col:${c.id}:after` ? "drop-after" : ""} ${dragging?.kind === "collection" && dragging.id === c.id ? "dragging" : ""}`}
                  aria-expanded={!isCollapsed}
                  onPointerDown={(event) => beginPointerDrag(event, { kind: "collection", id: c.id })}
                  onClick={() => toggleCollection(c.id)}
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
                </button>
                <div className="collection-requests" aria-hidden={isCollapsed} inert={isCollapsed}>
                  <AnimatePresence initial={false}>
                    {shown.map(sourceRow)}
                  </AnimatePresence>
                  {members.length === 0 && <div className="empty-note collection-empty">Drag sources here.</div>}
                </div>
              </motion.div>
            );
          })}
          </AnimatePresence>

          <div
            className={`root-sources ${dragOverRoot ? "drop-target" : ""}`}
            data-drop-kind="root"
          >
            <AnimatePresence initial={false}>
              {rootSources.filter(matches).map(sourceRow)}
            </AnimatePresence>
          </div>
          {!sources.length && (
            <div className="empty-note">No sources yet. Add a file to tail or a command to run.</div>
          )}
        </div>
      </div>
      <AnimatePresence>
        {menu && (
          <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {colMenu && (
          <ContextMenu x={colMenu.x} y={colMenu.y} items={colMenuItems} onClose={() => setColMenu(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
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
      </AnimatePresence>
    </aside>
  );
}
