import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { sourceIcon } from "../lib/types";
import { useApp } from "../store";
import { Icon, type IconName } from "../ui/Icon";

interface Command {
  icon: IconName;
  label: string;
  kbd?: string;
  action: () => void;
}

export function CommandPalette() {
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandOpen = useApp((s) => s.commandOpen);
  const sources = useApp((s) => s.sources);
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
    openSourceTab, startSource, stopSource, setCommandOpen,
  } = useApp.getState();

  useEffect(() => {
    if (commandOpen) {
      setInput("");
      setCursor(0);
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
      { icon: "arrow-down", label: "Toggle follow (active tab)", kbd: "⌘↵", action: () => runActive() },
      { icon: "panel-left", label: "Toggle left sidebar", kbd: "⌘B", action: () => toggleLeft() },
      { icon: "panel-right", label: "Toggle right panel", kbd: "⌘R", action: () => toggleRight() },
      { icon: "settings", label: "Open Settings", kbd: "⌘,", action: () => openTab("settings") },
      { icon: "moon", label: "Toggle theme", action: () => toggleTheme() },
      { icon: "rows", label: "Toggle compact density", action: () => toggleCompact() },
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
  }, [sources, statuses]);

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    return (q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands).slice(0, 12);
  }, [commands, input]);

  if (!commandOpen) return null;

  const runCommand = (cmd: Command) => {
    setCommandOpen(false);
    cmd.action();
  };

  return (
    <div
      className="command"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setCommandOpen(false);
      }}
    >
      <div className="palette">
        <input
          ref={inputRef}
          value={input}
          placeholder="Run command, open source, start/stop..."
          onChange={(e) => {
            setInput(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(filtered.length - 1, c + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            }
            if (e.key === "Enter" && filtered[cursor]) runCommand(filtered[cursor]);
            if (e.key === "Escape") setCommandOpen(false);
          }}
        />
        <div className="cmd-list">
          {filtered.map((cmd, i) => (
            <div
              key={cmd.label}
              className={`cmd ${i === cursor ? "active" : ""}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => runCommand(cmd)}
            >
              <Icon name={cmd.icon} size={15} />
              <span>{cmd.label}</span>
              {cmd.kbd ? <span className="kbd">{cmd.kbd}</span> : <span />}
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-note">No matching commands.</div>}
        </div>
      </div>
    </div>
  );
}
