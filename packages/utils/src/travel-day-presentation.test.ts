import { describe, it, expect } from "vitest";
import type {
  TravelTrip,
  FactView,
  FactKind,
  FactValue,
} from "@open-sunsama/types";
import { weatherLocation } from "./travel-weather-location";
import { buildIntelligenceSnapshot } from "./travel-inspection";
const now = new Date("2026-10-10T01:00:00Z"),
  e = "00000000-0000-4000-8000-000000000010",
  a = "00000000-0000-4000-8000-000000000011",
  b = "00000000-0000-4000-8000-000000000012";
const trip: TravelTrip = {
  id: e,
  title: "日级投影",
  startDate: "2026-10-10",
  endDate: "2026-11-26",
  timezone: "Asia/Shanghai",
  revision: 3,
  entities: [
    {
      id: e,
      provider: "amap",
      poiId: "mock",
      name: "模拟",
      address: "模拟广州",
      city: "广州",
      longitude: 113,
      latitude: 23,
      coordinateSystem: "GCJ-02",
      selectedAt: now.toISOString(),
    },
  ],
  activities: [
    {
      id: a,
      title: "已定位",
      date: "2026-10-10",
      start: 600,
      duration: 60,
      locked: false,
      position: 0,
      place: "模拟",
      notes: "",
      entityId: e,
    },
    {
      id: b,
      title: "未定位",
      date: "2026-10-10",
      start: 720,
      duration: 60,
      locked: false,
      position: 1,
      place: "待确认",
      notes: "",
    },
  ],
};
const fact = (kind: FactKind, value: FactValue, subjectKey = e): FactView => ({
  id: kind === "place" ? a : b,
  version: 2,
  kind,
  value,
  subjectKey,
  status: "available",
  quality: "complete",
  inputFingerprint: "mock",
  sourceRefId: null,
  collectionId: null,
  retrievedAt: now.toISOString(),
  sourcePublishedAt: now.toISOString(),
  expiresAt: "2026-10-10T02:00:00Z",
  retryAfter: null,
  appliesTo: {
    dates: ["2026-10-10"],
    regionRef:
      kind === "weather" ? weatherLocation(trip.entities![0]!).key : null,
    basis: "provider_dates",
  },
  error: null,
  freshness: "fresh",
  unknownReason: null,
});
const place = () =>
  fact("place", {
    kind: "place",
    name: "模拟广州",
    address: "",
    regionCode: "440104",
    category: "attraction",
    coordinates: { longitude: 113, latitude: 23, coordinateSystem: "GCJ-02" },
  });
const weather = () =>
  fact(
    "weather",
    {
      kind: "weather",
      providerId: "open-meteo",
      regionCode: weatherLocation(trip.entities![0]!).key,
      regionName: "越秀区",
      dataKind: "daily_forecast",
      days: [
        {
          date: "2026-10-10",
          dayCondition: "晴",
          nightCondition: "多云",
          highTemperature: 28,
          lowTemperature: 20,
        },
      ],
      observation: null,
    },
    weatherLocation(trip.entities![0]!).key + ":daily_forecast",
  );
const build = (facts: FactView[], t = trip) =>
  buildIntelligenceSnapshot(t, facts, [], 2, { [a]: "outdoor" }, now);
describe("Sprint16日级产品投影", () => {
  it("部分地点缺失不隐藏可用天气，不显示行政编码作名字", () => {
    const s = build([place(), weather()]),
      d = s.days![0]!;
    expect(d.unlocatedCount).toBe(1);
    expect(d.cities).toEqual(["广州"]);
    expect(d.regions[0]).toMatchObject({
      status: "AVAILABLE",
      name: "越秀区",
      dayCondition: "晴",
    });
  });
  it("未查询、过期、失败、未提供和不匹配分别标记", () => {
    expect(build([place()]).days![0]!.regions[0]!.status).toBe("NOT_QUERIED");
    expect(
      build([place(), { ...weather(), freshness: "stale" }]).days![0]!
        .regions[0]!.status,
    ).toBe("STALE");
    expect(
      build([
        place(),
        {
          ...weather(),
          status: "failed",
          error: { code: "TIMEOUT", retryable: true },
        },
      ]).days![0]!.regions[0]!.status,
    ).toBe("FAILED");
    expect(
      build([place(), { ...weather(), status: "missing", value: null }])
        .days![0]!.regions[0]!.status,
    ).toBe("NOT_PROVIDED");
    expect(
      build([place(), { ...weather(), unknownReason: "FACT_INPUT_MISMATCH" }])
        .days![0]!.regions[0]!.status,
    ).toBe("MISMATCH");
  });
  it("未来日期范围说明与缺地点独立，明确无需反复刷新", () => {
    const s = build([], {
      ...trip,
      activities: trip.activities.map((a) => ({ ...a, date: "2026-11-26" })),
    });
    expect(
      s.days!.find((d) => d.date === "2026-11-26")?.weatherRangeNote,
    ).toMatch(/无需反复刷新/);
  });
  it("供应商缺某日不冒充过期或等待保证", () => {
    const f = weather();
    if (f.value?.kind === "weather") f.value.days = [];
    expect(build([place(), f]).days![0]!.regions[0]!.status).toBe(
      "NOT_PROVIDED",
    );
  });
  it("旧地点详情过期不阻断坐标天气，保留已确认城市", () => {
    const d = build([{ ...place(), freshness: "stale" }, weather()]).days![0]!;
    expect(d.regionUnresolvedCount).toBe(0);
    expect(d.regions[0]!.status).toBe("AVAILABLE");
    expect(d.cities).toEqual(["广州"]);
  });
  it("日期与活动过滤保持原评估版本和前后连接", () => {
    const s = build([place(), weather()]),
      f = buildIntelligenceSnapshot(
        trip,
        [place(), weather()],
        [],
        2,
        { [a]: "outdoor" },
        now,
        { activityId: a },
      );
    expect(f.days![0]!.regions).toEqual(s.days![0]!.regions);
    expect(f.connections).toHaveLength(1);
    expect(f.evaluation.factsVersion).toBe(2);
  });
  it("连接缺资料不填零耗时，与规则结论一致", () => {
    const s = build([]);
    expect(s.connections![0]).toMatchObject({
      state: "UNKNOWN",
      durationSeconds: null,
      shortageMinutes: null,
      reasonCode: "PLACE_UNCONFIRMED",
    });
  });
});

describe("Sprint17首次查询与可操作缺口", () => {
  it("零Facts已绑定坐标可直接查天气，不需高德详情", () => {
    const d = build([]).days![0]!;
    expect(d.weatherQuery).toMatchObject({
      canQuery: true,
      locateActivityIds: [b],
    });
    expect(d.weatherQuery!.message).toContain("尚未查询");
    expect(d.informationGaps!.filter((g) => g.kind === "weather")).toHaveLength(
      1,
    );
  });
  it("未定位和空日期不显示无意义的0区域或查询按钮", () => {
    const t = {
      ...trip,
      activities: trip.activities.map((a) => ({ ...a, entityId: undefined })),
    };
    const s = build([], t);
    expect(s.days![0]!.weatherQuery!.canQuery).toBe(false);
    expect(s.days![1]!.weatherQuery).toMatchObject({
      message: "尚无地点安排",
      canQuery: false,
    });
  });
  it("预报范围外不鼓励刷新", () => {
    expect(build([]).days!.at(-1)!.weatherQuery!.canQuery).toBe(false);
  });
  it("权限失败和未提供区域有来源说明且不能承诺可取得", () => {
    const f = {
      ...weather(),
      status: "failed" as const,
      error: { code: "PROVIDER_PERMISSION", retryable: false },
      retryAfter: "2026-10-11T01:00:00Z",
      value: null,
    };
    expect(build([f]).days![0]!.weatherQuery!.canQuery).toBe(false);
    expect(build([f]).days![0]!.weatherQuery!.message).toContain("权限");
    const missing = { ...weather(), status: "missing" as const, value: null };
    expect(build([missing]).days![0]!.weatherQuery!.message).toContain(
      "未提供",
    );
  });
  it("冷却期间不显示重复查询入口，冷却结束可重试", () => {
    const f = {
      ...weather(),
      status: "failed" as const,
      error: { code: "TIMEOUT", retryable: true },
      retryAfter: "2026-10-10T01:05:00Z",
    };
    expect(build([f]).days![0]!.weatherQuery).toMatchObject({
      canQuery: false,
    });
    expect(build([f]).days![0]!.weatherQuery!.message).toContain("冷却");
    f.retryAfter = "2026-10-10T00:59:00Z";
    expect(build([f]).days![0]!.weatherQuery!.canQuery).toBe(true);
  });
  it("查看预报不需要指定户外，部分资料与过期仍可解释", () => {
    const s = buildIntelligenceSnapshot(
      trip,
      [place(), weather()],
      [],
      2,
      {},
      now,
    );
    expect(s.days![0]!.regions[0]!.status).toBe("AVAILABLE");
    expect(
      s.days![0]!.informationGaps!.filter((g) => g.kind === "environment"),
    ).toHaveLength(1);
    expect(
      build([place(), { ...weather(), freshness: "stale" }]).days![0]!
        .weatherQuery!.canQuery,
    ).toBe(true);
  });
});
