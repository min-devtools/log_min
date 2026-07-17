import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { newSourceId, runtimeOf, useApp } from "../store";
import type { SourceDef, TabKind } from "../lib/types";
import { Icon, type IconName } from "../ui/Icon";

const WORKSPACE_NAV: { kind: TabKind; icon: IconName; iconClass: string; label: string; meta?: string }[] = [
  { kind: "welcome", icon: "sparkles", iconClass: "soft-blue", label: "Welcome" },
  { kind: "settings", icon: "settings", iconClass: "soft-orange", label: "Settings", meta: "⌘," },
];

const statusTone = (status: string): "green" | "red" | "idle" =>
  status === "live" ? "green" : status === "error" ? "red" : "idle";

export function Sidebar() {
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const {
    sources, runtimes, tabs, activeTabId, openTab, openSourceTab,
    editSource, deleteSource, startSource, stopSource, openDialog, saveSource, showToast,
  } = useApp();

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
    const rt = runtimeOf({ runtimes }, src.id);
    void openDialog({
      kind: "confirm",
      title: "Remove source?",
      message: `"${src.name}" and its buffered lines are removed. ${rt.status === "live" ? "The running process is stopped first." : ""}`,
      confirmLabel: "Remove",
      danger: true,
    }).then((ok) => {
      if (ok !== null) void deleteSource(src.id);
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
      else if (!mod && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault(); removeSrc(activeSource); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource]);
  const q = filter.trim().toLowerCase();
  const shown = sources.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || (s.path ?? s.command ?? "").toLowerCase().includes(q),
  );

  const menuSource = menu ? sources.find((s) => s.id === menu.id) : undefined;
  const menuRt = menu ? runtimeOf({ runtimes }, menu.id) : undefined;
  const menuItems: ContextMenuItem[] = menuSource
    ? [
        { icon: "docs", label: "Open", strong: true, onClick: () => openSourceTab(menuSource.id) },
        menuRt?.status === "live"
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
        { icon: "trash", label: "Remove", kbd: "⌫", onClick: () => removeSrc(menuSource) },
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
          {shown.map((s) => {
            const rt = runtimeOf({ runtimes }, s.id);
            return (
              <div
                key={s.id}
                className={`nav-item ${activeTab?.sourceId === s.id ? "active" : ""}`}
                title={s.path ?? s.command}
                onClick={() => openSourceTab(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, id: s.id });
                }}
              >
                <Icon
                  name={s.kind === "cmd" ? "terminal" : s.kind === "http" ? "globe" : "docs"}
                  className={rt.status === "live" ? "soft-green" : undefined}
                />
                <span>{s.name}</span>
                <Badge tone={statusTone(rt.status)}>
                  {rt.status === "live" ? "live" : rt.status === "error" ? "error" : "idle"}
                </Badge>
              </div>
            );
          })}
          {!sources.length && (
            <div className="empty-note">No sources yet. Add a file to tail or a command to run.</div>
          )}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </aside>
  );
}
