import { type ReactNode } from "react";
import type { ErrorGroup, ErrorSnapshot } from "../../lib/errors";
import { frameLocation } from "../../lib/logPresentation";
import type { SourceDef } from "../../lib/types";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();

function GroupButton({ group, source, onClick }: {
  group: ErrorGroup;
  source?: SourceDef;
  onClick: () => void;
}) {
  const origin = group.topFrame ? frameLocation(group.topFrame, source) : null;
  return (
    <button
      type="button"
      className="error-group"
      title="Open a trace tab for this error"
      onClick={onClick}
    >
      <span className="error-group-topline">
        <span className="error-group-kind">{group.frames.length ? "trace" : "error"}</span>
        <span className="error-group-count">{group.count}×</span>
      </span>
      <strong>{group.message}</strong>
      <span className="error-group-meta">
        <span>{origin ? `${origin.file}:${origin.position}` : "No application frame"}</span>
        <span>{fmtTime(group.lastAt)} · #{group.headSeq + 1}</span>
      </span>
    </button>
  );
}

/** Right-dock error list: one row per group, click opens the dedicated trace tab. */
export function ErrorsPanel({ sourceId, source, snapshot }: {
  sourceId?: string;
  source?: SourceDef;
  snapshot: ErrorSnapshot;
}): ReactNode {
  const openErrorTab = useApp((s) => s.openErrorTab);
  const clearErrors = useApp((s) => s.clearErrors);
  return (
    <div className="inspector-scroll error-dock">
      {snapshot.groups.length > 0 && (
        <div className="error-dock-head">
          <span>{snapshot.groups.length} group{snapshot.groups.length === 1 ? "" : "s"} · {snapshot.totalOccurrences}×</span>
          <ToolButton
            iconOnly
            title="Clear captured errors from memory"
            aria-label="Clear captured errors"
            onClick={() => sourceId && clearErrors(sourceId)}
          >
            <Icon name="trash" size={13} />
          </ToolButton>
        </div>
      )}
      {snapshot.groups.length === 0 ? (
        <div className="error-dock-empty">
          <span className="error-dock-empty-icon"><Icon name="zap" size={18} /></span>
          <strong>No errors yet</strong>
          <p>Errors are captured with ±10 lines of context and kept even when the buffer is cleared.</p>
        </div>
      ) : (
        <div className="error-group-list" aria-label="Error groups">
          {snapshot.groups.map((group) => (
            <GroupButton
              key={group.fingerprint}
              group={group}
              source={source}
              onClick={() => sourceId && openErrorTab(sourceId, group.fingerprint, group.message)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
