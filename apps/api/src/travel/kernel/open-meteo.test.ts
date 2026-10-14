import { describe, it, expect } from "vitest";
import { parseWeather } from "./open-meteo.js";
const point = {
  longitude: 113,
  latitude: 40,
  key: "point",
  name: "模拟地点附近",
};
const daily = () => ({
  timezone: "Asia/Shanghai",
  daily: {
    time: ["2026-10-10"],
    weather_code: [65],
    temperature_2m_max: [20],
    temperature_2m_min: [10],
    precipitation_probability_max: [80],
  },
});
const outlook = () => {
  const d: Record<string, unknown> = { time: ["2026-10-26"] };
  for (let i = 0; i < 51; i++) {
    const x = i ? "_member" + String(i).padStart(2, "0") : "";
    d["temperature_2m_mean" + x] = [i];
    d["precipitation_sum" + x] = [i / 10];
  }
  return { timezone: "Asia/Shanghai", daily: d };
};
describe("Open-Meteo真实协议解析（无HTTP）", () => {
  it("WMO日级大雨归一化，夜间不编造", () => {
    const f = parseWeather(daily(), point, "daily_forecast");
    expect(f.days[0]).toMatchObject({
      dayCondition: "大雨",
      nightCondition: null,
      precipitationProbability: 80,
    });
  });
  it("EC46成员分布不伪装确定天气", () => {
    const f = parseWeather(outlook(), point, "outlook");
    expect(f.memberCount).toBe(51);
    expect(f.days[0]).toMatchObject({
      dayCondition: null,
      temperatureDistribution: { p10: 5, median: 25, p90: 45 },
      precipitationDistribution: { p10: 0.5, median: 2.5, p90: 4.5 },
    });
  });
  it("无效或重复日期拒绝", () => {
    for (const t of [["2026-02-30"], ["2026-10-10", "2026-10-10"]]) {
      const x = daily();
      x.daily.time = t;
      expect(() => parseWeather(x, point, "daily_forecast")).toThrow();
    }
  });
  it("长度错位、负概率及温度颠倒拒绝", () => {
    for (const k of [
      "weather_code",
      "temperature_2m_max",
      "precipitation_probability_max",
    ]) {
      const x = daily();
      (x.daily as unknown as Record<string, unknown>)[k] =
        k === "weather_code" ? [] : [-100];
      expect(() => parseWeather(x, point, "daily_forecast")).toThrow();
    }
  });
  it("缺失成员、空成员、单位外负降水拒绝", () => {
    for (const mode of [0, 1, 2]) {
      const x = outlook();
      if (mode === 0) delete x.daily.precipitation_sum_member50;
      else x.daily.precipitation_sum_member50 = [mode === 1 ? null : -1];
      expect(() => parseWeather(x, point, "outlook")).toThrow();
    }
  });
  it("某日空成员仅排除该日期，不隐藏其他可用日期", () => {
    const x = outlook();
    x.daily.time = ["2026-10-26", "2026-10-27"];
    for (const [k, v] of Object.entries(x.daily))
      if (k !== "time") x.daily[k] = [...(v as number[]), null];
    expect(parseWeather(x, point, "outlook").days.map((d) => d.date)).toEqual([
      "2026-10-26",
    ]);
  });
  it("供应商单位不符拒绝", () => {
    expect(() =>
      parseWeather(
        { ...daily(), daily_units: { temperature_2m_max: "°F" } },
        point,
        "daily_forecast",
      ),
    ).toThrow("INVALID_UNITS");
  });
  it("未知天气码不猜测，错误时区拒绝", () => {
    const x = daily();
    x.daily.weather_code = [999];
    expect(
      parseWeather(x, point, "daily_forecast").days[0]!.dayCondition,
    ).toBeNull();
    x.timezone = "UTC";
    expect(() => parseWeather(x, point, "daily_forecast")).toThrow();
  });
});
