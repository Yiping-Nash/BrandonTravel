import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "../store.js";
import type { UsageContext } from "../amap.js";
import type { FactValue } from "@open-sunsama/types";
export type WeatherPoint = {
  longitude: number;
  latitude: number;
  key: string;
  name: string;
};
const conditions: Record<number, string> = {
  0: "晴",
  1: "晴间多云",
  2: "多云",
  3: "阴",
  45: "雾",
  48: "雾",
  51: "小雨",
  53: "小雨",
  55: "小雨",
  56: "雨夹雪",
  57: "雨夹雪",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "雨夹雪",
  67: "雨夹雪",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "小雪",
  80: "阵雨",
  81: "阵雨",
  82: "大雨",
  85: "阵雪",
  86: "阵雪",
  95: "雷阵雨",
  96: "雷阵雨并伴有冰雹",
  99: "雷阵雨并伴有冰雹",
};
const finite = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);
const distribution = (a: number[]) => {
  const s = a.filter(finite).sort((a, b) => a - b);
  if (s.length < 2) return undefined;
  const q = (p: number) => {
    const n = (s.length - 1) * p,
      i = Math.floor(n);
    return s[i]! + (s[Math.ceil(n)]! - s[i]!) * (n - i);
  };
  return { p10: q(0.1), median: q(0.5), p90: q(0.9) };
};
export function parseWeather(
  raw: unknown,
  point: WeatherPoint,
  kind: "daily_forecast" | "outlook",
): Extract<FactValue, { kind: "weather" }> {
  const parsed = z
    .object({
      error: z.unknown().optional(),
      timezone: z.literal("Asia/Shanghai"),
      daily: z.record(z.string(), z.array(z.unknown())),
      daily_units: z.record(z.string(), z.string()).optional(),
    })
    .safeParse(raw);
  if (!parsed.success || parsed.data.error || !parsed.data.daily.time?.length)
    throw Error("INVALID_RESPONSE");
  const data = parsed.data,
    d = data.daily,
    time = d.time as string[];
  if (
    time.some(
      (t) =>
        typeof t !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(t) ||
        !Number.isFinite(Date.parse(t + "T00:00:00Z")) ||
        new Date(t + "T00:00:00Z").toISOString().slice(0, 10) !== t,
    ) ||
    new Set(time).size !== time.length
  )
    throw Error("INVALID_DATES");
  const tempKeys = Object.keys(d).filter((k) =>
      /^temperature_2m_mean(?:_member\d+)?$/.test(k),
    ),
    rainKeys = Object.keys(d).filter((k) =>
      /^precipitation_sum(?:_member\d+)?$/.test(k),
    );
  const members = kind === "outlook" ? tempKeys.length : undefined;
  if (
    kind === "outlook" &&
    (tempKeys.length !== 51 ||
      rainKeys.length !== tempKeys.length ||
      tempKeys.some(
        (k) =>
          !rainKeys.includes(
            k.replace("temperature_2m_mean", "precipitation_sum"),
          ),
      ))
  )
    throw Error("ENSEMBLE_MISSING");
  for (const k of kind === "outlook"
    ? [...tempKeys, ...rainKeys]
    : [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_probability_max",
      ]) {
    if (!Array.isArray(d[k]) || d[k]!.length !== time.length)
      throw Error("INVALID_RESPONSE");
  }
  if (data.daily_units) {
    for (const k of kind === "outlook"
      ? [...tempKeys, ...rainKeys]
      : [
          "temperature_2m_max",
          "temperature_2m_min",
          "precipitation_probability_max",
        ]) {
      const expected = k.startsWith("temperature")
        ? "°C"
        : k.startsWith("precipitation_probability")
          ? "%"
          : "mm";
      if (data.daily_units[k] !== expected) throw Error("INVALID_UNITS");
    }
  }
  const days = time
    .map((date, i) => {
      if (kind === "outlook") {
        const temp = tempKeys.map((k) => d[k]![i]),
          rain = rainKeys.map((k) => d[k]![i]);
        if (temp.some((v) => v === null) || rain.some((v) => v === null))
          return null;
        if (
          temp.some((v) => !finite(v)) ||
          rain.some((v) => !finite(v) || v < 0)
        )
          throw Error("ENSEMBLE_INCOMPLETE");
        return {
          date,
          dayCondition: null,
          nightCondition: null,
          highTemperature: null,
          lowTemperature: null,
          temperatureDistribution: distribution(temp as number[])!,
          precipitationDistribution: distribution(rain as number[])!,
        };
      }
      const code = d.weather_code![i],
        high = d.temperature_2m_max![i],
        low = d.temperature_2m_min![i],
        prob = d.precipitation_probability_max![i];
      if (code === null || high === null || low === null) return null;
      if (
        !finite(code) ||
        !finite(high) ||
        !finite(low) ||
        low > high ||
        (prob !== null && (!finite(prob) || prob < 0 || prob > 100))
      )
        throw Error("INVALID_RESPONSE");
      return {
        date,
        dayCondition: conditions[code] ?? null,
        nightCondition: null,
        highTemperature: high,
        lowTemperature: low,
        precipitationProbability: prob,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  if (!days.length) throw Error("NO_USABLE_FORECAST");
  return {
    kind: "weather",
    providerId: "open-meteo",
    model: kind === "outlook" ? "ECMWF EC46" : "best_match",
    regionCode: point.key,
    regionName: point.name,
    dataKind: kind,
    coordinates: {
      longitude: point.longitude,
      latitude: point.latitude,
      coordinateSystem: "WGS84",
    },
    ...(members ? { memberCount: members, spatialResolutionKm: 36 } : {}),
    days,
    observation: null,
  };
}
export async function queryOpenMeteo(
  point: WeatherPoint,
  kind: "daily_forecast" | "outlook",
  ctx: UsageContext,
  fetcher = fetch,
) {
  const host =
      kind === "outlook" ? "seasonal-api.open-meteo.com" : "api.open-meteo.com",
    path = kind === "outlook" ? "/v1/seasonal" : "/v1/forecast";
  // Optional acceptance-only cap; never limits ordinary interactive use.
  if (
    ctx.purpose === "sprint18-acceptance" &&
    process.env.TRAVEL_OPEN_METEO_TEST_BUDGET_FILE
  ) {
    const p = process.env.TRAVEL_OPEN_METEO_TEST_BUDGET_FILE;
    const b = JSON.parse(readFileSync(p, "utf8"));
    if (b.count >= b.limit) throw Error("TEST_BUDGET_EXHAUSTED");
    b.count++;
    writeFileSync(p, JSON.stringify(b));
  }
  const id = randomUUID(),
    started = Date.now(),
    provider =
      process.env.TRAVEL_MOCK_PROVIDERS === "true"
        ? "open-meteo-mock"
        : "open-meteo";
  await db()`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status) VALUES(${id},${ctx.user},${ctx.session ?? "unknown"},${provider},${host + path},${ctx.purpose ?? "interactive"},'running')`;
  try {
    const url = new URL("https://" + host + path);
    url.search = new URLSearchParams({
      latitude: String(point.latitude),
      longitude: String(point.longitude),
      timezone: "Asia/Shanghai",
      forecast_days: kind === "outlook" ? "46" : "16",
      temperature_unit: "celsius",
      precipitation_unit: "mm",
      daily:
        kind === "outlook"
          ? "temperature_2m_mean,precipitation_sum"
          : "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      ...(kind === "outlook" ? { models: "ecmwf_ec46" } : {}),
    }).toString();
    const r = await fetcher(url, { signal: AbortSignal.timeout(15000) }),
      data = (await r.json()) as Record<string, unknown>;
    if (!r.ok || data.error)
      throw Error(
        r.status === 429
          ? "RATE_LIMIT"
          : r.status === 401 || r.status === 403
            ? "PROVIDER_PERMISSION"
            : "PROVIDER_HTTP_" + r.status,
      );
    const value = parseWeather(data, point, kind);
    await db()`UPDATE travel_api_usage SET status='success',elapsed_ms=${Date.now() - started} WHERE id=${id}`;
    return value;
  } catch (e) {
    await db()`UPDATE travel_api_usage SET status='failed',elapsed_ms=${Date.now() - started},error=${e instanceof Error ? e.message : "PROVIDER_FAILED"} WHERE id=${id}`;
    throw e;
  }
}
