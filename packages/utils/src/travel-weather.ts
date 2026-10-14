import type { TravelEntity } from "@open-sunsama/types";
import { weatherLocation, weatherFactKey } from "./travel-weather-location";
import type {
  ConstraintResult,
  FactView,
  TravelActivity,
  TravelEnvironment,
} from "@open-sunsama/types";
const known = new Set([
  "晴",
  "多云",
  "阴",
  "少云",
  "晴间多云",
  "小雨",
  "中雨",
  "大雨",
  "暴雨",
  "大暴雨",
  "特大暴雨",
  "雷阵雨",
  "阵雨",
  "雷阵雨并伴有冰雹",
  "雨夹雪",
  "小雪",
  "中雪",
  "大雪",
  "暴雪",
  "阵雪",
  "雾",
  "霾",
  "浮尘",
  "扬沙",
  "沙尘暴",
  "强沙尘暴",
  "风",
  "大风",
  "冷",
  "热",
  "小雨-中雨",
  "中雨-大雨",
  "大雨-暴雨",
  "暴雨-大暴雨",
  "大暴雨-特大暴雨",
]);
const heavy = new Set([
  "大雨",
  "暴雨",
  "大暴雨",
  "特大暴雨",
  "大雨-暴雨",
  "暴雨-大暴雨",
  "大暴雨-特大暴雨",
]);
export function localDate(now: Date, timezone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function forecastWindow(now: Date, timezone: string, days = 16) {
  const start = localDate(now, timezone),
    end = new Date(start + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + days - 1);
  return { start, end: end.toISOString().slice(0, 10) };
}
export function weatherResult(
  a: TravelActivity,
  environment: TravelEnvironment,
  facts: FactView[],
  now: Date,
  timezone: string,
  entity?: TravelEntity,
): ConstraintResult {
  const place = facts.find(
    (f) => f.kind === "place" && f.subjectKey === a.entityId,
  );
  const point = entity ? weatherLocation(entity) : undefined;
  const modern = point
    ? facts.find(
        (f) =>
          f.kind === "weather" &&
          f.subjectKey === weatherFactKey(entity!, "daily_forecast"),
      )
    : undefined;
  const legacyRegion =
    place?.value?.kind === "place" ? place.value.regionCode : null;
  const legacy =
    place?.value?.kind === "place"
      ? facts.find(
          (f) =>
            f.kind === "weather" &&
            f.subjectKey === legacyRegion + ":daily_forecast" &&
            f.unknownReason !== "WEATHER_SOURCE_RETIRED",
        )
      : undefined;
  const useModern = !!point && (!!modern || !legacy);
  const region = useModern
    ? point!.key
    : place?.value?.kind === "place"
      ? place.value.regionCode
      : null;
  const r: ConstraintResult = {
    id: "WEATHER_EXPOSURE:" + a.id,
    rule: "WEATHER_EXPOSURE",
    state: "VALID",
    severity: "info",
    activityIds: [a.id],
    entityIds: a.entityId ? [a.entityId] : [],
    transitionId: null,
    reasonCode: "OK",
    factRefs: [],
    details: {
      date: a.date,
      environment,
      regionCode: region,
      regionName: null,
      dayCondition: null,
      nightCondition: null,
      scope: "daily_forecast",
    },
  };
  const unknown = (reason: typeof r.reasonCode) => {
    r.state = "UNKNOWN";
    r.reasonCode = reason;
    return r;
  };
  if (!a.date || a.start === null) return unknown("ACTIVITY_UNSCHEDULED");
  if (environment === "indoor") return r; // 仅此规则不适用，不表示整份计划通过。
  if (environment === "unspecified") return unknown("ENVIRONMENT_UNSPECIFIED");
  if (!a.entityId) return unknown("PLACE_UNCONFIRMED");
  if (!useModern) {
    if (place) r.factRefs.push({ id: place.id, version: place.version });
    if (
      !place ||
      place.status !== "available" ||
      !region ||
      !/^\d{6}$/.test(region)
    )
      return unknown("WEATHER_REGION_UNRESOLVED");
    if (
      place.unknownReason === "FACT_INPUT_MISMATCH" ||
      place.error?.code === "PLACE_CHANGED_CONFIRMATION_REQUIRED"
    )
      return unknown("FACT_INPUT_MISMATCH");
    if (place.freshness !== "fresh" || Date.parse(place.expiresAt) <= +now)
      return unknown("FACT_STALE");
  }
  const f = useModern ? modern : legacy;
  if (f) r.factRefs.push({ id: f.id, version: f.version });
  const window = forecastWindow(now, timezone);
  if (a.date < window.start || a.date > window.end)
    return unknown("WEATHER_OUT_OF_RANGE");
  if (!f || f.status === "missing" || !f.value)
    return unknown(
      f?.status === "failed" ? "FACT_PROVIDER_FAILED" : "FACT_MISSING",
    );
  if (f.status === "failed") return unknown("FACT_PROVIDER_FAILED");
  if (f.unknownReason === "FACT_INPUT_MISMATCH")
    return unknown("FACT_INPUT_MISMATCH");
  if (f.freshness === "stale" || Date.parse(f.expiresAt) <= +now)
    return unknown("FACT_STALE");
  if (
    f.value.kind !== "weather" ||
    f.value.dataKind !== "daily_forecast" ||
    f.value.regionCode !== region ||
    f.appliesTo.regionRef !== region
  )
    return unknown("WEATHER_REGION_UNRESOLVED");
  const day = f.value.days.find((d) => d.date === a.date);
  if (!day || !f.appliesTo.dates.includes(a.date))
    return unknown("WEATHER_OUT_OF_RANGE");
  r.details.regionName = f.value.regionName;
  r.details.dayCondition = day.dayCondition;
  r.details.nightCondition = day.nightCondition;
  if (f.quality !== "complete") return unknown("FACT_PARSE_INCOMPLETE");
  if ([day.dayCondition, day.nightCondition].some((c) => !!c && heavy.has(c))) {
    r.state = "WARNING";
    r.severity = "warning";
    r.reasonCode = "OUTDOOR_HEAVY_RAIN";
    return r;
  }
  if (
    !day.dayCondition ||
    (!useModern && !day.nightCondition) ||
    !known.has(day.dayCondition) ||
    (!useModern && !known.has(day.nightCondition!))
  )
    return unknown("WEATHER_CONDITION_UNKNOWN");
  return r;
}
