import { describe, it, expect } from "vitest";
import { weatherResult } from "./travel-weather";
import { evaluationSchema } from "./travel-kernel-contract";
import { evaluate } from "./travel-intelligence";
import type { TravelActivity, FactView, TravelTrip } from "@open-sunsama/types";
const now = new Date("2026-10-08T01:00:00Z"),
  a: TravelActivity = {
    id: "a",
    date: "2026-10-08",
    start: 600,
    duration: 60,
    title: "公园",
    place: "公园",
    notes: "",
    position: 0,
    locked: false,
    entityId: "e",
  };
const f = (
  kind: FactView["kind"],
  subjectKey: string,
  value: FactView["value"],
): FactView => ({
  id: kind,
  version: 1,
  kind,
  subjectKey,
  inputFingerprint: "f",
  sourceRefId: null,
  collectionId: null,
  status: "available",
  retrievedAt: now.toISOString(),
  sourcePublishedAt: now.toISOString(),
  expiresAt: "2026-10-08T03:00:00Z",
  retryAfter: null,
  appliesTo: {
    dates: ["2026-10-08"],
    regionRef: kind === "weather" ? "140213" : null,
    basis: "provider_dates",
  },
  quality: "complete",
  value,
  error: null,
  freshness: "fresh",
  unknownReason: null,
});
const place = f("place", "e", {
  kind: "place",
  name: "公园",
  address: "",
  regionCode: "140213",
  category: "attraction",
  coordinates: { longitude: 113, latitude: 40, coordinateSystem: "GCJ-02" },
});
const forecast = f("weather", "140213:daily_forecast", {
  kind: "weather",
  regionCode: "140213",
  regionName: "平城区",
  dataKind: "daily_forecast",
  observation: null,
  days: [
    {
      date: "2026-10-08",
      dayCondition: "晴",
      nightCondition: "晴",
      highTemperature: 20,
      lowTemperature: 10,
    },
  ],
});
const run = (
  weather = forecast,
  activity = a,
  environment: "outdoor" | "indoor" | "unspecified" = "outdoor",
  p = place,
) => weatherResult(activity, environment, [p, weather], now, "Asia/Shanghai");
describe("天气规则", () => {
  for (const c of ["大雨", "暴雨", "大暴雨", "特大暴雨", "大雨-暴雨"]) {
    it(c + "日级户外提醒", () => {
      const w = structuredClone(forecast);
      if (w.value?.kind === "weather") w.value.days[0]!.dayCondition = c;
      const r = run(w);
      expect(r.state).toBe("WARNING");
      expect(r.reasonCode).toBe("OUTDOOR_HEAVY_RAIN");
      expect(r.factRefs).toHaveLength(2);
    });
  }
  for (const c of ["晴", "小雨", "中雨", "中雨-大雨", "雷阵雨"]) {
    it(c + "不擅自推断强降雨", () => {
      const w = structuredClone(forecast);
      if (w.value?.kind === "weather") w.value.days[0]!.dayCondition = c;
      expect(run(w).state).toBe("VALID");
    });
  }
  it("无法归一化的描述保持未知", () => {
    const w = structuredClone(forecast);
    if (w.value?.kind === "weather") w.value.days[0]!.dayCondition = "可能有雨";
    expect(run(w).reasonCode).toBe("WEATHER_CONDITION_UNKNOWN");
  });
  it("室内规则不适用", () =>
    expect(run(forecast, a, "indoor").state).toBe("VALID"));
  it("未指定不猜测", () =>
    expect(run(forecast, a, "unspecified").reasonCode).toBe(
      "ENVIRONMENT_UNSPECIFIED",
    ));
  it("未定位", () =>
    expect(run(forecast, { ...a, entityId: null }).reasonCode).toBe(
      "PLACE_UNCONFIRMED",
    ));
  it("未安排", () =>
    expect(run(forecast, { ...a, start: null }).reasonCode).toBe(
      "ACTIVITY_UNSCHEDULED",
    ));
  for (const date of ["2026-10-01", "2026-10-13"]) {
    it(date + "范围外", () =>
      expect(run(forecast, { ...a, date }).reasonCode).toBe(
        "WEATHER_OUT_OF_RANGE",
      ),
    );
  }
  it("供应商实际缺某日", () => {
    const w = structuredClone(forecast);
    w.appliesTo.dates = [];
    expect(run(w).reasonCode).toBe("WEATHER_OUT_OF_RANGE");
  });
  it("过期", () =>
    expect(run({ ...forecast, freshness: "stale" }).reasonCode).toBe(
      "FACT_STALE",
    ));
  it("失败", () =>
    expect(
      run({
        ...forecast,
        status: "failed",
        value: null,
        error: { code: "RATE_LIMIT", retryable: true },
      }).reasonCode,
    ).toBe("FACT_PROVIDER_FAILED"));
  it("区域不能用市级猜区级", () => {
    const w = structuredClone(forecast);
    if (w.value?.kind === "weather") w.value.regionCode = "140200";
    expect(run(w).reasonCode).toBe("WEATHER_REGION_UNRESOLVED");
  });
  it("区域缺失", () => {
    const p = structuredClone(place);
    if (p.value?.kind === "place") p.value.regionCode = null;
    expect(run(forecast, a, "outdoor", p).reasonCode).toBe(
      "WEATHER_REGION_UNRESOLVED",
    );
  });
  it("地点变化需确认", () =>
    expect(
      run(forecast, a, "outdoor", {
        ...place,
        error: {
          code: "PLACE_CHANGED_CONFIRMATION_REQUIRED",
          retryable: false,
        },
      }).reasonCode,
    ).toBe("FACT_INPUT_MISMATCH"));
  it("新规则契约及默认旧属性", () => {
    const t: TravelTrip = {
      id: "t",
      title: "t",
      startDate: a.date!,
      endDate: a.date!,
      timezone: "Asia/Shanghai",
      revision: 1,
      activities: [a],
    };
    const v = evaluate(t, [place, forecast], 1, now);
    expect(evaluationSchema.safeParse(v).success).toBe(true);
    expect(
      v.results.find((r) => r.rule === "WEATHER_EXPOSURE")?.reasonCode,
    ).toBe("ENVIRONMENT_UNSPECIFIED");
  });
});
