import { weatherLocation } from "./travel-weather-location";
import { z } from "zod";
import type {
  TravelTrip,
  FactView,
  IntelligenceRoot,
  IntelligenceDay,
} from "@open-sunsama/types";
import { forecastWindow } from "./travel-weather";
import { factProblem } from "./travel-intelligence";
export const intelligenceDaySchema = z
  .object({
    date: z.iso.date(),
    weatherQuery: z
      .object({
        message: z.string(),
        canQuery: z.boolean(),
        locateActivityIds: z.array(z.string()),
      })
      .strict()
      .optional(),
    informationGaps: z
      .array(
        z
          .object({
            kind: z.enum(["place", "weather", "hours", "route", "environment"]),
            activityIds: z.array(z.string()),
            action: z.enum(["QUERY", "LOCATE", "ENVIRONMENT", "VIEW"]),
          })
          .strict(),
      )
      .optional(),
    weatherRangeNote: z.string().nullable(),
    activityIds: z.array(z.string()),
    cities: z.array(z.string()),
    unlocatedCount: z.number().int().nonnegative(),
    regionUnresolvedCount: z.number().int().nonnegative(),
    noticeRootIds: z.array(z.string()),
    regions: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          status: z.enum([
            "AVAILABLE",
            "NOT_QUERIED",
            "OUT_OF_RANGE",
            "STALE",
            "FAILED",
            "NOT_PROVIDED",
            "MISMATCH",
          ]),
          reason: z.string(),
          dayCondition: z.string().nullable(),
          nightCondition: z.string().nullable(),
          highTemperature: z.number().nullable(),
          lowTemperature: z.number().nullable(),
          forecastKind: z.enum(["daily_forecast", "outlook"]).optional(),
          trend: z
            .object({
              temperature: z
                .object({
                  p10: z.number(),
                  median: z.number(),
                  p90: z.number(),
                })
                .strict(),
              precipitation: z
                .object({
                  p10: z.number(),
                  median: z.number(),
                  p90: z.number(),
                })
                .strict(),
              members: z.number().int().positive(),
              resolutionKm: z.number().positive(),
            })
            .strict()
            .optional(),
          factRefs: z.array(
            z.object({ id: z.string(), version: z.number().int() }),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export function dayPresentation(
  trip: TravelTrip,
  facts: FactView[],
  roots: IntelligenceRoot[],
  now: Date,
  filter: { date?: string; activityId?: string } = {},
): IntelligenceDay[] {
  const window = forecastWindow(now, trip.timezone, 46),
    short = forecastWindow(now, trip.timezone, 16);
  const selected = filter.activityId
    ? trip.activities.find((a) => a.id === filter.activityId)?.date
    : filter.date;
  if (filter.activityId && !selected) return [];
  const dates: string[] = [];
  for (
    let d = trip.startDate;
    d <= trip.endDate;
    d = new Date(Date.parse(d + "T00:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10)
  )
    dates.push(d);
  // Old in-memory fixtures remain readable; live old-source facts are explicitly retired by the service.
  const legacy = facts.some(
    (f) =>
      f.value?.kind === "weather" &&
      f.value.providerId !== "open-meteo" &&
      f.unknownReason !== "WEATHER_SOURCE_RETIRED",
  );
  return dates
    .filter((d) => !selected || d === selected)
    .map((date) => {
      const activities = trip.activities.filter((a) => a.date === date),
        ids = activities.map((a) => a.id),
        cities = new Set<string>(),
        points = new Map<string, string>();
      let unlocatedCount = 0,
        regionUnresolvedCount = 0;
      for (const a of activities) {
        const e = trip.entities?.find((e) => e.id === a.entityId);
        if (!e) {
          unlocatedCount++;
          continue;
        }
        if (e.city && !/^\d+$/.test(e.city)) cities.add(e.city);
        if (legacy) {
          const p = facts.find(
            (f) => f.kind === "place" && f.subjectKey === e.id,
          );
          if (
            factProblem(p, +now) !== null ||
            p?.value?.kind !== "place" ||
            !p.value.regionCode
          ) {
            regionUnresolvedCount++;
            continue;
          }
          points.set(p.value.regionCode, e.city || "已确认地点区域");
        } else {
          const point = weatherLocation(e);
          points.set(point.key, point.name);
        }
      }
      const kind: "outlook" | "daily_forecast" =
        date > short.end ? "outlook" : "daily_forecast";
      const regions = [...points].map(([id, label]) => {
        const f = facts.find(
            (f) =>
              f.kind === "weather" &&
              f.subjectKey === id + ":" + kind &&
              f.unknownReason !== "WEATHER_SOURCE_RETIRED",
          ),
          v = f?.value?.kind === "weather" ? f.value : null,
          day = v?.days.find((d) => d.date === date);
        let status: IntelligenceDay["regions"][number]["status"] = "AVAILABLE",
          reason =
            kind === "outlook"
              ? "远期集合趋势，不确定且不能用于活动时段判断"
              : "对应日期的日级预报";
        if (date < window.start || date > window.end) {
          status = "OUT_OF_RANGE";
          reason =
            date > window.end
              ? "超出46天数据范围，无需反复刷新"
              : "历史天气不由当前预测证明";
        } else if (!f) {
          status = "NOT_QUERIED";
          reason = kind === "outlook" ? "远期趋势尚未查询" : "天气尚未查询";
        } else if (f.status === "failed") {
          status = "FAILED";
          reason = f.error?.retryable
            ? "查询失败，可在冷却结束后重试"
            : "数据源权限不可用，请查看来源";
        } else if (factProblem(f, +now) === "FACT_INPUT_MISMATCH") {
          status = "MISMATCH";
          reason = "资料与当前查询日期或地点不匹配，需更新";
        } else if (f.status === "missing" || !v) {
          status = "NOT_PROVIDED";
          reason = "数据源未提供这项资料";
        } else if (factProblem(f, +now) === "FACT_STALE") {
          status = "STALE";
          reason = "资料已过期，需显式更新";
        } else if (v.regionCode !== id || f.appliesTo.regionRef !== id) {
          status = "MISMATCH";
          reason = "资料位置不匹配";
        } else if (!day || !f.appliesTo.dates.includes(date)) {
          status = "NOT_PROVIDED";
          reason = "数据源实际返回日期没有覆盖这一天";
        } else if (f.quality !== "complete") {
          status = "NOT_PROVIDED";
          reason = "资料字段不完整";
        }
        return {
          id,
          name:
            v?.regionName && !/^\d+$/.test(v.regionName) ? v.regionName : label,
          status,
          reason,
          forecastKind: kind,
          dayCondition:
            status === "AVAILABLE" ? (day?.dayCondition ?? null) : null,
          nightCondition:
            status === "AVAILABLE" ? (day?.nightCondition ?? null) : null,
          highTemperature:
            status === "AVAILABLE" ? (day?.highTemperature ?? null) : null,
          lowTemperature:
            status === "AVAILABLE" ? (day?.lowTemperature ?? null) : null,
          factRefs: f ? [{ id: f.id, version: f.version }] : [],
          ...(status === "AVAILABLE" &&
          kind === "outlook" &&
          day?.temperatureDistribution &&
          day.precipitationDistribution
            ? {
                trend: {
                  temperature: day.temperatureDistribution,
                  precipitation: day.precipitationDistribution,
                  members: v?.memberCount ?? 0,
                  resolutionKm: v?.spatialResolutionKm ?? 36,
                },
              }
            : {}),
        };
      });
      const locateActivityIds = activities
          .filter((a) => !a.entityId)
          .map((a) => a.id),
        within = date >= window.start && date <= window.end,
        ready = regions.some((r) => r.status === "AVAILABLE");
      const canQuery =
        within &&
        regions.some((r) => {
          const f = facts.find((f) =>
            r.factRefs.some((ref) => ref.id === f.id),
          );
          return (
            !(f?.retryAfter && Date.parse(f.retryAfter) > +now) &&
            !(f?.status === "failed" && !f.error?.retryable) &&
            f?.status !== "missing"
          );
        });
      const queryMessage = !activities.length
        ? "尚无地点安排"
        : !within
          ? date > window.end
            ? "超出46天数据范围，无需反复刷新"
            : "历史天气不由当前预测证明"
          : ready
            ? regions.some((r) => r.status !== "AVAILABLE")
              ? "部分地点资料可用，其余见具体原因"
              : kind === "outlook"
                ? "已取得远期趋势（不确定）"
                : "已取得日级预报"
            : regions.length
              ? regions
                  .map((r) => {
                    const f = facts.find((f) =>
                      r.factRefs.some((ref) => ref.id === f.id),
                    );
                    return f?.error?.retryable &&
                      f.retryAfter &&
                      Date.parse(f.retryAfter) > +now
                      ? "查询失败正在冷却，请稍后再试"
                      : r.reason;
                  })
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join("；")
              : "先为活动绑定真实地点，再获取天气";
      const gaps = new Map<
        string,
        {
          kind: "place" | "weather" | "hours" | "route" | "environment";
          activityIds: string[];
          action: "QUERY" | "LOCATE" | "ENVIRONMENT" | "VIEW";
        }
      >();
      for (const root of roots.filter(
        (r) =>
          r.activityIds.some((id) => ids.includes(id)) &&
          r.action !== "EDIT_PLAN" &&
          r.action !== "NONE",
      )) {
        const type =
            root.action === "BIND_PLACE"
              ? "place"
              : root.action === "SET_ENVIRONMENT"
                ? "environment"
                : root.dependency.startsWith("hours:")
                  ? "hours"
                  : root.dependency.startsWith("route:")
                    ? "route"
                    : "weather",
          action =
            root.action === "BIND_PLACE"
              ? "LOCATE"
              : root.action === "SET_ENVIRONMENT"
                ? "ENVIRONMENT"
                : root.action === "QUERY_FACTS" ||
                    root.action === "REFRESH_FACTS"
                  ? "QUERY"
                  : "VIEW";
        const entry = gaps.get(type) ?? { kind: type, action, activityIds: [] };
        entry.activityIds = [
          ...new Set([
            ...entry.activityIds,
            ...root.activityIds.filter((id) => ids.includes(id)),
          ]),
        ];
        gaps.set(type, entry);
      }
      return {
        date,
        weatherRangeNote: within ? null : queryMessage,
        activityIds: ids,
        cities: [...cities],
        unlocatedCount,
        regionUnresolvedCount,
        noticeRootIds: roots
          .filter((r) => r.activityIds.some((id) => ids.includes(id)))
          .map((r) => r.id),
        regions,
        weatherQuery: { message: queryMessage, canQuery, locateActivityIds },
        informationGaps: [...gaps.values()],
      };
    });
}
