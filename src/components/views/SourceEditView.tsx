import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ToolButton } from "../../ui/ToolButton";
import { Icon, type IconName } from "../../ui/Icon";
import { newSourceId, useApp } from "../../store";
import { parseCurl } from "../../lib/curl";
import { dockerPs, type DockerContainer } from "../../lib/logmin";
import type { SourceDef, SourceKind } from "../../lib/types";

/** "docker" is form-only — picking a container creates a plain cmd source */
type FormKind = SourceKind | "docker";

const TYPES: { id: FormKind; icon: IconName; title: string; desc: string }[] = [
  { id: "cmd", icon: "terminal", title: "Command", desc: "Run a process via your login shell and capture its output." },
  { id: "file", icon: "docs", title: "File", desc: "Tail a local log file. Follows rotation and truncation." },
  { id: "http", icon: "globe", title: "HTTP", desc: "Poll a remote log with Range requests — only new bytes transfer." },
  { id: "docker", icon: "topics", title: "Docker", desc: "Pick a running container and stream docker logs -f." },
];

function parseKv(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let any = false;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    any = true;
  }
  return any ? out : undefined;
}

function kvToText(kv?: Record<string, string>): string {
  return kv ? Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") : "";
}

const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

export function SourceEditView({ active }: { active: boolean }) {
  const sources = useApp((s) => s.sources);
  const editingSourceId = useApp((s) => s.editingSourceId);
  const sourceDraft = useApp((s) => s.sourceDraft);
  const { saveSource, openSourceTab, closeTab, startSource, showToast } = useApp.getState();
  const existing = editingSourceId ? sources.find((x) => x.id === editingSourceId) : undefined;

  const [kind, setKind] = useState<FormKind>(existing?.kind ?? (sourceDraft?.kind as SourceKind) ?? "cmd");
  const [name, setName] = useState(existing?.name ?? sourceDraft?.name ?? "");
  const [path, setPath] = useState(existing?.path ?? sourceDraft?.path ?? "");
  const [command, setCommand] = useState(existing?.command ?? sourceDraft?.command ?? "");
  const [cwd, setCwd] = useState(existing?.cwd ?? sourceDraft?.cwd ?? "");
  const [envText, setEnvText] = useState(kvToText(existing?.env ?? (sourceDraft?.env as Record<string, string>)));
  const [url, setUrl] = useState(existing?.url ?? sourceDraft?.url ?? "");
  const [headersText, setHeadersText] = useState(kvToText(existing?.headers ?? (sourceDraft?.headers as Record<string, string>)));
  const [containers, setContainers] = useState<DockerContainer[] | null>(null);
  const [dockerError, setDockerError] = useState("");
  const [dockerLoading, setDockerLoading] = useState(false);

  // re-seed the form when switching between edit targets
  useEffect(() => {
    setKind(existing?.kind ?? (sourceDraft?.kind as SourceKind) ?? "cmd");
    setName(existing?.name ?? sourceDraft?.name ?? "");
    setPath(existing?.path ?? sourceDraft?.path ?? "");
    setCommand(existing?.command ?? sourceDraft?.command ?? "");
    setCwd(existing?.cwd ?? sourceDraft?.cwd ?? "");
    setEnvText(kvToText(existing?.env ?? (sourceDraft?.env as Record<string, string>)));
    setUrl(existing?.url ?? sourceDraft?.url ?? "");
    setHeadersText(kvToText(existing?.headers ?? (sourceDraft?.headers as Record<string, string>)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingSourceId, sourceDraft]);

  const newId = newSourceId;

  /** import N files at once — one source + one tab per file, tail starts immediately */
  const importFiles = (paths: string[]) => {
    for (const p of paths) {
      const def: SourceDef = { id: newId(), name: baseName(p), kind: "file", path: p };
      saveSource(def);
      openSourceTab(def.id);
      void startSource(def.id);
    }
    closeTab("source-edit");
    showToast("Imported", `${paths.length} file${paths.length === 1 ? "" : "s"} now tailing.`);
  };

  const browseFiles = async () => {
    const picked = await open({ multiple: true, title: "Choose log file(s)" });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    if (paths.length === 1) {
      setPath(paths[0]);
      if (!name) setName(baseName(paths[0]));
    } else {
      importFiles(paths);
    }
  };

  const loadDocker = async () => {
    setDockerLoading(true);
    setDockerError("");
    try {
      setContainers(await dockerPs());
    } catch (err) {
      setContainers([]);
      setDockerError(String(err));
    } finally {
      setDockerLoading(false);
    }
  };

  // first switch to the Docker pane loads the container list
  useEffect(() => {
    if (kind === "docker" && containers === null && !dockerLoading) void loadDocker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  /** container click → cmd source streaming `docker logs -f`, opened immediately */
  const openContainer = (c: DockerContainer) => {
    const def: SourceDef = {
      id: newId(),
      name: c.name,
      kind: "cmd",
      command: `docker logs -f --tail 200 ${c.name}`,
    };
    saveSource(def);
    closeTab("source-edit");
    openSourceTab(def.id);
    void startSource(def.id);
  };

  /** pasting a curl command anywhere in the HTTP form fills URL + headers */
  const onCurlPaste = (e: React.ClipboardEvent) => {
    const parsed = parseCurl(e.clipboardData.getData("text"));
    if (!parsed) return;
    e.preventDefault();
    setUrl(parsed.url);
    if (Object.keys(parsed.headers).length) setHeadersText(kvToText(parsed.headers));
    showToast("curl imported", "URL and headers extracted from the curl command.");
  };

  const browseCwd = async () => {
    const picked = await open({ directory: true, title: "Choose working directory" });
    if (typeof picked === "string") setCwd(picked);
  };

  const save = (startAfter: boolean) => {
    if (kind === "docker") return; // the picker creates sources directly
    const target = kind === "file" ? path.trim() : kind === "http" ? url.trim() : command.trim();
    if (!target) {
      showToast(
        "Missing field",
        kind === "file" ? "File path is required." : kind === "http" ? "URL is required." : "Command is required.",
        "warn",
      );
      return;
    }
    if (kind === "http" && !/^https?:\/\//.test(target)) {
      showToast("Invalid URL", "URL must start with http:// or https://", "warn");
      return;
    }
    const def: SourceDef = {
      id: existing?.id ?? newId(),
      name:
        name.trim() ||
        (kind === "file"
          ? baseName(target)
          : kind === "http"
            ? baseName(new URL(target).pathname) || new URL(target).host
            : target.split(/\s+/).slice(0, 2).join(" ")),
      kind,
      path: kind === "file" ? target : undefined,
      command: kind === "cmd" ? target : undefined,
      cwd: kind === "cmd" && cwd.trim() ? cwd.trim() : undefined,
      env: kind === "cmd" ? parseKv(envText) : undefined,
      url: kind === "http" ? target : undefined,
      headers: kind === "http" ? parseKv(headersText) : undefined,
    };
    saveSource(def);
    closeTab("source-edit");
    openSourceTab(def.id);
    if (startAfter) void startSource(def.id);
  };

  const monoInput = { width: "100%", fontFamily: "var(--font-mono)" } as const;

  const nameRow = (
    <div className="settings-row">
      <span className="settings-icon"><Icon name="pencil" size={15} /></span>
      <div className="settings-copy"><strong>Name</strong><span>Shown on the tab and sidebar. Defaults to the file name, command or URL.</span></div>
      <div className="settings-control">
        <input className="settings-select" value={name} placeholder="api-server" spellCheck={false} onChange={(e) => setName(e.target.value)} />
      </div>
    </div>
  );

  return (
    <section className={`content settings-view ${active ? "active" : ""}`}>
      <div className="source-edit-shell">
        <div className="settings-header">
          <h2>{existing ? "Edit Source" : "New Source"}</h2>
          <p style={{ margin: 0, color: "var(--text-3)", fontSize: "0.9231rem" }}>
            A source is a stream of log lines — a file to tail, a command to run and manage, a remote log over HTTP, or a Docker container.
          </p>
        </div>

        <div className="source-edit-grid">
          <nav className="source-type-rail" aria-label="Source type">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`source-type-card ${kind === t.id ? "active" : ""}`}
                aria-pressed={kind === t.id}
                onClick={() => setKind(t.id)}
              >
                <span className="source-type-icon"><Icon name={t.icon} size={16} /></span>
                <span className="source-type-copy">
                  <strong>{t.title}</strong>
                  <span>{t.desc}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="source-edit-main">
        {kind === "file" && (
          <section className="settings-card">
            <h3>File</h3>
            <div className="settings-row">
              <span className="settings-icon"><Icon name="docs" size={15} /></span>
              <div className="settings-copy"><strong>Path</strong><span>Pick several files at once — each opens as its own source and tab.</span></div>
              <div className="settings-control" style={{ flex: 1, gap: 6 }}>
                <input
                  className="settings-select"
                  style={monoInput}
                  value={path}
                  placeholder="/var/log/app.log"
                  spellCheck={false}
                  onChange={(e) => setPath(e.target.value)}
                />
                <ToolButton onClick={() => void browseFiles()}><Icon name="docs" /> Browse…</ToolButton>
              </div>
            </div>
            {nameRow}
          </section>
        )}

        {kind === "cmd" && (
          <section className="settings-card">
            <h3>Command</h3>
            <div className="settings-row stack">
              <span className="settings-icon"><Icon name="terminal" size={15} /></span>
              <div className="settings-copy"><strong>Command</strong><span>Runs via $SHELL</span></div>
              <div className="settings-control">
                <textarea
                  className="settings-select cmd-input"
                  style={{ ...monoInput, minHeight: 96, resize: "vertical" }}
                  value={command}
                  placeholder={"npm run dev\n# or paste a multi-line script"}
                  spellCheck={false}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-icon"><Icon name="database" size={15} /></span>
              <div className="settings-copy"><strong>Working directory</strong><span>Optional. Where the command runs.</span></div>
              <div className="settings-control" style={{ flex: 1, gap: 6 }}>
                <input
                  className="settings-select"
                  style={monoInput}
                  value={cwd}
                  placeholder="~/Project/my-app"
                  spellCheck={false}
                  onChange={(e) => setCwd(e.target.value)}
                />
                <ToolButton onClick={() => void browseCwd()}><Icon name="docs" /> Browse…</ToolButton>
              </div>
            </div>
            <div className="settings-row stack">
              <span className="settings-icon"><Icon name="braces" size={15} /></span>
              <div className="settings-copy"><strong>Environment</strong><span>Optional. One KEY=VALUE per line, merged over your shell env.</span></div>
              <div className="settings-control">
                <textarea
                  className="settings-select"
                  style={{ ...monoInput, minHeight: 72, resize: "vertical" }}
                  value={envText}
                  placeholder={"PORT=3000\nDEBUG=app:*"}
                  spellCheck={false}
                  onChange={(e) => setEnvText(e.target.value)}
                />
              </div>
            </div>
            {nameRow}
          </section>
        )}

        {kind === "http" && (
          <section className="settings-card">
            <h3>HTTP</h3>
            <div className="settings-row stack">
              <span className="settings-icon"><Icon name="globe" size={15} /></span>
              <div className="settings-copy"><strong>URL</strong><span>A log file served over HTTP(S). Polled every 2s with Range — only new lines transfer. First attach loads the last 64 KB. Paste a curl command to fill URL and headers.</span></div>
              <div className="settings-control">
                <input
                  className="settings-select"
                  style={monoInput}
                  value={url}
                  placeholder="https://host/path/service.log — or paste a curl command"
                  spellCheck={false}
                  onChange={(e) => setUrl(e.target.value)}
                  onPaste={onCurlPaste}
                />
              </div>
            </div>
            <div className="settings-row stack">
              <span className="settings-icon"><Icon name="key" size={15} /></span>
              <div className="settings-copy"><strong>Headers</strong><span>Optional. One KEY=VALUE per line, e.g. Authorization=Bearer …</span></div>
              <div className="settings-control">
                <textarea
                  className="settings-select"
                  style={{ ...monoInput, minHeight: 72, resize: "vertical" }}
                  value={headersText}
                  placeholder={"Authorization=Bearer token"}
                  spellCheck={false}
                  onChange={(e) => setHeadersText(e.target.value)}
                  onPaste={onCurlPaste}
                />
              </div>
            </div>
            {nameRow}
          </section>
        )}

        {kind === "docker" && (
          <section className="settings-card">
            <h3>Running containers</h3>
            <div className="settings-row">
              <span className="settings-icon"><Icon name="topics" size={15} /></span>
              <div className="settings-copy">
                <strong>Pick a container</strong>
                <span>Click one to stream its logs (docker logs -f, last 200 lines). Use the ports column to find a container by its published port.</span>
              </div>
              <div className="settings-control">
                <ToolButton onClick={() => void loadDocker()} disabled={dockerLoading}>
                  <Icon name="refresh" /> {dockerLoading ? "Loading…" : "Refresh"}
                </ToolButton>
              </div>
            </div>
            {dockerError ? (
              <div className="empty-note" style={{ padding: "12px 14px", color: "var(--status-danger)" }}>
                {dockerError}
              </div>
            ) : containers && containers.length === 0 && !dockerLoading ? (
              <div className="empty-note" style={{ padding: "12px 14px" }}>
                No running containers.
              </div>
            ) : (
              <div className="docker-list">
                {(containers ?? []).map((c) => (
                  <button key={c.id} type="button" className="docker-row" onClick={() => openContainer(c)}>
                    <span className="docker-row-main">
                      <strong>{c.name}</strong>
                      <span>{c.image}</span>
                    </span>
                    <span className="docker-row-meta">
                      <code>{c.ports || "no ports"}</code>
                      <em>{c.status}</em>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="source-edit-actions">
          <ToolButton onClick={() => closeTab("source-edit")}>Cancel</ToolButton>
          {kind !== "docker" && (
            <>
              <ToolButton onClick={() => save(false)}><Icon name="save" /> Save</ToolButton>
              <ToolButton variant="primary" onClick={() => save(true)}>
                <Icon name="play" /> Save &amp; {kind === "cmd" ? "Run" : kind === "http" ? "Stream" : "Tail"}
              </ToolButton>
            </>
          )}
        </div>
          </div>
        </div>
      </div>
    </section>
  );
}
