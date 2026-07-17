import { useEffect, useState } from "react";
import type { ErrorGroup } from "../../lib/errors";
import { insightIndexFor } from "../../lib/insight";
import { frameLocation } from "../../lib/logPresentation";
import { bufferFor } from "../../lib/ring";
import type { SourceDef } from "../../lib/types";
import { runtimeOf, useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { Kv } from "../../ui/Kv";
import { ToolButton } from "../../ui/ToolButton";

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
  onShowError: (group: ErrorGroup) => void;
}) {
  const rt = useApp((s) => runtimeOf(s, sourceId));
  const clearErrors = useApp((s) => s.clearErrors);
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
      <section className="dock-section panel">
        <h3>Source</h3>
        <Kv label="state"><span className={`dock-state-${rt.status}`}>{rt.status}</span></Kv>
        <Kv label="kind">{source?.kind ?? "—"}</Kv>
        <Kv label="target"><span title={target}>{target}</span></Kv>
        {rt.pid !== undefined && <Kv label="pid">{rt.pid}</Kv>}
        {rt.exitCode !== undefined && rt.exitCode !== null && <Kv label="exit code">{rt.exitCode}</Kv>}
        {rt.status === "live" && rt.startedAt !== undefined && <Kv label="uptime">{fmtUptime(now - rt.startedAt)}</Kv>}
      </section>

      <section className="dock-section panel">
        <h3>Throughput</h3>
        <Kv label="total lines">{fmtInt(rt.lines)}</Kv>
        <Kv label="retained">{fmtInt(ring.length)}</Kv>
        <Kv label="dropped">{fmtInt(rt.dropped)}</Kv>
        <Kv label="lines/s">{insight.linesPerSec.toFixed(1)}</Kv>
      </section>

      <section className="dock-section panel">
        <div className="dock-section-head">
          <h3>Signals</h3>
          {(rt.errors > 0 || groups.length > 0) && (
            <ToolButton
              iconOnly
              title="Clear captured errors from memory"
              aria-label="Clear captured errors"
              onClick={() => clearErrors(sourceId)}
            >
              <Icon name="trash" size={13} />
            </ToolButton>
          )}
        </div>
        {/* rt.errors counts occurrences (traces group to 1); errors60 counts err-leveled lines */}
        <Kv label="errors">{fmtInt(rt.errors)}{insight.errors60 ? ` · ${fmtInt(insight.errors60)} in 60s` : ""}</Kv>
        <Kv label="warnings">{fmtInt(insight.totalWarns)}{insight.warns60 ? ` · ${fmtInt(insight.warns60)} in 60s` : ""}</Kv>
        {recent.length > 0 && (
          <div className="dock-signal-list" aria-label="Recent error groups">
            {recent.map((group) => {
              const origin = group.topFrame ? frameLocation(group.topFrame, source) : null;
              return (
                <button
                  key={group.fingerprint}
                  type="button"
                  className="dock-signal"
                  title="Open a trace tab for this error"
                  onClick={() => onShowError(group)}
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
