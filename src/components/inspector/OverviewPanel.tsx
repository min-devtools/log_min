import { useEffect, useState } from "react";
import type { ErrorGroup } from "../../lib/errors";
import { insightIndexFor } from "../../lib/insight";
import { frameLocation } from "../../lib/logPresentation";
import { bufferFor } from "../../lib/ring";
import type { SourceDef } from "../../lib/types";
import { runtimeOf, useApp } from "../../store";
import { Icon } from "../../ui/Icon";

const fmtInt = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

function fmtUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

export function OverviewPanel({ sourceId, source, groups, onShowError }: {
  sourceId: string;
  source?: SourceDef;
  groups: ErrorGroup[];
  onShowError: (fingerprint: string) => void;
}) {
  const rt = useApp((s) => runtimeOf(s, sourceId));
  useApp((s) => s.bufVersions[sourceId] ?? 0); // re-render per batch
  const [, setTick] = useState(0);
  // 1s tick keeps uptime, rates, and 60s windows moving while the source is silent
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const now = Date.now();
  const ring = bufferFor(sourceId);
  const insight = insightIndexFor(sourceId).snapshot(now);
  const target = source?.command ?? source?.url ?? source?.path ?? "—";
  const recent = groups.slice(0, 5);

  return (
    <div className="inspector-scroll overview-dock">
      <section className="dock-section">
        <h4>Source</h4>
        <div className="dock-kv">
          <span>state</span><strong className={`dock-state-${rt.status}`}>{rt.status}</strong>
          <span>kind</span><strong>{source?.kind ?? "—"}</strong>
          <span>target</span><strong className="dock-target" title={target}>{target}</strong>
          {rt.pid !== undefined && <><span>pid</span><strong>{rt.pid}</strong></>}
          {rt.exitCode !== undefined && rt.exitCode !== null && <><span>exit code</span><strong>{rt.exitCode}</strong></>}
          {rt.status === "live" && rt.startedAt !== undefined && <><span>uptime</span><strong>{fmtUptime(now - rt.startedAt)}</strong></>}
        </div>
      </section>

      <section className="dock-section">
        <h4>Throughput</h4>
        <div className="dock-kv">
          <span>total lines</span><strong>{fmtInt(rt.lines)}</strong>
          <span>retained</span><strong>{fmtInt(ring.length)}</strong>
          <span>dropped</span><strong>{fmtInt(rt.dropped)}</strong>
          <span>lines/s</span><strong>{insight.linesPerSec.toFixed(1)}</strong>
        </div>
      </section>

      <section className="dock-section">
        <h4>Signals</h4>
        <div className="dock-kv">
          <span>errors</span>
          <strong>{fmtInt(rt.errors)}{insight.errors60 ? ` · ${fmtInt(insight.errors60)} in 60s` : ""}</strong>
          <span>warnings</span>
          <strong>{fmtInt(insight.totalWarns)}{insight.warns60 ? ` · ${fmtInt(insight.warns60)} in 60s` : ""}</strong>
        </div>
        {recent.length > 0 && (
          <div className="dock-signal-list" aria-label="Recent error groups">
            {recent.map((group) => {
              const origin = group.topFrame ? frameLocation(group.topFrame, source) : null;
              return (
                <button
                  key={group.fingerprint}
                  type="button"
                  className="dock-signal"
                  title="Open in the Errors tab"
                  onClick={() => onShowError(group.fingerprint)}
                >
                  <span className="dock-signal-count">{group.count}×</span>
                  <span className="dock-signal-copy">
                    <strong>{group.message}</strong>
                    {origin && <small>{origin.file}:{origin.position}</small>}
                  </span>
                  <Icon name="arrow-right" size={12} />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
