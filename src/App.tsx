import { memo, useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { Titlebar as TitlebarImpl } from "./components/Titlebar";
import { Sidebar as SidebarImpl } from "./components/Sidebar";
import { TabsBar as TabsBarImpl } from "./components/TabsBar";
import { Inspector as InspectorImpl } from "./components/Inspector";
import { Statusbar as StatusbarImpl } from "./components/Statusbar";
import { CommandPalette as CommandPaletteImpl } from "./components/CommandPalette";
import { Toast as ToastImpl } from "./components/Toast";
import { Dialog as DialogImpl } from "./components/Dialog";
import { PanelResizeHandles as PanelResizeHandlesImpl } from "./components/ResizeHandles";
import { WelcomeView as WelcomeViewImpl } from "./components/views/WelcomeView";
import { LogView as LogViewImpl } from "./components/views/LogView";
import { ErrorTraceView as ErrorTraceViewImpl } from "./components/views/ErrorTraceView";
import { SourceEditView as SourceEditViewImpl } from "./components/views/SourceEditView";
import { SettingsView as SettingsViewImpl } from "./components/views/SettingsView";
import { CombinedView as CombinedViewImpl } from "./components/views/CombinedView";

// App re-renders on shell state (dock collapse, theme, tab switches). Without memo
// that re-render cascades into every panel — including motion components whose
// `layout` props re-measure the DOM — right while the dock CSS transition is
// already reflowing every frame. Memoized, a dock toggle re-renders App alone.
const Titlebar = memo(TitlebarImpl);
const Sidebar = memo(SidebarImpl);
const TabsBar = memo(TabsBarImpl);
const Inspector = memo(InspectorImpl);
const Statusbar = memo(StatusbarImpl);
const CommandPalette = memo(CommandPaletteImpl);
const Toast = memo(ToastImpl);
const Dialog = memo(DialogImpl);
const PanelResizeHandles = memo(PanelResizeHandlesImpl);
const WelcomeView = memo(WelcomeViewImpl);
const LogView = memo(LogViewImpl);
const ErrorTraceView = memo(ErrorTraceViewImpl);
const SourceEditView = memo(SourceEditViewImpl);
const SettingsView = memo(SettingsViewImpl);
const CombinedView = memo(CombinedViewImpl);
import { inspectorAvailable, useApp } from "./store";
import { themeBase } from "./lib/themes";
import { applyPalette, readBuiltinPalette } from "./lib/themeContract";
import type { TabDef } from "./lib/types";
import { Icon } from "./ui/Icon";

function renderView(tab: TabDef, active: boolean) {
  switch (tab.kind) {
    case "welcome": return <WelcomeView key={tab.id} active={active} />;
    case "source": return <LogView key={tab.id} tabId={tab.id} sourceId={tab.sourceId!} active={active} />;
    case "error-trace":
      return <ErrorTraceView key={tab.id} sourceId={tab.sourceId!} fingerprint={tab.fingerprint!} title={tab.title} active={active} />;
    case "source-edit": return <SourceEditView key={tab.id} active={active} />;
    case "settings": return <SettingsView key={tab.id} active={active} />;
    case "combined": return <CombinedView key={tab.id} tabId={tab.id} collectionId={tab.collectionId!} active={active} />;
  }
}

export default function App() {
  // per-slice selectors — a bare useApp() would re-render the whole shell on every log batch
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const theme = useApp((s) => s.theme);
  const compact = useApp((s) => s.compact);
  const leftCollapsed = useApp((s) => s.leftCollapsed);
  const rightCollapsed = useApp((s) => s.rightCollapsed);
  const { toggleLeft, toggleRight, setCommandOpen, editSource, openTransientFiles } = useApp.getState();

  const inspectorOk = useApp((s) => inspectorAvailable(s));
  const uiFont = useApp((s) => s.uiFont);
  const editorFont = useApp((s) => s.editorFont);
  const uiFontSize = useApp((s) => s.uiFontSize);

  // custom fonts override the design token stacks
  useEffect(() => {
    const st = document.documentElement.style;
    st.setProperty("--font-body", uiFont ? `"${uiFont}", var(--font-body-default)` : "var(--font-body-default)");
    st.setProperty("--font-mono", editorFont ? `"${editorFont}", var(--font-mono-default)` : "var(--font-mono-default)");
  }, [uiFont, editorFont]);

  // app-wide UI scale — base.css html rule reads this as its font-size
  useEffect(() => {
    document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`);
  }, [uiFontSize]);

  // mirror UI state onto <body> so the ported design CSS keeps working
  useEffect(() => {
    const cls = document.body.classList;
    const base = themeBase(theme);
    document.body.dataset.theme = theme;
    cls.toggle("light", base === "light");
    requestAnimationFrame(() => {
      const cs = getComputedStyle(document.body);
      const palette = readBuiltinPalette(cs);
      applyPalette(document.body.style, palette);
    });
    cls.toggle("compact", compact);
    cls.toggle("left-collapsed", leftCollapsed);
    cls.toggle("right-collapsed", rightCollapsed);
    cls.toggle("inspector-unavailable", !inspectorOk);
  }, [theme, compact, leftCollapsed, rightCollapsed, inspectorOk]);

  // open dropped files as transient sources
  useEffect(() => {
    const listener = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "drop" && payload.paths.length) openTransientFiles(payload.paths);
    });
    return () => { void listener.then((unlisten) => unlisten()); };
  }, [openTransientFiles]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
      if (mod && key === "n") {
        e.preventDefault();
        editSource(null);
      }
      if (mod && key === "o") {
        e.preventDefault();
        void (async () => {
          const picked = await open({ multiple: true, title: "Open log file(s)" });
          if (!picked) return;
          const paths = Array.isArray(picked) ? picked : [picked];
          openTransientFiles(paths);
        })();
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        useApp.getState().runActive();
      }
      if (mod && key === "b") {
        e.preventDefault();
        toggleLeft();
      }
      if (mod && key === "r") {
        e.preventDefault();
        toggleRight();
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        useApp.getState().openTab("settings");
      }
      if (mod && key === "w") {
        e.preventDefault();
        const s = useApp.getState();
        s.closeTab(s.activeTabId);
      }
      // ⌘1…⌘9 — jump to the Nth tab
      if (mod && key >= "1" && key <= "9") {
        const s = useApp.getState();
        const tab = s.tabs[Number(key) - 1];
        if (tab) {
          e.preventDefault();
          s.activateTab(tab.id);
        }
      }
      // ⌘+/⌘- — app-wide UI font size, 0.5px per press
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const s = useApp.getState();
        s.setUiFontSize(s.uiFontSize + 0.5);
      }
      if (mod && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        const s = useApp.getState();
        s.setUiFontSize(s.uiFontSize - 0.5);
      }
      if (e.key === "Escape") setCommandOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setCommandOpen, editSource, toggleLeft, toggleRight]);

  return (
    <div className="app-frame">
      <Titlebar />
      <main className="main">
        <Sidebar />
        <section className="workspace">
          <TabsBar />
          {tabs.map((tab) => renderView(tab, tab.id === activeTabId))}
        </section>
        <Inspector />
        <PanelResizeHandles />
      </main>
      <Statusbar />
      <button
        type="button"
        className={`tool-btn panel-toggle panel-corner left ${leftCollapsed ? "" : "active"}`}
        title="Toggle left sidebar (⌘B)"
        aria-label="Toggle left sidebar"
        onClick={toggleLeft}
      >
        <Icon name="panel-left" />
      </button>
      <button
        type="button"
        className={`tool-btn panel-toggle panel-corner right ${rightCollapsed || !inspectorOk ? "" : "active"}`}
        title="Toggle right panel (⌘R)"
        aria-label="Toggle right panel"
        onClick={toggleRight}
      >
        <Icon name="panel-right" />
      </button>
      <CommandPalette />
      <Toast />
      <Dialog />
    </div>
  );
}
