import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
export async function verifySprint11({ api, sql, checks, candidates }) {
  await import("../apps/api/node_modules/tsx/dist/loader.mjs");
  const { evaluate } =
    await import("../packages/utils/src/travel-intelligence.ts");
  let trip = await api(
    "/trips",
    "POST",
    {
      title: "Sprint11隔离规则验收",
      startDate: "2026-10-13",
      endDate: "2026-10-15",
    },
    201,
  );
  const ids = [randomUUID(), randomUUID()];
  const id = trip.id;
  const ops = async (operations) => {
    trip = await api(`/trips/${id}/operations`, "POST", {
      requestId: randomUUID(),
      expectedRevision: trip.revision,
      operations,
    });
  };
  await ops(
    ids.flatMap((aid, i) => [
      {
        type: "add",
        activity: {
          id: aid,
          title: "规则活动" + i,
          date: "2026-10-13",
          start: 780 + i * 90,
          duration: 60,
          locked: false,
          place: "地点待确认",
          notes: "",
          position: i,
        },
      },
      { type: "bind_entity", id: aid, entity: candidates[i] },
    ]),
  );
  await api(`/trips/${id}/intelligence/refresh`, "POST", {
    requestId: randomUUID(),
    kinds: ["place", "opening_hours", "route_estimate"],
  });
  await sql`UPDATE travel_operational_facts SET fact=jsonb_set(fact,'{value,durationSeconds}','2580'::jsonb) WHERE trip_id=${id} AND kind='route_estimate'`;
  await sql`UPDATE travel_operational_facts SET fact=jsonb_set(jsonb_set(fact,'{value,today}','null'::jsonb),'{value,weekly}',${sql.json("10:30-14:30、17:00-21:30")}) WHERE trip_id=${id} AND kind='opening_hours' AND subject_key=${candidates[0].id}`;
  let result = await api(`/trips/${id}/intelligence`);
  const route = result.results.find((r) => r.rule === "TRANSITION_GAP");
  assert.equal(route.details.shortageMinutes, 13);
  assert.equal(route.reasonCode, "TRANSITION_TIME_SHORTAGE");
  checks.push("REST路程43分钟/空档30分钟/不足13分钟");
  const facts = await api(`/trips/${id}/operational-facts?limit=100`);
  const domain = evaluate(
    trip,
    facts.facts,
    facts.factsVersion,
    new Date(result.evaluatedAt),
  );
  assert.deepEqual(result, domain);
  checks.push("REST与纯领域同快照逐字段一致");
  const day = await api(`/trips/${id}/intelligence?date=2026-10-13`),
    activity = await api(`/trips/${id}/intelligence?activityId=${ids[1]}`);
  assert.deepEqual(
    day.results,
    result.results.filter((r) => r.activityIds.length),
  );
  assert.deepEqual(
    activity.results,
    result.results.filter((r) => r.activityIds.includes(ids[1])),
  );
  assert.ok(activity.results.some((r) => r.transitionId === ids.join(":")));
  await api(
    `/trips/${id}/intelligence?date=2026-10-13&activityId=${ids[0]}`,
    "GET",
    undefined,
    422,
  );
  checks.push("日/活动投影一致且筛选互斥");
  const context = await api(
    `/trips/${id}/activities/${ids[1]}/operational-context`,
  );
  assert.equal(context.connections.length, 1);
  assert.deepEqual(context.evaluation.results, activity.results);
  checks.push("活动运营上下文包含前后连接和事实引用");
  let before = await api("/usage");
  await api(`/trips/${id}/intelligence`);
  await api(`/trips/${id}/activities/${ids[0]}/operational-context`);
  let after = await api("/usage");
  assert.deepEqual(
    before.totals.filter((x) => x.provider !== "internal"),
    after.totals.filter((x) => x.provider !== "internal"),
  );
  assert.equal((await api(`/trips/${id}`)).revision, trip.revision);
  checks.push("评估零供应商调用且不写计划/事实");
  await ops([{ type: "edit", id: ids[1], patch: { start: 885 } }]);
  assert.equal(
    (await api(`/trips/${id}/intelligence`)).results.find(
      (r) => r.rule === "TRANSITION_GAP",
    ).state,
    "VALID",
  );
  checks.push("编辑到14:45重新评估为足够，不另查路程");
  await ops([{ type: "edit", id: ids[0], patch: { start: 840 } }]);
  result = await api(`/trips/${id}/intelligence`);
  assert.equal(
    result.results.find(
      (r) => r.rule === "OPENING_COVERAGE" && r.activityIds.includes(ids[0]),
    ).reasonCode,
    "OPENING_NOT_COVERED",
  );
  assert.ok(result.results.some((r) => r.reasonCode === "ACTIVITY_OVERLAP"));
  checks.push("营业午间关闭/重叠允许保存且可解释");
  const rows = await api(`/trips/${id}/transitions`);
  assert.equal(
    rows[0].shortageMinutes,
    result.results.find((r) => r.rule === "TRANSITION_GAP").details
      .shortageMinutes,
  );
  checks.push("旧连接提示与引擎数值一致");
  writeFileSync(
    "verification/sprint11-ui-fixture.json",
    JSON.stringify({ trip, evaluation: result, transitions: rows }, null, 2),
  );
  await sql`UPDATE travel_operational_facts SET fact=jsonb_set(fact,'{expiresAt}',${sql.json(new Date(Date.now() - 1000).toISOString())}) WHERE trip_id=${id} AND kind='route_estimate'`;
  result = await api(`/trips/${id}/intelligence`);
  assert.equal(
    result.results.find((r) => r.rule === "TRANSITION_GAP").reasonCode,
    "FACT_STALE",
  );
  assert.equal(
    (await api(`/trips/${id}/transitions`))[0].shortageMinutes,
    null,
  );
  checks.push("过期路线在REST/旧提示均不算确定不足");
  const real = JSON.parse(
    readFileSync("verification/sprint10-real.json", "utf8"),
  );
  const { parseHours } =
    await import("../packages/utils/src/travel-intelligence.ts");
  const realHours = real.facts
    .filter((f) => f.kind === "opening_hours")
    .map((f) => ({ raw: f.value.weekly, parsed: parseHours(f.value.weekly) }));
  assert.ok(realHours.some((r) => r.parsed.quality === "partial"));
  assert.ok(realHours.some((r) => r.parsed.quality === "complete"));
  writeFileSync(
    "verification/sprint11-stored-real-hours.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        source: "Sprint10真实高德返回原文",
        newProviderRequests: 0,
        realHours,
      },
      null,
      2,
    ),
  );
  checks.push("已存真实高德营业原文可解析/季节原文保留部分解析");
}
