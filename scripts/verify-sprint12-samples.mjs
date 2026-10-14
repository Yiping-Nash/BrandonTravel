import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
await import("../apps/api/node_modules/tsx/dist/loader.mjs");
const { evaluate } =
    await import("../packages/utils/src/travel-intelligence.ts"),
  { operationalFactSchema, evaluationSchema } =
    await import("../packages/utils/src/travel-kernel-contract.ts");
const normal = JSON.parse(
    readFileSync("fixtures/travel/future-plans.json", "utf8"),
  ),
  fault = JSON.parse(
    readFileSync("fixtures/travel/timetable-faults.json", "utf8"),
  ),
  checks = [];
for (const f of normal.fixtures) {
  const result = evaluate(f.trip, [], 0, new Date("2026-10-08T01:00:00Z"));
  assert.equal(result.counts.CONFLICT, 0);
  assert.ok(result.counts.UNKNOWN > 0);
  assert.ok(evaluationSchema.safeParse(result).success);
  assert.equal(f.trip.startDate, "2026-10-13");
  checks.push(f.key + "多日多城市未定位不伪造天气或营业");
}
for (const c of fault.cases) {
  const trip = structuredClone(c.trip),
    facts = [],
    now = new Date(
      c.key === "forecast-out-of-range" ? fault.clock : "2026-10-13T01:00:00Z",
    );
  for (const binding of c.evaluationContext?.confirmedPlaceBindings ?? [])
    trip.activities.find((a) => a.id === binding.activityId).entityId =
      binding.entityId;
  const fact = (kind, subjectKey, value) => ({
    ...{
      id: randomUUID(),
      version: 1,
      kind,
      subjectKey,
      inputFingerprint: "isolated-mock",
      sourceRefId: null,
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
    },
  });
  for (const e of c.evaluationContext?.mockEntities ?? [])
    facts.push(
      fact("place", e.id, {
        kind: "place",
        name: e.name,
        address: "",
        regionCode: "140213",
        category: "attraction",
        coordinates: e.coordinates,
      }),
    );
  for (const m of c.mockFacts) {
    if (m.kind === "route_estimate") {
      const from = trip.activities.find((a) => a.id === m.fromActivityId),
        to = trip.activities.find((a) => a.id === m.toActivityId);
      facts.push(
        fact("route_estimate", from.id + ":" + to.id, {
          kind: "route_estimate",
          distanceMeters: 1000,
          durationSeconds: m.durationSeconds,
          mode: "driving",
          fromEntityId: from.entityId,
          toEntityId: to.entityId,
        }),
      );
    } else if (m.kind === "opening_hours") {
      const a = trip.activities.find((a) => a.id === m.activityId);
      facts.push(
        fact("opening_hours", a.entityId, {
          kind: "opening_hours",
          today: null,
          weekly: "10:30-14:30、17:00-21:30",
          timezone: "Asia/Shanghai",
          parseStatus: "pending",
        }),
      );
    } else if (m.kind === "weather") {
      const f = fact("weather", "140213:daily_forecast", {
        kind: "weather",
        regionCode: "140213",
        regionName: "模拟平城区",
        dataKind: "daily_forecast",
        days: m.coverageDates.map((date) => ({
          date,
          dayCondition: "晴",
          nightCondition: "晴",
          highTemperature: 20,
          lowTemperature: 10,
        })),
        observation: null,
      });
      f.appliesTo.dates = m.coverageDates;
      f.appliesTo.regionRef = "140213";
      facts.push(f);
    }
  }
  for (const f of facts) {
    const { freshness, unknownReason, ...stored } = f;
    operationalFactSchema.parse(stored);
  }
  const r = evaluate(
    trip,
    facts,
    1,
    now,
    undefined,
    c.evaluationContext?.activityEnvironment ?? {},
  );
  evaluationSchema.parse(r);
  const rule =
    c.key === "forecast-out-of-range" ? "WEATHER_EXPOSURE" : c.expected.rule;
  const target = r.results.find(
    (r) => r.rule === rule && r.state === c.expected.state,
  );
  assert.ok(target, c.key);
  if (c.expected.shortageMinutes)
    assert.equal(target.details.shortageMinutes, c.expected.shortageMinutes);
  if (c.key === "forecast-out-of-range")
    assert.equal(target.reasonCode, "WEATHER_OUT_OF_RANGE");
  checks.push(c.key + "正式内核规则验收（仅内存mock）");
}
writeFileSync(
  "verification/sprint12-samples.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      checks,
      providerRequests: 0,
      modelRequests: 0,
      productionFactsWritten: 0,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ passed: checks.length, checks }));
