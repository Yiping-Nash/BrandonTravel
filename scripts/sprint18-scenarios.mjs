import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
export async function verifySprint18({ api, sql, checks, candidates }) {
  await import("../apps/api/node_modules/tsx/dist/loader.mjs");
  const { buildIntelligenceSnapshot } =
    await import("../packages/utils/src/travel-inspection.ts");
  const { operationalSnapshot } =
    await import("../apps/api/src/travel/kernel/service.ts");
  let trip = await api(
    "/trips",
    "POST",
    {
      title: "Sprint16隔离只读验收",
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
  assert.ok(s.days.length > 0);
  assert.equal(s.connections.length, 2);
  assert.equal(s.days[0].unlocatedCount, 3);
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
    "verification/sprint18-api.json",
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
  // New first-use scenario in isolated database. No production trips or suppliers.
  const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Shanghai",
    }),
    tomorrow = new Date(Date.parse(today + "T00:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
  let first = await api(
    "/trips",
    "POST",
    { title: "Sprint18零资料日期限定", startDate: today, endDate: tomorrow },
    201,
  );
  const newIds = [randomUUID(), randomUUID(), randomUUID()];
  first = await api("/trips/" + first.id + "/operations", "POST", {
    expectedRevision: first.revision,
    requestId: randomUUID(),
    operations: newIds.map((id, i) => ({
      type: "add",
      activity: {
        id,
        title: "首次活动" + i,
        date: i === 2 ? tomorrow : today,
        start: 600 + i * 90,
        duration: 60,
        position: i,
        locked: false,
        notes: "",
        place: "模拟",
      },
    })),
  });
  first = await api("/trips/" + first.id + "/operations", "POST", {
    expectedRevision: first.revision,
    requestId: randomUUID(),
    operations: newIds.map((id, i) => ({
      type: "bind_entity",
      id,
      entity: candidates[i === 2 ? 1 : 0],
    })),
  });
  const zero = await api("/trips/" + first.id + "/intelligence-snapshot");
  assert.equal(zero.facts.length, 0);
  assert.equal(zero.days[0].weatherQuery.canQuery, true);
  assert.match(zero.days[0].weatherQuery.message, /尚未查询/);
  const update = {
    requestId: randomUUID(),
    kinds: ["weather"],
    dates: [today],
    force: false,
  };
  const q = await api(
    "/trips/" + first.id + "/intelligence/refresh",
    "POST",
    update,
  );
  assert.equal(q.succeeded, 1);
  const ready = await api("/trips/" + first.id + "/intelligence-snapshot");
  assert.equal(ready.evaluation.tripRevision, first.revision);
  assert.equal(ready.days[0].regions[0].status, "AVAILABLE");
  assert.equal(ready.facts.filter((f) => f.kind === "place").length, 0);
  assert.equal(
    ready.facts.filter((f) => f.kind === "route_estimate").length,
    0,
  );
  const repeat = await api(
    "/trips/" + first.id + "/intelligence/refresh",
    "POST",
    { ...update, requestId: randomUUID() },
  );
  assert.equal(repeat.attempted, 0);
  assert.equal(repeat.cache, 1);
  checks.push(
    "首次天气从零资料直接使用已确认坐标、同坐标去重/日期限定不查询其他日地点/缓存复用/不改计划不隐式查询路线",
  );
  const route = await api(
    "/trips/" + first.id + "/intelligence/refresh",
    "POST",
    {
      requestId: randomUUID(),
      kinds: ["route_estimate"],
      dates: [today],
      force: false,
    },
  );
  assert.equal(route.succeeded, 1);
  const linked = await api("/trips/" + first.id + "/intelligence-snapshot"),
    old = await api("/trips/" + first.id + "/transitions");
  assert.notEqual(linked.connections[0].durationSeconds, null);
  assert.equal(
    linked.connections[0].durationSeconds,
    old[0].estimate.durationSeconds,
  );
  assert.equal(linked.connections[0].shortageMinutes, old[0].shortageMinutes);
  assert.equal(linked.evaluation.tripRevision, first.revision);
  checks.push(
    "首次路线共享刷新/Snapshot与旧连接耗时及不足一致/事实更新不改变计划版本",
  );
  const { db } = await import("../apps/api/src/travel/store.ts");
  await db().end();
}
