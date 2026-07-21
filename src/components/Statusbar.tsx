import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useShallow } from "zustand/react/shallow";
import { runtimeOf, useApp } from "../store";
import { UpdateBadge } from "../lib/updateCheck";

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
  const activeTab = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const sourceId = activeTab?.sourceId;
  const def = useApp((s) => (sourceId ? s.sources.find((x) => x.id === sourceId) : undefined));
  const sourceCount = useApp((s) => s.sources.length);
  // shallow pick: only the ACTIVE source's counters redraw the bar, not every batch
  const rt = useApp(useShallow((s) => (sourceId ? { ...runtimeOf(s, sourceId) } : undefined)));
  const { editSource } = useApp.getState();

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
          <span>{sourceCount ? `${sourceCount} source${sourceCount === 1 ? "" : "s"}` : "no sources"}</span>
        )}
      </div>
      <div>
        {rt && (
          <>
            <span>{fmtInt(rt.lines)} lines</span>
            {rt.dropped > 0 && <span style={{ color: "var(--orange)" }}>drop: {fmtInt(rt.dropped)}</span>}
          </>
        )}
      </div>
      <div className="right-status">
        <span>UTF-8</span>
        <span>{activeTab?.title ?? ""}</span>
        <span>v{__APP_VERSION__}</span>
        <UpdateBadge repo="min-devtools/log_min" />
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
