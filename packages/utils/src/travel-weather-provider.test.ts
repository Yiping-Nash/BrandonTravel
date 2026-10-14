import { randomUUID } from "node:crypto";
const ids = new Map<string, string>();
const uid = (s: string) => {
  if (!ids.has(s)) ids.set(s, randomUUID());
  return ids.get(s)!;
};
import { describe, it, expect } from "vitest";
import type { TravelTrip, FactView } from "@open-sunsama/types";
import { buildIntelligenceSnapshot } from "./travel-inspection";
import { weatherLocation } from "./travel-weather-location";
const now = new Date("2026-10-10T01:00:00Z");
const entity = (id: string, city: string, lon: number) => ({
  id: uid(id),
  provider: "amap" as const,
  poiId: id,
  name: city + "景点",
  city,
  address: "",
  longitude: lon,
  latitude: 40,
  coordinateSystem: "GCJ-02" as const,
  selectedAt: now.toISOString(),
});
const trip: TravelTrip = {
  id: uid("trip"),
  title: "日期边界",
  revision: 1,
  startDate: "2026-10-10",
  endDate: "2026-11-25",
  timezone: "Asia/Shanghai",
  entities: [entity("a", "大同", 113), entity("b", "广州", 114)],
  activities: [],
};
const fixture = (
  id: string,
  kind: "daily_forecast" | "outlook",
  dates: string[],
): FactView => {
  const p = weatherLocation(trip.entities!.find((e) => e.id === uid(id))!);
  return {
    id: uid("fact-" + id + kind),
    version: 1,
    kind: "weather",
    subjectKey: p.key + ":" + kind,
    sourceRefId: null,
    collectionId: null,
    inputFingerprint: "mock",
    status: "available",
    quality: "complete",
    retrievedAt: now.toISOString(),
    sourcePublishedAt: null,
    expiresAt: "2026-10-10T13:00:00Z",
    retryAfter: null,
    error: null,
    freshness: "fresh",
    unknownReason: null,
    appliesTo: { dates, regionRef: p.key, basis: "provider_dates" },
    value: {
      kind: "weather",
      providerId: "open-meteo",
      dataKind: kind,
      regionCode: p.key,
      regionName: p.name,
      memberCount: 51,
      spatialResolutionKm: 36,
      days: dates.map((date, i) => ({
        date,
        dayCondition: kind === "outlook" ? null : i ? "晴" : "大雨",
        nightCondition: null,
        highTemperature: kind === "outlook" ? null : 20 + i,
        lowTemperature: kind === "outlook" ? null : 10,
        temperatureDistribution: { p10: 5, median: 10, p90: 15 },
        precipitationDistribution: { p10: 0, median: 1, p90: 3 },
      })),
      observation: null,
    },
  };
};
const activity = (id: string, date: string, e = "a") => ({
  id: uid(id),
  title: id,
  date,
  start: 600,
  duration: 60,
  entityId: uid(e),
  locked: false,
  position: 0,
  place: "",
  notes: "",
});
const build = (
  activities: TravelTrip["activities"],
  facts: FactView[],
  env: Record<string, "indoor" | "outdoor" | "unspecified"> = {},
) =>
  buildIntelligenceSnapshot(
    { ...trip, activities },
    facts,
    [],
    facts.length,
    Object.fromEntries(Object.entries(env).map(([k, v]) => [uid(k), v])),
    now,
  );
describe("Sprint18日期与来源边界", () => {
  it("16日/17日/46日/47日分开，实际缺日期不伪造", () => {
    const dates = ["2026-10-25", "2026-10-26", "2026-11-24", "2026-11-25"];
    const s = build(
      dates.map((d, i) => activity("event" + i, d)),
      [
        fixture("a", "daily_forecast", [dates[0]!]),
        fixture("a", "outlook", [dates[1]!]),
      ],
    );
    const days = dates.map((date) => s.days!.find((d) => d.date === date)!);
    expect(days.map((d) => d.regions[0]!.status)).toEqual([
      "AVAILABLE",
      "AVAILABLE",
      "NOT_PROVIDED",
      "OUT_OF_RANGE",
    ]);
    expect(days.map((d) => d.regions[0]!.forecastKind)).toEqual([
      "daily_forecast",
      "outlook",
      "outlook",
      "outlook",
    ]);
    expect(days[3]!.weatherQuery!.canQuery).toBe(false);
  });
  it("不同日期不是复制首日温度，地点无详情也可工作", () => {
    const ds = ["2026-10-13", "2026-10-14"];
    const s = build(
      ds.map((d, i) => activity("e" + i, d)),
      [fixture("a", "daily_forecast", ds)],
    );
    expect(
      ds.map(
        (date) =>
          s.days!.find((d) => d.date === date)!.regions[0]!.highTemperature,
      ),
    ).toEqual([20, 21]);
  });
  it("同日两城分别匹配，一城缺资料不隐藏另一城", () => {
    const s = build(
      [activity("e1", "2026-10-13"), activity("e2", "2026-10-13", "b")],
      [fixture("a", "daily_forecast", ["2026-10-13"])],
    );
    const d = s.days!.find((d) => d.date === "2026-10-13")!;
    expect(d.cities).toEqual(["大同", "广州"]);
    expect(d.regions.map((r) => r.status)).toEqual([
      "AVAILABLE",
      "NOT_QUERIED",
    ]);
  });
  it("现代日级大雨沿用规则；室内不适用，不依赖地点详情", () => {
    const acts = [activity("e", "2026-10-13")],
      facts = [fixture("a", "daily_forecast", ["2026-10-13"])];
    expect(
      build(acts, facts, { e: "outdoor" }).evaluation.results.find(
        (r) => r.rule === "WEATHER_EXPOSURE",
      )!.state,
    ).toBe("WARNING");
    const s = build(acts, facts, { e: "indoor" });
    expect(
      s.traces.find((t) => t.rule === "WEATHER_EXPOSURE")!.applicability,
    ).toBe("NOT_APPLICABLE");
    expect(
      s.days!.find((d) => d.date === "2026-10-13")!.regions[0]!.status,
    ).toBe("AVAILABLE");
  });
  it("趋势降水分布不参与强降雨规则", () => {
    const s = build(
      [activity("e", "2026-10-26")],
      [fixture("a", "outlook", ["2026-10-26"])],
      { e: "outdoor" },
    );
    expect(
      s.evaluation.results.find((r) => r.rule === "WEATHER_EXPOSURE"),
    ).toMatchObject({ state: "UNKNOWN", reasonCode: "WEATHER_OUT_OF_RANGE" });
    expect(
      s.days!.find((d) => d.date === "2026-10-26")!.regions[0]!.trend,
    ).toBeDefined();
  });
  it("退役高德资料不回退使用", () => {
    const f = fixture("a", "daily_forecast", ["2026-10-13"]);
    f.unknownReason = "WEATHER_SOURCE_RETIRED";
    f.subjectKey = "140200:daily_forecast";
    const s = build([activity("e", "2026-10-13")], [f], { e: "outdoor" });
    expect(
      s.days!.find((d) => d.date === "2026-10-13")!.regions[0]!.status,
    ).toBe("NOT_QUERIED");
    expect(
      s.evaluation.results.find((r) => r.rule === "WEATHER_EXPOSURE")!.state,
    ).toBe("UNKNOWN");
  });
});
