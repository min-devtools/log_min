import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { runtimeOf, useApp } from "../store";

function fmtInt(n: number): string {
  return n.toLocaleString("en-US").replace(/,/g, " ");
}

function fmtUptime(startedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function Statusbar() {
  const { tabs, activeTabId, runtimes, sources, editSource } = useApp();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const sourceId = activeTab?.sourceId;
  const def = sourceId ? sources.find((s) => s.id === sourceId) : undefined;
  const rt = sourceId ? runtimeOf({ runtimes }, sourceId) : undefined;

  // uptime ticker — only while a live source is on screen
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rt || rt.status !== "live" || !rt.startedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [rt?.status, rt?.startedAt, rt]);

  const statusColor =
    rt?.status === "live" ? "var(--green)" : rt?.status === "error" ? "var(--red)" : "var(--text-3)";

  return (
    <footer className="statusbar">
      <div>
        {def ? (
          <>
            <span
              style={{ cursor: "pointer" }}
              title="Edit source"
              onClick={() => editSource(def.id)}
            >
              {def.name}
            </span>
            <span style={{ color: statusColor }}>
              ● {rt?.status === "live" ? "live" : rt?.status === "error" ? "error" : "idle"}
            </span>
            {rt?.status === "live" && rt.pid !== undefined && <span>pid {rt.pid}</span>}
            {rt?.status === "live" && rt.startedAt && <span>up {fmtUptime(rt.startedAt, now)}</span>}
            {rt?.status === "idle" && rt.exitCode !== undefined && rt.exitCode !== null && (
              <span style={{ color: rt.exitCode === 0 ? "var(--green)" : "var(--red)" }}>
                exit {rt.exitCode}
              </span>
            )}
          </>
        ) : (
          <span>{sources.length ? `${sources.length} source${sources.length === 1 ? "" : "s"}` : "no sources"}</span>
        )}
      </div>
      <div>
        {rt && (
          <>
            <span>{fmtInt(rt.lines)} lines</span>
            <span style={rt.errors ? { color: "var(--red)" } : undefined}>{fmtInt(rt.errors)} errors</span>
            {rt.dropped > 0 && <span style={{ color: "var(--orange)" }}>drop: {fmtInt(rt.dropped)}</span>}
          </>
        )}
      </div>
      <div className="right-status">
        <span>UTF-8</span>
        <span>{activeTab?.title ?? ""}</span>
        <span>v{__APP_VERSION__}</span>
        <span
          className="credit"
          style={{ cursor: "pointer" }}
          title="Created by @ngthminhdev — open LinkedIn"
          onClick={() => openUrl("https://www.linkedin.com/in/ngthminh-dev/")}
        >
          by @ngthminhdev
        </span>
      </div>
    </footer>
  );
}
