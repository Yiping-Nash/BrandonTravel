import { queryOpenMeteo, type WeatherPoint } from "./open-meteo.js";
import type {
  FactKind,
  FactValue,
  OperationalFact,
  TravelEntity,
  TravelMode,
} from "@open-sunsama/types";
import { randomUUID } from "node:crypto";
import { amapRequest, parseRoute, type UsageContext } from "../amap.js";
export type FactTask = {
  kind: FactKind;
  subjectKey: string;
  fingerprint: string;
  sourceRefId: string;
  entity?: TravelEntity;
  from?: TravelEntity;
  to?: TravelEntity;
  mode?: TravelMode;
  regionCode?: string;
  weatherPoint?: WeatherPoint;
  weatherKind?: "observation" | "daily_forecast" | "outlook";
};
const text = (x: unknown) =>
  typeof x === "string" && x.trim() ? x.trim() : null;
const number = (x: unknown) =>
  ((typeof x === "string" && x.trim()) || typeof x === "number") &&
  Number.isFinite(Number(x))
    ? Number(x)
    : null;
export const ttl = (kind: FactKind, weatherKind?: string) =>
  kind === "route_estimate"
    ? 20 * 60000
    : kind === "place"
      ? 7 * 86400000
      : kind === "opening_hours"
        ? 86400000
        : weatherKind === "outlook"
          ? 12 * 3600000
          : weatherKind === "observation"
            ? 1800000
            : 6 * 3600000;
export async function collect(
  task: FactTask,
  ctx: UsageContext,
  fetcher = fetch,
  now = new Date(),
  prefetched?: Awaited<ReturnType<typeof amapRequest>>,
): Promise<OperationalFact> {
  const fact: OperationalFact = {
    id: randomUUID(),
    version: 1,
    kind: task.kind,
    subjectKey: task.subjectKey,
    inputFingerprint: task.fingerprint,
    sourceRefId: task.sourceRefId,
    collectionId: null,
    status: "missing",
    retrievedAt: now.toISOString(),
    sourcePublishedAt: null,
    expiresAt: new Date(+now + ttl(task.kind, task.weatherKind)).toISOString(),
    retryAfter: null,
    appliesTo: { dates: [], regionRef: null, basis: "selected_place" },
    quality: "partial",
    value: null,
    error: null,
  };
  try {
    let value: FactValue | null = null;
    if (task.kind === "place" || task.kind === "opening_hours") {
      const data =
        prefetched ??
        (await amapRequest(
          "/v5/place/detail",
          { id: task.entity!.poiId, show_fields: "business" },
          ctx,
          fetcher,
        ));
      const p = data.pois?.find((p) => p.id === task.entity!.poiId);
      if (!p) throw Error("SOURCE_ID_MISMATCH");
      if (task.kind === "place") {
        const coords = String(p.location ?? "").split(",");
        const longitude = number(coords[0]),
          latitude = number(coords[1]);
        if (
          coords.length !== 2 ||
          longitude === null ||
          latitude === null ||
          Math.abs(longitude) > 180 ||
          Math.abs(latitude) > 85
        )
          throw Error("INVALID_RESPONSE");
        const category = String(p.typecode ?? "").slice(0, 2);
        value = {
          kind: "place",
          name: String(p.name ?? ""),
          address: text(p.address) ?? "",
          regionCode: text(p.adcode),
          telephone: text(
            (p.business as Record<string, unknown> | undefined)?.tel,
          ),
          category:
            category === "11"
              ? "attraction"
              : category === "05"
                ? "restaurant"
                : category === "10"
                  ? "hotel"
                  : "other",
          coordinates: { longitude, latitude, coordinateSystem: "GCJ-02" },
        };
      } else {
        const business = p.business as Record<string, unknown> | undefined;
        const today = text(business?.opentime_today),
          weekly = text(business?.opentime_week);
        if (today || weekly)
          value = {
            kind: "opening_hours",
            today,
            weekly,
            timezone: "Asia/Shanghai",
            parseStatus: "pending",
          };
        fact.quality = "partial";
        fact.appliesTo.basis = "described_hours";
        if (today) {
          const midnight = new Date(now);
          const day = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(now);
          midnight.setTime(Date.parse(day + "T00:00:00+08:00") + 86400000);
          fact.expiresAt = new Date(
            Math.min(Date.parse(fact.expiresAt), +midnight),
          ).toISOString();
        }
        if (today)
          fact.appliesTo.dates = [
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Shanghai",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(now),
          ];
      }
    } else if (task.kind === "route_estimate") {
      const params: Record<string, string> = {
        origin: `${task.from!.longitude},${task.from!.latitude}`,
        destination: `${task.to!.longitude},${task.to!.latitude}`,
        show_fields: "cost",
      };
      if (task.mode === "driving") params.strategy = "32";
      const e = parseRoute(
        await amapRequest(`/v5/direction/${task.mode}`, params, ctx, fetcher),
        task.fingerprint,
      );
      value = {
        kind: "route_estimate",
        distanceMeters: e.distanceMeters!,
        durationSeconds: e.durationSeconds!,
        mode: task.mode!,
        fromEntityId: task.from!.id,
        toEntityId: task.to!.id,
      };
      fact.appliesTo.basis = "current_estimate";
    } else {
      if (!task.weatherPoint || task.weatherKind === "observation")
        throw Error("WEATHER_POINT_MISSING");
      value = await queryOpenMeteo(
        task.weatherPoint,
        task.weatherKind === "outlook" ? "outlook" : "daily_forecast",
        ctx,
        fetcher,
      );
      fact.appliesTo = {
        dates: value.days.map((d) => d.date),
        regionRef: task.weatherPoint.key,
        basis: "provider_dates",
      };
    }
    fact.value = value;
    fact.status = value ? "available" : "missing";
    if (task.kind !== "opening_hours")
      fact.quality = value ? "complete" : "partial";
    if (!value) {
      fact.error = { code: "FACT_MISSING", retryable: true };
      fact.retryAfter = new Date(+now + 300000).toISOString();
    }
  } catch (error) {
    const m = error instanceof Error ? error.message : "PROVIDER_FAILED";
    const code = /10021|10014|10019|10020/.test(m)
      ? "RATE_LIMIT"
      : /10003|10044/.test(m)
        ? "QUOTA_EXHAUSTED"
        : /10001|10002|10009|10041/.test(m)
          ? "PROVIDER_PERMISSION"
          : /^[A-Z_]+$/.test(m)
            ? m
            : "PROVIDER_FAILED";
    fact.status = "failed";
    fact.quality = "failed";
    fact.error = { code, retryable: code !== "PROVIDER_PERMISSION" };
    fact.retryAfter = new Date(
      +now +
        (code === "QUOTA_EXHAUSTED"
          ? 86400000
          : code === "PROVIDER_PERMISSION"
            ? 86400000
            : 60000),
    ).toISOString();
    fact.expiresAt = now.toISOString();
  }
  return fact;
}
