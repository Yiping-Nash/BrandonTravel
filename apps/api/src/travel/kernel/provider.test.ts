import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AmapModule from "../amap.js";
vi.mock("../amap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof AmapModule>();
  return { ...actual, amapRequest: vi.fn() };
});
vi.mock("./open-meteo.js", () => ({ queryOpenMeteo: vi.fn() }));
import { queryOpenMeteo } from "./open-meteo.js";
import { amapRequest } from "../amap.js";
import { collect, ttl, type FactTask } from "./provider.js";
import {
  operationalFactSchema,
  refreshFactsSchema,
} from "@open-sunsama/utils/travel-kernel-contract";
const source = "11111111-1111-4111-8111-111111111111",
  now = new Date("2026-10-07T15:59:00.000Z"),
  entity = {
    id: source,
    provider: "amap" as const,
    poiId: "p",
    name: "景点",
    address: "",
    city: "大同",
    longitude: 113,
    latitude: 40,
    coordinateSystem: "GCJ-02" as const,
    selectedAt: now.toISOString(),
  },
  ctx = { user: "u" },
  task: FactTask = {
    kind: "opening_hours",
    subjectKey: source,
    sourceRefId: source,
    fingerprint: "fingerprint",
    entity,
  };
beforeEach(() => {
  vi.mocked(amapRequest).mockReset();
  vi.mocked(queryOpenMeteo).mockReset();
});
describe("供应商归一化的未知边界", () => {
  it("今日营业原文仅适用查询日并在午夜失效", async () => {
    vi.mocked(amapRequest).mockResolvedValue({
      status: "1",
      pois: [{ id: "p", business: { opentime_today: "09:00-17:00" } }],
    });
    const f = await collect(task, ctx, fetch, now);
    expect(f.appliesTo.dates).toEqual(["2026-10-07"]);
    expect(f.expiresAt).toBe("2026-10-07T16:00:00.000Z");
    expect(f.quality).toBe("partial");
    expect(operationalFactSchema.safeParse(f).success).toBe(true);
  });
  it("缺失营业时间不是全天开放", async () => {
    vi.mocked(amapRequest).mockResolvedValue({
      status: "1",
      pois: [{ id: "p", business: {} }],
    });
    const f = await collect(task, ctx, fetch, now);
    expect(f.status).toBe("missing");
    expect(f.value).toBeNull();
    expect(f.retryAfter).not.toBeNull();
  });
  it("错误POI不能写为已确认地点", async () => {
    vi.mocked(amapRequest).mockResolvedValue({
      status: "1",
      pois: [{ id: "other" }],
    });
    expect((await collect(task, ctx, fetch, now)).error?.code).toBe(
      "SOURCE_ID_MISMATCH",
    );
  });
  it("空路线耗时不能变成零", async () => {
    vi.mocked(amapRequest).mockResolvedValue({
      status: "1",
      route: { paths: [{ distance: "1000", cost: { duration: "" } }] },
    });
    const f = await collect(
      {
        ...task,
        kind: "route_estimate",
        from: entity,
        to: entity,
        mode: "walking",
      },
      ctx,
      fetch,
      now,
    );
    expect(f.status).toBe("failed");
    expect(f.value).toBeNull();
  });
  it("权限失败不可重试且有冷却", async () => {
    vi.mocked(amapRequest).mockImplementation(async () => {
      throw Error("10041");
    });
    const f = await collect(task, ctx, fetch, now);
    expect(f.error).toEqual({ code: "PROVIDER_PERMISSION", retryable: false });
    expect(f.retryAfter).toBe("2026-10-08T15:59:00.000Z");
  });
  it("新天气来源仅保存实际日期、发布时间未知、日级六小时有效", async () => {
    vi.mocked(queryOpenMeteo).mockResolvedValue({
      kind: "weather",
      providerId: "open-meteo",
      regionCode: "point",
      regionName: "附近",
      dataKind: "daily_forecast",
      days: [
        {
          date: "2026-10-07",
          dayCondition: "晴",
          nightCondition: null,
          highTemperature: 20,
          lowTemperature: 10,
        },
      ],
      observation: null,
    });
    const f = await collect(
      {
        ...task,
        kind: "weather",
        weatherKind: "daily_forecast",
        weatherPoint: {
          longitude: 113,
          latitude: 40,
          key: "point",
          name: "附近",
        },
      },
      ctx,
      fetch,
      now,
    );
    expect(f.appliesTo.dates).toEqual(["2026-10-07"]);
    expect(f.sourcePublishedAt).toBeNull();
    expect(f.expiresAt).toBe("2026-10-07T21:59:00.000Z");
    expect(operationalFactSchema.safeParse(f).success).toBe(true);
    expect(amapRequest).not.toHaveBeenCalled();
  });
  it("共享天气与路线期限按批准周期；趋势和其他资料保留", () => {
    expect(ttl("weather", "daily_forecast")).toBe(6 * 3600000);
    expect(ttl("weather", "outlook")).toBe(12 * 3600000);
    expect(ttl("route_estimate")).toBe(20 * 60000);
    expect(ttl("place")).toBe(7 * 86400000);
    expect(ttl("opening_hours")).toBe(86400000);
  });
  it("单次天气结果保留实际多日覆盖与各日不同温度", async () => {
    const days = [
      {
        date: "2026-10-07",
        dayCondition: "晴",
        nightCondition: null,
        lowTemperature: 10,
        highTemperature: 20,
      },
      {
        date: "2026-10-08",
        dayCondition: "雨",
        nightCondition: null,
        lowTemperature: 8,
        highTemperature: 16,
      },
    ];
    vi.mocked(queryOpenMeteo).mockResolvedValue({
      kind: "weather",
      providerId: "open-meteo",
      regionCode: "point",
      regionName: "附近",
      dataKind: "daily_forecast",
      days,
      observation: null,
    });
    const f = await collect(
      {
        ...task,
        kind: "weather",
        weatherKind: "daily_forecast",
        weatherPoint: {
          longitude: 113,
          latitude: 40,
          key: "point",
          name: "附近",
        },
      },
      ctx,
      fetch,
      now,
    );
    expect(queryOpenMeteo).toHaveBeenCalledTimes(1);
    expect(f.appliesTo.dates).toEqual(["2026-10-07", "2026-10-08"]);
    expect(f.value?.kind === "weather" && f.value.days).toEqual(days);
  });
  it("旧行政区天气任务不能回退到高德", async () => {
    const f = await collect(
      {
        ...task,
        kind: "weather",
        regionCode: "140200",
        weatherKind: "observation",
      },
      ctx,
      fetch,
      now,
    );
    expect(f.status).toBe("failed");
    expect(f.error?.code).toBe("WEATHER_POINT_MISSING");
    expect(amapRequest).not.toHaveBeenCalled();
  });
  it("拒绝不存在的日期与伪造actor", () => {
    const input = { requestId: source, kinds: ["weather"] };
    expect(
      refreshFactsSchema.safeParse({ ...input, dates: ["2026-02-30"] }).success,
    ).toBe(false);
    expect(
      refreshFactsSchema.safeParse({ ...input, actor: "user" }).success,
    ).toBe(false);
  });
});

describe("Sprint18天气失败保留未知", () => {
  for (const code of [
    "INVALID_DATES",
    "ENSEMBLE_INCOMPLETE",
    "RATE_LIMIT",
    "PROVIDER_PERMISSION",
  ]) {
    it(code, async () => {
      vi.mocked(queryOpenMeteo).mockRejectedValue(new Error(code));
      const f = await collect(
        {
          ...task,
          kind: "weather",
          weatherKind: "daily_forecast",
          weatherPoint: {
            longitude: 113,
            latitude: 40,
            key: "point",
            name: "附近",
          },
        },
        ctx,
        fetch,
        now,
      );
      expect(f.status).toBe("failed");
      expect(f.value).toBeNull();
      expect(operationalFactSchema.safeParse(f).success).toBe(true);
      expect(amapRequest).not.toHaveBeenCalled();
    });
  }
});
