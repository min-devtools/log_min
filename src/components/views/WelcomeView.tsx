import { ToolButton } from "../../ui/ToolButton";
import { Icon, type IconName } from "../../ui/Icon";
import { useApp } from "../../store";

export function WelcomeView({ active }: { active: boolean }) {
  const { sources, openTab, editSource, setCommandOpen } = useApp();

  const actions: { icon: IconName; label: string; desc: string; onClick: () => void }[] = [
    { icon: "docs", label: "Tail a file", desc: "Rotation-aware tail of any log file.", onClick: () => editSource(null, { kind: "file" }) },
    { icon: "terminal", label: "Run a command", desc: "npm run dev, mvn… with ▶/⏹/⟳ and kill-tree.", onClick: () => editSource(null, { kind: "cmd" }) },
    { icon: "globe", label: "SSH tail a server", desc: "ssh user@host tail -F, managed like any command.", onClick: () => editSource(null, { kind: "cmd", command: "ssh user@host tail -F /var/log/app.log" }) },
    { icon: "search", label: "Stream over HTTP", desc: "Poll a remote .log URL — only new lines transfer.", onClick: () => editSource(null, { kind: "http" }) },
    { icon: "zap", label: "Stack traces", desc: "Node/TS traces detected — click a frame to open your editor.", onClick: () => {} },
    { icon: "settings", label: "Settings", desc: "Theme, fonts and density.", onClick: () => openTab("settings") },
  ];

  return (
    <section className={`content welcome-view ${active ? "active" : ""}`}>
      <div className="welcome-shell">
        <div className="welcome-hero">
          <div className="welcome-copy">
            <div className="welcome-kicker">
              {sources.length ? `${sources.length} source${sources.length === 1 ? "" : "s"} saved` : "no sources yet"}
            </div>
            <h1 className="welcome-title">LogMin</h1>
            <p className="welcome-text">
              {sources.length
                ? "Pick a source from the sidebar, or add another file or command."
                : "A tiny log viewer + command runner. Tail files, run dev commands, and keep every line searchable and copyable."}
            </p>
            <div className="welcome-actions">
              <ToolButton variant="primary" onClick={() => editSource(null)}>
                <Icon name="plus" /> New source
              </ToolButton>
              <ToolButton onClick={() => setCommandOpen(true)}>
                <Icon name="search" /> Search everywhere
              </ToolButton>
            </div>
          </div>
        </div>

        <div className="welcome-launch">
          {actions.map((a) => (
            <button type="button" className="welcome-card" key={a.label} onClick={a.onClick}>
              <span className="welcome-card-icon"><Icon name={a.icon} size={18} /></span>
              <strong>{a.label}</strong>
              <span className="welcome-card-desc">{a.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
