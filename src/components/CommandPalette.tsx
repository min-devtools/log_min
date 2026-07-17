import { useEffect, useMemo, useRef, useState } from "react";
import { runtimeOf, useApp } from "../store";
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
  const app = useApp();

  useEffect(() => {
    if (app.commandOpen) {
      setInput("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [app.commandOpen]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { icon: "plus", label: "New source", kbd: "⌘N", action: () => app.editSource(null) },
      { icon: "docs", label: "New file tail…", action: () => app.editSource(null, { kind: "file" }) },
      { icon: "terminal", label: "New command…", action: () => app.editSource(null, { kind: "cmd" }) },
      {
        icon: "globe",
        label: "New HTTP log stream…",
        action: () => app.editSource(null, { kind: "http" }),
      },
      {
        icon: "terminal",
        label: "SSH tail…",
        action: () => app.editSource(null, { kind: "cmd", command: "ssh user@host tail -F /var/log/app.log" }),
      },
      { icon: "arrow-down", label: "Toggle follow (active tab)", kbd: "⌘↵", action: () => app.runActive() },
      { icon: "panel-left", label: "Toggle left sidebar", kbd: "⌘B", action: () => app.toggleLeft() },
      { icon: "panel-right", label: "Toggle right panel", kbd: "⌘R", action: () => app.toggleRight() },
      { icon: "settings", label: "Open Settings", kbd: "⌘,", action: () => app.openTab("settings") },
      { icon: "moon", label: "Toggle theme", action: () => app.toggleTheme() },
      { icon: "rows", label: "Toggle compact density", action: () => app.toggleCompact() },
    ];
    for (const s of app.sources) {
      const rt = runtimeOf(app, s.id);
      base.push({
        icon: s.kind === "cmd" ? "terminal" : s.kind === "http" ? "globe" : "docs",
        label: `Open source: ${s.name}`,
        action: () => app.openSourceTab(s.id),
      });
      if (rt.status === "live") {
        base.push({
          icon: "stop",
          label: `Stop: ${s.name}`,
          action: () => void app.stopSource(s.id),
        });
        if (s.kind === "cmd") {
          base.push({
            icon: "refresh",
            label: `Restart: ${s.name}`,
            action: () => void app.startSource(s.id),
          });
        }
      } else {
        base.push({
          icon: "play",
          label: `${s.kind === "cmd" ? "Run" : s.kind === "http" ? "Stream" : "Tail"}: ${s.name}`,
          action: () => {
            app.openSourceTab(s.id);
            void app.startSource(s.id);
          },
        });
      }
    }
    return base;
  }, [app]);

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    return (q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands).slice(0, 12);
  }, [commands, input]);

  if (!app.commandOpen) return null;

  const runCommand = (cmd: Command) => {
    app.setCommandOpen(false);
    cmd.action();
  };

  return (
    <div
      className="command"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) app.setCommandOpen(false);
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
            if (e.key === "Escape") app.setCommandOpen(false);
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
