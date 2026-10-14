import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
export async function verifySprint12({ api, sql, checks, candidates }) {
  await import("../apps/api/node_modules/tsx/dist/loader.mjs");
  const { evaluate } =
    await import("../packages/utils/src/travel-intelligence.ts");
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  let trip = await api(
    "/trips",
    "POST",
    { title: "Sprint12隔离天气和来源验收", startDate: today, endDate: today },
    201,
  );
  const ids = [randomUUID(), randomUUID()],
    id = trip.id;
  const command = (
    operations,
    environments,
    expectedRevision = trip.revision,
    requestId = randomUUID(),
  ) => ({ operations, environments, expectedRevision, requestId });
  const ops = ids.flatMap((aid, i) => [
    {
      type: "add",
      activity: {
        id: aid,
        title: "天气活动" + i,
        date: today,
        start: 600 + i * 180,
        duration: 60,
        place: "待确认",
        notes: "",
        locked: false,
        position: i,
      },
    },
    { type: "bind_entity", id: aid, entity: candidates[i] },
  ]);
  const input = command(
    ops,
    ids.map((activityId) => ({ activityId, environment: "outdoor" })),
  );
  trip = await api("/trips/" + id + "/kernel/operations", "POST", input);
  const k = await api("/trips/" + id + "/kernel");
  assert.ok(k.activities.every((a) => a.environment === "outdoor"));
  assert.equal(
    (await api("/trips/" + id + "/kernel/operations", "POST", input)).revision,
    trip.revision,
  );
  checks.push("户外属性和普通修改同一事务保存/刷新一致/重试幂等");
  await api(
    "/trips/" + id + "/kernel/operations",
    "POST",
    command(
      [{ type: "edit", id: ids[0], patch: { title: "不应保存" } }],
      [{ activityId: ids[0], environment: "indoor" }],
      0,
    ),
    409,
  );
  await api(
    "/trips/" + id + "/kernel/operations",
    "POST",
    {
      ...command(
        [{ type: "edit", id: ids[0], patch: { title: "不应保存" } }],
        [],
      ),
      actor: "user",
    },
    422,
  );
  assert.equal(
    (await api("/trips/" + id + "/kernel")).activities[0].environment,
    "outdoor",
  );
  checks.push("版本冲突/伪造actor不部分写入");
  const old = await api("/trips/" + id);
  assert.ok(old.activities.every((a) => !("environment" in a)));
  trip = await api("/trips/" + id + "/operations", "POST", {
    requestId: randomUUID(),
    expectedRevision: trip.revision,
    operations: [{ type: "edit", id: ids[0], patch: { notes: "旧v1编辑" } }],
  });
  assert.equal(
    (await api("/trips/" + id + "/kernel")).activities[0].environment,
    "outdoor",
  );
  checks.push("旧v1契约无新字段/旧编辑保留v2属性");
  const before = await api("/usage"),
    preview = await api(
      "/trips/" + id + "/place-preview",
      "POST",
      candidates[0],
    );
  assert.equal(preview.facts.length, 2);
  assert.equal(preview.cached, false);
  assert.equal(
    (await api("/trips/" + id + "/place-preview", "POST", candidates[0]))
      .cached,
    true,
  );
  await api(
    "/trips/" + id + "/place-preview",
    "POST",
    { ...candidates[0], poiId: "forged" },
    422,
  );
  assert.equal((await api("/trips/" + id)).revision, trip.revision);
  checks.push("候选详情一次请求两类资料/缓存/篡改拒绝/不改计划");
  await api("/trips/" + id + "/intelligence/refresh", "POST", {
    requestId: randomUUID(),
    kinds: ["place", "opening_hours", "route_estimate", "weather"],
  });
  const facts = await api("/trips/" + id + "/operational-facts?limit=100");
  assert.ok(facts.facts.some((f) => f.kind === "weather"));
  assert.equal(facts.tripRevision, trip.revision);
  const w = facts.facts.find((f) => f.subjectKey === "140200:daily_forecast");
  await sql`UPDATE travel_operational_facts SET fact=jsonb_set(fact,'{value,days,0,dayCondition}','"暴雨"'::jsonb) WHERE trip_id=${id} AND subject_key=${w.subjectKey}`;
  let evaluation = await api("/trips/" + id + "/intelligence");
  assert.equal(evaluation.counts.WARNING, 2);
  const { getIntelligence } =
    await import("../apps/api/src/travel/kernel/service.ts");
  const user = (await sql`SELECT user_id FROM travel_trips WHERE id=${id}`)[0]
    .user_id;
  const thinAdapter = {
    read: (tripId) =>
      getIntelligence(
        {
          userId: user,
          actor: "user",
          session: "test-thin-adapter",
          purpose: "acceptance",
        },
        tripId,
      ),
  };
  const viaAdapter = await thinAdapter.read(id);
  assert.deepEqual(viaAdapter.results, evaluation.results);
  const snapshot = await api("/trips/" + id + "/operational-facts?limit=100");
  const domain = evaluate(
    trip,
    snapshot.facts,
    snapshot.factsVersion,
    new Date(evaluation.evaluatedAt),
    undefined,
    Object.fromEntries(k.activities.map((a) => [a.id, a.environment])),
  );
  assert.deepEqual(domain, evaluation);
  const context = await api(
    "/trips/" + id + "/activities/" + ids[0] + "/operational-context",
  );
  assert.ok(
    context.evaluation.results.some(
      (r) => r.rule === "WEATHER_EXPOSURE" && r.state === "WARNING",
    ),
  );
  checks.push("模拟暴雨WARNING/REST与领域和薄适配器一致/活动投影保留天气事实");
  trip = await api(
    "/trips/" + id + "/kernel/operations",
    "POST",
    command(
      [{ type: "edit", id: ids[0], patch: { notes: "室内" } }],
      [{ activityId: ids[0], environment: "indoor" }],
    ),
  );
  assert.equal((await api("/trips/" + id + "/intelligence")).counts.WARNING, 1);
  checks.push("用户切室内自动重评估且不触发外部查询");
  trip = await api("/trips/" + id + "/operations", "POST", {
    requestId: randomUUID(),
    expectedRevision: trip.revision,
    operations: [{ type: "edit", id: ids[1], patch: { locked: true } }],
  });
  await api(
    "/trips/" + id + "/kernel/operations",
    "POST",
    command(
      [{ type: "edit", id: ids[1], patch: { title: "不应保存" } }],
      [{ activityId: ids[1], environment: "indoor" }],
    ),
    422,
  );
  assert.notEqual((await api("/trips/" + id)).activities[1].title, "不应保存");
  checks.push("固定户外属性保护/事务回滚");
  const beforeRead = await api("/usage");
  await api("/trips/" + id + "/intelligence");
  await api("/trips/" + id + "/kernel");
  await api("/trips/" + id + "/operational-facts");
  const afterRead = await api("/usage");
  assert.deepEqual(
    beforeRead.totals.filter((x) => x.provider !== "internal"),
    afterRead.totals.filter((x) => x.provider !== "internal"),
  );
  checks.push("纯读取0供应商/模型调用");
  const transitions = await api("/trips/" + id + "/transitions");
  const { db } = await import("../apps/api/src/travel/store.ts");
  await db().end();
  writeFileSync(
    "verification/sprint12-ui-fixture.json",
    JSON.stringify(
      {
        trip,
        evaluation: await api("/trips/" + id + "/intelligence"),
        kernel: await api("/trips/" + id + "/kernel"),
        facts: await api("/trips/" + id + "/operational-facts?limit=100"),
        transitions,
      },
      null,
      2,
    ),
  );
}
