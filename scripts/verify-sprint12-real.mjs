import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
const account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  base = "http://127.0.0.1:4332";
const login = await (
  await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  })
).json();
assert.ok(login.data.token);
const headers = {
  Authorization: "Bearer " + login.data.token,
  "Content-Type": "application/json",
  "X-Travel-Test": "true",
};
async function api(path, method = "GET", body) {
  const r = await fetch(base + "/travel" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.equal(
    r.status,
    path === "/trips" && method === "POST" ? 201 : 200,
    JSON.stringify(d),
  );
  return d.data;
}
const cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8"));
const postgres = (
  await import("../apps/api/node_modules/postgres/src/index.js")
).default;
const sql = postgres(
  "postgresql://brandon:" +
    cfg.databasePassword +
    "@127.0.0.1:54329/brandontravel",
  { max: 1 },
);
const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const user = (await sql`SELECT id FROM users WHERE email=${account.email}`)[0]
  .id;
const before = hash(
  await sql`SELECT id,state,facts_version FROM travel_trips WHERE user_id<>${user} ORDER BY id`,
);
try {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  let trip = await api("/trips", "POST", {
    title: "Sprint12真实天气与地点来源（隔离测试，非旅行建议）",
    startDate: today,
    endDate: today,
  });
  const candidates = [];
  for (const [query, city] of [
    ["华严寺", "大同"],
    ["广东省博物馆", "广州"],
  ]) {
    const rows = await api(
      "/places/search?" + new URLSearchParams({ query, city }),
    );
    assert.ok(rows.length);
    candidates.push(rows[0]);
    await new Promise((r) => setTimeout(r, 1100));
  }
  const preview = await api(
    "/trips/" + trip.id + "/place-preview",
    "POST",
    candidates[0],
  );
  assert.ok(
    preview.facts.some((f) => f.kind === "place" && f.status === "available"),
  );
  const ids = [randomUUID(), randomUUID()];
  trip = await api("/trips/" + trip.id + "/kernel/operations", "POST", {
    requestId: randomUUID(),
    expectedRevision: 0,
    operations: ids.flatMap((id, i) => [
      {
        type: "add",
        activity: {
          id,
          title: candidates[i].name,
          date: today,
          start: 600 + i * 180,
          duration: 60,
          place: candidates[i].name,
          notes: "真实接口隔离样本",
          locked: false,
          position: i,
        },
      },
      { type: "bind_entity", id, entity: candidates[i] },
    ]),
    environments: ids.map((activityId) => ({
      activityId,
      environment: "outdoor",
    })),
  });
  const revision = trip.revision;
  const refreshed = await api(
    "/trips/" + trip.id + "/intelligence/refresh",
    "POST",
    { requestId: randomUUID(), kinds: ["place", "opening_hours", "weather"] },
  );
  const facts = await api("/trips/" + trip.id + "/operational-facts?limit=100"),
    evaluation = await api("/trips/" + trip.id + "/intelligence");
  assert.equal(facts.tripRevision, revision);
  const weather = facts.facts.filter((f) => f.kind === "weather");
  assert.ok(weather.some((f) => f.status === "available"));
  for (const f of weather.filter((f) => f.status === "available")) {
    assert.equal(f.value.regionCode, f.appliesTo.regionRef);
    assert.ok(f.sourcePublishedAt);
    if (f.value.dataKind === "daily_forecast")
      assert.deepEqual(
        f.appliesTo.dates,
        f.value.days.map((d) => d.date),
      );
  }
  const usageBefore = await api("/usage");
  await api("/trips/" + trip.id + "/kernel");
  await api("/trips/" + trip.id + "/operational-facts");
  await api("/trips/" + trip.id + "/intelligence");
  const usage = await api("/usage");
  assert.deepEqual(
    usageBefore.totals.filter((x) => x.provider !== "internal"),
    usage.totals.filter((x) => x.provider !== "internal"),
  );
  assert.equal(
    hash(
      await sql`SELECT id,state,facts_version FROM travel_trips WHERE user_id<>${user} ORDER BY id`,
    ),
    before,
  );
  const result = {
    date: new Date().toISOString(),
    tripId: trip.id,
    revision,
    refreshed,
    facts,
    evaluation,
    usage: usage.totals,
    preview: preview.facts,
    nonTestUserStateUnchanged: true,
    modelCalls: 0,
    checks: [
      "独立账号两城市真实POI",
      "候选预览真实营业原文",
      "实际行政区域匹配",
      "预报仅供应商实际日期",
      "查询与发布时刻",
      "刷新revision不变",
      "读取无外部调用",
      "其他用户状态未变",
    ],
    strongRainReal: weather.some(
      (f) =>
        f.value?.kind === "weather" &&
        f.value.days.some((d) =>
          ["大雨", "暴雨", "大暴雨", "特大暴雨"].includes(d.dayCondition),
        ),
    ),
  };
  writeFileSync(
    "verification/sprint12-real.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      tripId: trip.id,
      refreshed,
      weather: weather.map((f) => ({
        status: f.status,
        region: f.appliesTo.regionRef,
        dates: f.appliesTo.dates,
        error: f.error,
      })),
      usage: usage.totals,
      modelCalls: 0,
    }),
  );
} finally {
  await sql.end();
}
