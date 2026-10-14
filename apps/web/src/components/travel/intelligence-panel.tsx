import { useEffect, useState } from "react";
import type {
  IntelligenceSnapshot,
  TravelTrip,
  ConstraintResult,
  IntelligenceRoot,
} from "@open-sunsama/types";
import { travelApi } from "./api";
import { IntelligenceInspector } from "./intelligence-inspector";
const reasons: Record<string, string> = {
  ENVIRONMENT_UNSPECIFIED: "未指定室内／户外，无法判断天气影响",
  WEATHER_REGION_UNRESOLVED: "地点天气区域未核实",
  WEATHER_OUT_OF_RANGE: "计划日期超出当前预报范围",
  WEATHER_CONDITION_UNKNOWN: "天气描述无法可靠归一化",
  OUTDOOR_HEAVY_RAIN:
    "户外活动所在区域有日级强降雨预报（非时段预报／灾害预警）",
  PLACE_UNCONFIRMED: "未确认真实地点",
  ACTIVITY_UNSCHEDULED: "尚未安排时间",
  FACT_MISSING: "缺少现实资料",
  FACT_STALE: "资料已过期，请刷新",
  FACT_PROVIDER_FAILED: "供应商查询失败",
  FACT_INPUT_MISMATCH: "计划或地点变化，需重新查询",
  FACT_PARSE_INCOMPLETE: "资料解析或字段不完整，无法可靠判断",
  HISTORICAL_HOURS_UNVERIFIED: "当前资料不能证明历史日期当时营业",
  HOURS_SOURCE_INCONSISTENT: "今日与每周营业信息不一致",
  SPECIAL_DATE_UNVERIFIED: "特殊日期营业未核实",
  FACT_DATE_NOT_APPLICABLE: "营业资料不适用这一天",
};
export function describeConstraint(r: ConstraintResult, trip: TravelTrip) {
  const names = r.activityIds
    .map((id) => trip.activities.find((a) => a.id === id)?.title ?? "活动")
    .join(" → ");
  if (r.rule === "OVERLAP")
    return `${names}：重叠${r.details.overlapMinutes}分钟`;
  if (r.reasonCode === "OPENING_NOT_COVERED")
    return `${names}：活动有${r.rule === "OPENING_COVERAGE" ? r.details.uncoveredIntervals?.reduce((n, x) => n + x.end - x.start, 0) : 0}分钟不在营业区间内`;
  if (r.rule === "TRANSITION_GAP" && r.state === "CONFLICT")
    return `${names}：预计路程不足${r.details.shortageMinutes}分钟`;
  return `${names}：${reasons[r.reasonCode] ?? "无法判断"}`;
}

export const reasonLabel = (code: string) =>
  reasons[code] ??
  (
    {
      OK: "明确室内：天气检查不适用",
      ACTIVITY_OVERLAP: "活动时间重叠",
      TRANSITION_TIME_SHORTAGE: "路程空档不足",
      OPENING_NOT_COVERED: "活动超出营业区间",
    } as Record<string, string>
  )[code] ??
  code;
const actions: Record<IntelligenceRoot["action"], string> = {
  EDIT_PLAN: "修改安排",
  BIND_PLACE: "打开事件绑定地点",
  SET_ENVIRONMENT: "打开事件指定室内／户外",
  QUERY_FACTS: "在现实资料中显式查询",
  REFRESH_FACTS: "在现实资料中刷新",
  WAIT: "等待可取得日期或冷却结束，勿反复刷新",
  VIEW_SOURCE: "查看来源／人工核实（不会保证稍后可用）",
  NONE: "无需操作",
};
export function SnapshotStatus({
  data,
  trip,
  onOpen,
}: {
  data: IntelligenceSnapshot;
  trip: TravelTrip;
  onOpen?: (id: string) => void;
}) {
  const conflicts = data.evaluation.results.filter(
      (r) => r.state === "CONFLICT",
    ),
    warnings = data.evaluation.results.filter((r) => r.state === "WARNING");
  const groups = [
    "ACTION_REQUIRED",
    "WAITING_EXTERNAL",
    "INFORMATIONAL",
  ] as const;
  return (
    <>
      <p className="text-sm my-2">
        冲突允许保存。已判定含通过、冲突与提醒；部分资料可用时，只检查已具备输入的范围。
      </p>
      <div className="space-y-2">
        {[...conflicts, ...warnings].map((r) => (
          <article
            key={r.id}
            data-rule={r.rule}
            data-reason={r.reasonCode}
            className={
              r.state === "CONFLICT"
                ? "rounded border border-red-400 p-2 text-red-700"
                : "rounded border p-2 text-amber-700"
            }
          >
            {r.state === "CONFLICT" ? "冲突" : "天气提醒"} ·{" "}
            {describeConstraint(r, trip)}
            <button
              className="ml-2 underline"
              onClick={() => onOpen?.(r.activityIds[0]!)}
            >
              定位事件
            </button>
          </article>
        ))}
      </div>
      {groups.map((category) => {
        const roots = data.roots.filter(
          (r) =>
            r.category === category &&
            !r.resultIds.some(
              (id) =>
                conflicts.some((c) => c.id === id) ||
                warnings.some((c) => c.id === id),
            ),
        );
        const byReason = new Map<string, typeof roots>();
        for (const r of roots) {
          const dependencyType = r.dependency.split(":")[0]!;
          const key =
            r.reason +
            ":" +
            r.action +
            ":" +
            ([
              "hours",
              "route",
              "weather",
              "region",
              "applicability",
              "weather-date",
            ].includes(dependencyType)
              ? dependencyType
              : "");
          byReason.set(key, [...(byReason.get(key) ?? []), r]);
        }
        return (
          <details
            key={category}
            className="my-2 rounded border p-2"
            open={false}
          >
            <summary>
              {category === "ACTION_REQUIRED"
                ? "待补信息"
                : category === "WAITING_EXTERNAL"
                  ? "外部等待"
                  : "不适用、待安排与资料限制"}{" "}
              · {new Set(roots.flatMap((r) => r.activityIds)).size}个活动
            </summary>
            {[...byReason].map(([key, rs]) => (
              <details key={key} className="my-2 text-sm">
                <summary>
                  {(
                    {
                      hours: "营业资料",
                      route: "路线资料",
                      weather: "天气资料",
                      region: "地点区域资料",
                      applicability: "日期适用性",
                      "weather-date": "预报日期",
                    } as Record<string, string>
                  )[rs[0]!.dependency.split(":")[0]!] ?? ""}{" "}
                  {reasonLabel(rs[0]!.reason)} ·{" "}
                  {new Set(rs.flatMap((r) => r.activityIds)).size}个活动
                </summary>
                <p>{actions[rs[0]!.action]}</p>
                {[...new Set(rs.flatMap((r) => r.activityIds))].map((id) => (
                  <button
                    key={id}
                    className="mr-3 underline"
                    onClick={() => onOpen?.(id)}
                  >
                    {data.activities.find((a) => a.id === id)?.title ?? id}
                  </button>
                ))}
              </details>
            ))}
          </details>
        );
      })}
      <p className="text-sm text-muted-foreground">
        检查范围：
        {data.capabilities
          .map(
            (c) =>
              ruleName[c.rule] +
              " 已判定" +
              c.evaluated +
              "/" +
              c.objects +
              "，待资料" +
              c.needsData,
          )
          .join("；")}
      </p>
    </>
  );
}
export const ruleName: Record<ConstraintResult["rule"], string> = {
  OVERLAP: "重叠",
  TRANSITION_GAP: "路程",
  OPENING_COVERAGE: "营业",
  WEATHER_EXPOSURE: "天气",
};
export function IntelligencePanel({
  trip,
  onSnapshot,
  onReadError,
  onOpen,
}: {
  trip: TravelTrip;
  onSnapshot?: (value: IntelligenceSnapshot | null) => void;
  onReadError?: (error: string) => void;
  onOpen?: (id: string) => void;
}) {
  const [data, setData] = useState<IntelligenceSnapshot | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      generation = 0;
    setData(null);
    setError("");
    onReadError?.("");
    async function load() {
      const request = ++generation;
      try {
        const value = await travelApi<IntelligenceSnapshot>(
          "/trips/" + trip.id + "/intelligence-snapshot",
        );
        if (
          alive &&
          request === generation &&
          value.evaluation.tripRevision === trip.revision &&
          Date.parse(value.expiresAt) > Date.now()
        ) {
          setData((previous) =>
            previous &&
            previous.evaluation.factsVersion > value.evaluation.factsVersion
              ? previous
              : value,
          );
          setError("");
          onReadError?.("");
        }
      } catch (e) {
        if (alive && request === generation) {
          setData(null);
          const message = e instanceof Error ? e.message : "读取失败";
          setError(message);
          onReadError?.(message);
        }
      }
    }
    void load();
    const tick = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    window.addEventListener("travel-facts-updated", load);
    return () => {
      alive = false;
      clearInterval(tick);
      window.removeEventListener("travel-facts-updated", load);
    };
  }, [trip.id, trip.revision, onReadError]);
  useEffect(() => {
    onSnapshot?.(data);
    if (!data) return;
    const timer = setTimeout(
      () => {
        setData(null);
        window.dispatchEvent(new Event("travel-facts-updated"));
      },
      Math.max(0, Date.parse(data.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [data, onSnapshot]);
  return (
    <section className="rounded-xl border p-3 travel-intelligence">
      <h2 className="font-medium">
        计划状态 ·{" "}
        {data
          ? data.evaluation.counts.CONFLICT +
            "处冲突 · " +
            data.evaluation.counts.WARNING +
            "项提醒"
          : "正在检查"}
      </h2>
      {error && (
        <p role="alert">
          检查读取失败：{error}{" "}
          <button
            className="underline"
            onClick={() =>
              window.dispatchEvent(new Event("travel-facts-updated"))
            }
          >
            重试读取（不查询供应商）
          </button>
        </p>
      )}
      {data && (
        <>
          <SnapshotStatus data={data} trip={trip} onOpen={onOpen} />
          <details className="mt-3">
            <summary className="cursor-pointer">查看检查详情</summary>
            <IntelligenceInspector data={data} />
          </details>
        </>
      )}
    </section>
  );
}
