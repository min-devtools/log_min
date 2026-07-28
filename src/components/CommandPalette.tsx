import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { sourceIcon } from "../lib/types";
import { useApp } from "../store";
import { Icon, type IconName } from "../ui/Icon";
import { ToolButton } from "../ui/ToolButton";
import { THEMES } from "../lib/themes";
import { fuzzyMatch, highlight } from "../lib/fuzzy";

interface Command {
  icon: IconName;
  label: string;
  kbd?: string;
  action: () => void;
}

function renderHL(text: string, indices: number[]): ReactNode {
  if (!indices.length) return text;
  return highlight(text, indices).map((p, i) =>
    p.mark ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>,
  );
}

// ponytail: recents persisted in localStorage, max 3 shown.
const REC_KEY = "logmin:cmd-recents";
const REC_SHOW = 3;
const REC_KEEP = 8;
function readRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(REC_KEY) ?? "[]") as string[]; } catch { return []; }
}
function pushRecent(label: string): void {
  const cur = readRecents().filter((l) => l !== label);
  cur.unshift(label);
  try { localStorage.setItem(REC_KEY, JSON.stringify(cur.slice(0, REC_KEEP))); } catch { /* ignore */ }
}

export function CommandPalette() {
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const [themePicker, setThemePicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandOpen = useApp((s) => s.commandOpen);
  const theme = useApp((s) => s.theme);
  const vimKeys = useApp((s) => s.vimKeys);
  const sources = useApp((s) => s.sources);
  const collections = useApp((s) => s.collections);
  // statuses only — per-batch counter updates must not rebuild the command list
  const statuses = useApp(
    useShallow((s) => {
      const out: Record<string, string> = {};
      for (const id in s.runtimes) out[id] = s.runtimes[id].status;
      return out;
    }),
  );
  const {
    editSource, runActive, toggleLeft, toggleRight, openTab, toggleTheme, toggleCompact,
    openSourceTab, startSource, stopSource, setCommandOpen, openCombinedTab, setTheme,
  } = useApp.getState();

  useEffect(() => {
    if (commandOpen) {
      setInput("");
      setCursor(0);
      setRecents(readRecents());
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [commandOpen]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { icon: "plus", label: "New source", kbd: "⌘N", action: () => editSource(null) },
      { icon: "docs", label: "New file tail…", action: () => editSource(null, { kind: "file" }) },
      { icon: "terminal", label: "New command…", action: () => editSource(null, { kind: "cmd" }) },
      {
        icon: "globe",
        label: "New HTTP log stream…",
        action: () => editSource(null, { kind: "http" }),
      },
      {
        icon: "terminal",
        label: "SSH tail…",
        action: () => editSource(null, { kind: "cmd", command: "ssh user@host tail -F /var/log/app.log" }),
      },
      { icon: "play", label: "Start/restart active source", kbd: "⌘↵", action: () => runActive() },
      { icon: "panel-left", label: "Toggle left sidebar", kbd: "⌘B", action: () => toggleLeft() },
      { icon: "panel-right", label: "Toggle right panel", kbd: "⌘R", action: () => toggleRight() },
      { icon: "settings", label: "Open Settings", kbd: "⌘,", action: () => openTab("settings") },
      { icon: "moon", label: "Toggle theme", action: () => toggleTheme() },
      { icon: "settings", label: "Theme picker", action: () => setThemePicker(true) },
      { icon: "rows", label: "Toggle compact density", action: () => toggleCompact() },
      ...collections.map((c) => ({
        icon: "rows" as const,
        label: `Combined logs: ${c.name}`,
        action: () => openCombinedTab(c.id),
      })),
    ];
    for (const s of sources) {
      base.push({
        icon: sourceIcon(s),
        label: `Open source: ${s.name}`,
        action: () => openSourceTab(s.id),
      });
      if (statuses[s.id] === "live") {
        base.push({
          icon: "stop",
          label: `Stop: ${s.name}`,
          action: () => void stopSource(s.id),
        });
        if (s.kind === "cmd") {
          base.push({
            icon: "refresh",
            label: `Restart: ${s.name}`,
            action: () => void startSource(s.id),
          });
        }
      } else {
        base.push({
          icon: "play",
          label: `${s.kind === "cmd" ? "Run" : s.kind === "http" ? "Stream" : "Tail"}: ${s.name}`,
          action: () => {
            openSourceTab(s.id);
            void startSource(s.id);
          },
        });
      }
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, statuses, collections]);

  const filtered = useMemo<Array<Command & { labelIdx: number[]; recent: boolean }>>(() => {
    const q = input.trim();
    const mFor = (c: Command) => (q ? fuzzyMatch(q, c.label) : ({ indices: [] as number[], score: 0 } as const));

    const recentResolved = recents
      .map((l) => commands.find((c) => c.label === l))
      .filter((c): c is Command => !!c)
      .slice(0, REC_SHOW);
    const recentMatches = recentResolved
      .map((c) => ({ cmd: c, m: mFor(c) }))
      .filter((x) => !!x.m)
      .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0));
    const recentLabels = new Set(recentMatches.map((x) => x.cmd.label));

    const restMatches = commands
      .filter((c) => !recentLabels.has(c.label))
      .map((c) => ({ cmd: c, m: mFor(c) }))
      .filter((x) => !!x.m)
      .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0));

    const out: Array<Command & { labelIdx: number[]; recent: boolean }> = [];
    for (const x of recentMatches) out.push({ ...x.cmd, labelIdx: x.m!.indices, recent: true });
    for (const x of restMatches) out.push({ ...x.cmd, labelIdx: x.m!.indices, recent: false });
    return out.slice(0, 12);
  }, [commands, input, recents]);

  const runCommand = (cmd: Command) => {
    setCommandOpen(false);
    pushRecent(cmd.label);
    cmd.action();
  };

  return (
    <>
    <AnimatePresence>
      {commandOpen && (
        <motion.div
          key="command-palette-backdrop"
          className="command"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCommandOpen(false);
          }}
        >
          <motion.div
            key="command-palette-modal"
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 450, damping: 32 }}
          >
            <input
              ref={inputRef}
              value={input}
              placeholder="Run command, open source, start/stop..."
              onChange={(e) => {
                setInput(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                const next = e.key === "Tab" || (vimKeys && e.ctrlKey && e.key.toLowerCase() === "n");
                const previous = vimKeys && e.ctrlKey && e.key.toLowerCase() === "p";
                if (e.key === "ArrowDown" || next) {
                  e.preventDefault();
                  setCursor((c) => Math.min(Math.max(0, filtered.length - 1), c + 1));
                }
                if (e.key === "ArrowUp" || previous) {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                }
                if (e.key === "Enter" && filtered[cursor]) runCommand(filtered[cursor]);
                if (e.key === "Escape") setCommandOpen(false);
              }}
            />
            <div className="cmd-list">
              {filtered.map((cmd, i) => (
                <Fragment key={cmd.label}>
                  {(i === 0 || filtered[i - 1].recent !== cmd.recent) && <div className="cmd-group">{cmd.recent ? "Recents" : "Commands"}</div>}
                  <div
                    className={`cmd ${i === cursor ? "active" : ""}`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => runCommand(cmd)}
                  >
                    <Icon name={cmd.icon} size={15} />
                    <span>{renderHL(cmd.label, cmd.labelIdx)}</span>
                    {cmd.kbd ? <span className="kbd">{cmd.kbd}</span> : <span />}
                  </div>
                </Fragment>
              ))}
              {filtered.length === 0 && <div className="empty-note">No matching commands.</div>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    <AnimatePresence>
      {themePicker && (
        <motion.div
          key="theme-picker-backdrop"
          className="modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setThemePicker(false); }}
        >
          <motion.div
            key="theme-picker-content"
            className="prompt-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Theme picker"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            <strong>Theme picker</strong>
            <p className="prompt-dialog-msg">Changes apply immediately and are saved for this device.</p>
            <select className="side-search" style={{ width: "100%" }} value={theme} autoFocus onChange={(event) => setTheme(event.target.value)}>
              <optgroup label="Dark">{THEMES.filter((item) => item.base === "dark").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
              <optgroup label="Light">{THEMES.filter((item) => item.base === "light").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
            </select>
            <div className="prompt-dialog-foot"><ToolButton variant="primary" onClick={() => setThemePicker(false)}>Done</ToolButton></div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
