import { z } from "zod";
import type {
  TravelTrip,
  FactView,
  FactKind,
  FactValue,
  TravelEnvironment,
} from "@open-sunsama/types";
import { buildIntelligenceSnapshot } from "@open-sunsama/utils/travel-inspection";
import { demoFixtures } from "./demo-fixtures.js";
import { TravelError } from "../domain.js";
export const demoInputSchema = z
  .object({
    scene: z.enum([
      "overlap",
      "route-shortage",
      "lunch-closure",
      "missing-place",
      "forecast-out-of-range",
      "weather",
    ]),
    changes: z
      .array(
        z
          .object({
            activityId: z.uuid(),
            start: z.number().int().min(0).max(1380).optional(),
            environment: z
              .enum(["indoor", "outdoor", "unspecified"])
              .optional(),
          })
          .strict(),
      )
      .max(4)
      .default([]),
  })
  .strict();
export const demoScenes = [
  { id: "overlap", title: "重叠：移动第二项至10:30" },
  { id: "route-shortage", title: "路程：14:30改为14:45，不足13分钟消失" },
  { id: "lunch-closure", title: "营业：移到17:00开放区间" },
  { id: "weather", title: "天气：户外强降雨，改室内不适用" },
  { id: "missing-place", title: "未知：未绑定地点／未指定环境" },
  { id: "forecast-out-of-range", title: "未知：预报范围外" },
];
export function calculateDemo(raw: unknown) {
  const input = demoInputSchema.parse(raw),
    key = input.scene === "weather" ? "forecast-out-of-range" : input.scene;
  const original = demoFixtures.cases.find((c) => c.key === key)!;
  // JSON复制固定资产，绝不接收客户端的计划或事实。
  const c = JSON.parse(JSON.stringify(original)),
    trip = c.trip as TravelTrip;
  const now = new Date(
    input.scene === "forecast-out-of-range"
      ? "2026-10-07T04:00:00Z"
      : "2026-10-13T01:00:00Z",
  );
  const environments: Record<string, TravelEnvironment> = {
    ...c.evaluationContext?.activityEnvironment,
  };
  for (const b of c.evaluationContext?.confirmedPlaceBindings ?? [])
    trip.activities.find((a) => a.id === b.activityId)!.entityId = b.entityId;
  const facts: FactView[] = [];
  const fact = (
    kind: FactKind,
    subjectKey: string,
    value: FactValue,
  ): FactView => ({
    id: "00000000-0000-4000-8000-" + String(facts.length + 1).padStart(12, "0"),
    version: 1,
    kind,
    subjectKey,
    inputFingerprint: "DEMO_ONLY",
    sourceRefId: "00000000-0000-4000-8000-000000000999",
    collectionId: null,
    status: "available",
    retrievedAt: now.toISOString(),
    sourcePublishedAt: null,
    expiresAt: new Date(+now + 3600000).toISOString(),
    retryAfter: null,
    appliesTo: { dates: [], regionRef: null, basis: "selected_place" },
    quality: "complete",
    value,
    error: null,
    freshness: "fresh",
    unknownReason: null,
  });
  for (const e of c.evaluationContext?.mockEntities ?? [])
    facts.push(
      fact("place", e.id, {
        kind: "place",
        name: e.name,
        address: "模拟地点",
        regionCode: "140213",
        category: "attraction",
        coordinates: e.coordinates,
      }),
    );
  for (const m of c.mockFacts) {
    if (m.kind === "route_estimate") {
      const a = trip.activities.find((a) => a.id === m.fromActivityId)!,
        b = trip.activities.find((a) => a.id === m.toActivityId)!;
      facts.push(
        fact("route_estimate", a.id + ":" + b.id, {
          kind: "route_estimate",
          distanceMeters: 1000,
          durationSeconds: m.durationSeconds,
          mode: "driving",
          fromEntityId: a.entityId!,
          toEntityId: b.entityId!,
        }),
      );
    } else if (m.kind === "opening_hours") {
      const a = trip.activities.find((a) => a.id === m.activityId)!;
      facts.push(
        fact("opening_hours", a.entityId!, {
          kind: "opening_hours",
          today: null,
          weekly: "10:30-14:30、17:00-21:30",
          timezone: "Asia/Shanghai",
          parseStatus: "pending",
        }),
      );
    } else if (m.kind === "weather") {
      const dates =
        input.scene === "weather" ? ["2026-10-13"] : m.coverageDates;
      const f = fact("weather", "140213:daily_forecast", {
        kind: "weather",
        regionCode: "140213",
        regionName: "模拟平城区",
        dataKind: "daily_forecast",
        days: dates.map((date: string) => ({
          date,
          dayCondition: input.scene === "weather" ? "暴雨" : "晴",
          nightCondition: "晴",
          highTemperature: 20,
          lowTemperature: 10,
        })),
        observation: null,
      });
      f.appliesTo.dates = dates;
      f.appliesTo.regionRef = "140213";
      facts.push(f);
    }
  }
  if (input.scene === "weather")
    for (const a of trip.activities) environments[a.id] = "outdoor";
  for (const change of input.changes) {
    const a = trip.activities.find((a) => a.id === change.activityId);
    if (!a) throw new TravelError("演示活动不存在", 422);
    if (change.start !== undefined) {
      if (change.start + a.duration > 1440)
        throw new TravelError("活动必须在当天结束", 422);
      a.start = change.start;
    }
    if (change.environment !== undefined)
      environments[a.id] = change.environment;
  }
  return buildIntelligenceSnapshot(
    trip,
    facts,
    [
      {
        id: "00000000-0000-4000-8000-000000000999",
        providerId: "simulation",
        externalId: "built-in",
        kind: "place",
        displayName: "内置模拟资料（非高德）",
      },
    ],
    1,
    environments,
    now,
    {},
    "DEMO",
  );
}
