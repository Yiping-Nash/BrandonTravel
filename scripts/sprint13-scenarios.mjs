import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
export async function verifySprint13({ api, sql, checks }) {
  await import("../apps/api/node_modules/tsx/dist/loader.mjs");
  const { buildIntelligenceSnapshot } =
    await import("../packages/utils/src/travel-inspection.ts");
  const { operationalSnapshot } =
    await import("../apps/api/src/travel/kernel/service.ts");
  let trip = await api(
    "/trips",
    "POST",
    {
      title: "Sprint13隔离只读验收",
      startDate: "2026-10-13",
      endDate: "2026-10-13",
    },
    201,
  );
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  trip = await api("/trips/" + trip.id + "/operations", "POST", {
    requestId: randomUUID(),
    expectedRevision: trip.revision,
    operations: ids.map((id, i) => ({
      type: "add",
      activity: {
        id,
        title: "活动" + i,
        date: "2026-10-13",
        start: 600 + i * 120,
        duration: 60,
        locked: false,
        position: i,
        place: "待确认",
        notes: "",
      },
    })),
  });
  const readPlan = () =>
    sql.unsafe("SELECT state,facts_version FROM travel_trips WHERE id=$1", [
      trip.id,
    ]);
  const readFacts = () =>
    sql.unsafe("SELECT fact FROM travel_operational_facts WHERE trip_id=$1", [
      trip.id,
    ]);
  const readUsage = () =>
    sql.unsafe(
      "SELECT count(*)::int AS n FROM travel_api_usage WHERE provider <> 'internal'",
    );
  const stateBefore = await readPlan(),
    factsBefore = await readFacts(),
    usageBefore = await readUsage();
  const path = "/trips/" + trip.id + "/intelligence-snapshot";
  const s = await api(path);
  assert.equal(s.capabilities[0].objects, 3);
  assert.equal(
    s.roots.filter((r) => r.reason === "PLACE_UNCONFIRMED").length,
    3,
  );
  const focused = await api(path + "?activityId=" + ids[1]);
  assert.equal(
    focused.traces.filter((t) => t.rule === "TRANSITION_GAP").length,
    2,
  );
  await api(
    path + "?date=2026-10-13&activityId=" + ids[0],
    "GET",
    undefined,
    422,
  );
  await api(path + "?activityId=" + randomUUID(), "GET", undefined, 404);
  const owner = (
    await sql.unsafe("SELECT user_id FROM travel_trips WHERE id=$1", [trip.id])
  )[0].user_id;
  const snapshot = await operationalSnapshot(
    {
      userId: owner,
      actor: "user",
      session: "isolated",
      purpose: "thin-adapter",
    },
    trip.id,
  );
  const thin = buildIntelligenceSnapshot(
    snapshot.trip,
    snapshot.facts,
    snapshot.sources,
    snapshot.factsVersion,
    snapshot.environments,
    new Date(s.evaluatedAt),
  );
  assert.deepEqual(thin, s);
  checks.push(
    "Snapshot领域／REST／薄适配器一致，活动含前后连接，互斥筛选及不存在活动拒绝",
  );
  const scenes = await api("/intelligence-demo");
  assert.equal(scenes.length, 6);
  for (const scene of scenes) {
    const d = await api("/intelligence-demo", "POST", { scene: scene.id });
    assert.equal(d.mode, "DEMO");
    assert.equal(d.sources[0].providerId, "simulation");
  }
  await api("/intelligence-demo", "POST", { scene: "overlap", facts: [] }, 422);
  assert.deepEqual(await readPlan(), stateBefore);
  assert.deepEqual(await readFacts(), factsBefore);
  assert.deepEqual(await readUsage(), usageBefore);
  checks.push(
    "纯读取及六个内置沙盒不改计划／事实／外部调用日志，拒绝任意事实注入",
  );
  writeFileSync(
    "verification/sprint13-api.json",
    JSON.stringify(
      {
        checks: checks.slice(-2),
        providerRequests: 0,
        modelRequests: 0,
        persistenceUnchanged: true,
      },
      null,
      2,
    ),
  );
  const { db } = await import("../apps/api/src/travel/store.ts");
  await db().end();
}
