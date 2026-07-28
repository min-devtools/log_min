import { motion, AnimatePresence } from "motion/react";
import { ToolButton } from "../ui/ToolButton";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { useApp } from "../store";
import logo from "../assets/logo.png";
import { themeBase } from "../lib/themes";

export function Titlebar() {
  const theme = useApp((s) => s.theme);
  const sourceCount = useApp((s) => s.sources.filter((x) => !x.transient).length);
  const temporaryCount = useApp((s) => s.sources.filter((x) => x.transient).length);
  // primitive selector: batches touch runtimes constantly, the count rarely changes
  const liveCount = useApp((s) => s.sources.filter((x) => s.runtimes[x.id]?.status === "live").length);
  const { toggleTheme, toggleCompact, setCommandOpen, editSource, openTab, startSource, stopSource } = useApp.getState();

  const activeTab = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const sourceId = activeTab?.kind === "source" ? activeTab.sourceId : undefined;
  const def = useApp((s) => (sourceId ? s.sources.find((x) => x.id === sourceId) : undefined));
  const status = useApp((s) => (sourceId ? s.runtimes[sourceId]?.status ?? "idle" : "idle"));
  const isCmd = def?.kind === "cmd";
  const live = status === "live";
  const primaryDisabled = !sourceId || (!isCmd && live);
  const primaryTitle = !sourceId
    ? "Open a source (⌘N)"
    : isCmd
      ? live ? "Restart (⌘↵)" : "Start (⌘↵)"
      : live ? "Streaming…" : def?.kind === "http" ? "Start streaming (⌘↵)" : "Start tailing (⌘↵)";

  const tone = liveCount ? "green" : "idle";
  const label = liveCount
    ? `${liveCount} live`
    : sourceCount
      ? `${sourceCount} saved${temporaryCount ? ` · ${temporaryCount} temporary` : ""}`
      : temporaryCount
        ? `${temporaryCount} temporary`
        : "no sources";

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="traffic">
        <img src={logo} alt="" className="app-logo" />
        <strong>LogMin</strong>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <button type="button" className="search" title="Search everywhere (⌘K)" onClick={() => setCommandOpen(true)}>
        <Icon name="search" size={13} />
        <span>Search Everywhere</span>
        <span style={{ marginLeft: "auto" }} />
        <kbd>⌘K</kbd>
      </button>
      <div className="toolbar">
        <ToolButton
          iconOnly
          variant="primary"
          title={primaryTitle}
          aria-label={primaryTitle}
          disabled={primaryDisabled}
          onClick={() => sourceId && void startSource(sourceId)}
        >
          <Icon name="play" />
        </ToolButton>
        <ToolButton
          iconOnly
          variant="danger"
          title="Stop"
          aria-label="Stop"
          disabled={!sourceId || !live}
          onClick={() => sourceId && void stopSource(sourceId)}
        >
          <Icon name="stop" />
        </ToolButton>
        <ToolButton iconOnly title="New source (⌘N)" aria-label="New source" onClick={() => editSource(null)}>
          <Icon name="plus" />
        </ToolButton>
        <ToolButton iconOnly title="Toggle theme" aria-label="Toggle theme" onClick={toggleTheme}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={themeBase(theme)}
              style={{ display: "inline-flex" }}
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
            >
              <Icon name={themeBase(theme) === "dark" ? "sun" : "moon"} />
            </motion.span>
          </AnimatePresence>
        </ToolButton>
        <ToolButton iconOnly title="Toggle compact density" aria-label="Toggle compact density" onClick={toggleCompact}>
          <Icon name="rows" />
        </ToolButton>
        <ToolButton iconOnly title="Settings (⌘,)" aria-label="Open settings" onClick={() => openTab("settings")}>
          <Icon name="settings" />
        </ToolButton>
      </div>
    </header>
  );
}
