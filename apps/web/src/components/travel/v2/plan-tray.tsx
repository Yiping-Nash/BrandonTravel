import { useState } from "react";
import type { IntelligenceSnapshot, TravelTrip } from "@open-sunsama/types";
import {
  describeConstraint,
  ruleName,
  SnapshotStatus,
} from "../intelligence-panel";
import { IntelligenceInspector } from "../intelligence-inspector";
export function PlanTray({
  trip,
  data,
  error,
  onLocate,
  onEdit,
}: {
  trip: TravelTrip;
  data: IntelligenceSnapshot | null;
  error: string;
  onLocate: (ids: string[]) => void;
  onEdit?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const issues =
    data?.evaluation.results.filter(
      (r) => r.state === "CONFLICT" || r.state === "WARNING",
    ) ?? [];
  return (
    <section className="bt-tray" aria-label="计划状态">
      <div className="bt-tray-head">
        <strong>
          <small>计划状态</small>
          {data
            ? `${issues.length} 项需要注意`
            : error
              ? "检查读取失败"
              : "正在读取检查"}
        </strong>
        {data &&
          Object.entries(ruleName).map(([rule, name]) => {
            const count = issues.filter((r) => r.rule === rule).length;
            return count > 0 ? (
              <span className="bt-chip" key={rule}>
                {name} {count}
              </span>
            ) : null;
          })}
        <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起提醒 ⌃" : "查看提醒 ⌄"}
        </button>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            onClick={() =>
              window.dispatchEvent(new Event("travel-facts-updated"))
            }
          >
            重试读取
          </button>
        </p>
      )}
      {data && expanded && (
        <>
          <div className="bt-issues">
            {issues.map((r) => (
              <article
                key={r.id}
                className="bt-issue"
                data-reason={r.reasonCode}
                data-state={r.state}
              >
                <strong>
                  {r.state === "CONFLICT" ? "冲突" : "提醒"} ·{" "}
                  {ruleName[r.rule]}
                </strong>
                <p>
                  {trip.activities.find((a) => a.id === r.activityIds[0])?.date}
                </p>
                <p>{describeConstraint(r, trip)}</p>
                <button onClick={() => onLocate(r.activityIds)}>
                  定位到活动 →
                </button>
              </article>
            ))}
          </div>
          <details className="bt-details">
            <summary>资料覆盖与待补信息</summary>
            <SnapshotStatus
              trip={trip}
              data={data}
              onOpen={(id) => (onEdit ? onEdit(id) : onLocate([id]))}
            />
          </details>
          <details className="bt-details">
            <summary>来源与开发验收</summary>
            <IntelligenceInspector data={data} />
          </details>
        </>
      )}
      {data &&
        !issues.length &&
        data.capabilities.some((c) => c.needsData > 0) && (
          <p className="bt-muted">现有资料未发现冲突，仍有资料待补。</p>
        )}
      {data && (
        <p className="bt-muted" style={{ fontSize: 11, marginTop: 8 }}>
          检查覆盖：
          {data.capabilities
            .map((c) => `${ruleName[c.rule]} ${c.evaluated}/${c.objects}`)
            .join(" · ")}{" "}
          · 计划v{data.evaluation.tripRevision} · 事实v
          {data.evaluation.factsVersion}
        </p>
      )}
    </section>
  );
}
