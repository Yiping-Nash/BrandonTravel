import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
const account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8")),
  base = "http://127.0.0.1:4332";
const pg = (await import("../apps/api/node_modules/postgres/src/index.js"))
  .default;
const sql = pg(
  "postgresql://brandon:" +
    cfg.databasePassword +
    "@127.0.0.1:54329/brandontravel",
  { max: 1 },
);
const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
let headers,
  trip,
  report = {
    date: new Date().toISOString(),
    budget: 10,
    modelRequests: 0,
    checks: [],
    status: "running",
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
    d.error?.message,
  );
  return d.data;
}
try {
  const login = await (
    await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
      }),
    })
  ).json();
  assert.ok(login.data.token);
  headers = {
    Authorization: "Bearer " + login.data.token,
    "Content-Type": "application/json",
    "X-Travel-Test": "true",
  };
  const user = (await sql`SELECT id FROM users WHERE email=${account.email}`)[0]
    .id;
  const other = () =>
    sql`SELECT id,state,facts_version FROM travel_trips WHERE user_id<>${user} ORDER BY id`;
  const before = hash(await other());
  const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Shanghai",
    }),
    date = new Date(Date.parse(today + "T00:00:00Z") + 2 * 86400000)
      .toISOString()
      .slice(0, 10);
  trip = await api("/trips", "POST", {
    title: "Sprint17西安首次天气与路线（隔离测试）",
    startDate: date,
    endDate: date,
  });
  report.tripId = trip.id;
  const candidates = [];
  for (const query of ["邢老三肉丸糊辣汤总店", "西安城墙"]) {
    const rows = await api(
      "/places/search?" + new URLSearchParams({ query, city: "西安" }),
    );
    assert.ok(rows.length, "搜索没有候选，停止不重试");
    candidates.push(rows[0]);
    await new Promise((r) => setTimeout(r, 1100));
  }
  const ids = [randomUUID(), randomUUID()];
  trip = await api("/trips/" + trip.id + "/operations", "POST", {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    operations: ids.flatMap((id, i) => [
      {
        type: "add",
        activity: {
          id,
          title: i ? "城墙" : "早餐",
          date,
          start: 450 + i * 165,
          duration: 60,
          position: i,
          locked: false,
          notes: "独立测试，不是用户行程",
          place: candidates[i].name,
        },
      },
      { type: "bind_entity", id, entity: candidates[i] },
    ]),
  });
  let s = await api("/trips/" + trip.id + "/intelligence-snapshot");
  assert.equal(s.facts.length, 0);
  assert.equal(s.days[0].weatherQuery.canQuery, true);
  report.checks.push("真实候选绑定后零Facts，首次查询入口存在");
  const weather = await api(
    "/trips/" + trip.id + "/intelligence/refresh",
    "POST",
    {
      requestId: randomUUID(),
      kinds: ["place", "weather"],
      dates: [date],
      force: false,
    },
  );
  s = await api("/trips/" + trip.id + "/intelligence-snapshot");
  assert.equal(s.evaluation.tripRevision, trip.revision);
  report.weatherRefresh = weather;
  report.weather = s.days[0].regions.map((r) => ({
    name: r.name,
    status: r.status,
    reason: r.reason,
    dayCondition: r.dayCondition,
    highTemperature: r.highTemperature,
    lowTemperature: r.lowTemperature,
  }));
  report.places = candidates.map((e) => ({ name: e.name, city: e.city }));
  assert.ok(
    s.days[0].regions.some((r) => r.status === "AVAILABLE"),
    "未取得可用真实预报；停止，不重试",
  );
  report.checks.push("一次显式刷新串联地点详情和适用日期预报，不需指定环境");
  const route = await api(
    "/trips/" + trip.id + "/intelligence/refresh",
    "POST",
    {
      requestId: randomUUID(),
      kinds: ["route_estimate"],
      dates: [date],
      force: false,
    },
  );
  s = await api("/trips/" + trip.id + "/intelligence-snapshot");
  const old = await api("/trips/" + trip.id + "/transitions");
  report.routeRefresh = route;
  report.connection = s.connections[0];
  assert.notEqual(s.connections[0].durationSeconds, null);
  assert.equal(
    s.connections[0].durationSeconds,
    old[0].estimate.durationSeconds,
  );
  assert.equal(s.connections[0].shortageMinutes, old[0].shortageMinutes);
  assert.equal(s.evaluation.tripRevision, trip.revision);
  report.checks.push("真实路线Snapshot和连接接口一致、事实更新不改计划");
  const usage = await api("/usage"),
    calls = usage.recent.filter(
      (r) => r.provider === "amap" && r.endpoint.startsWith("/"),
    );
  report.providerRequests = calls.length;
  report.requests = calls.map((r) => ({
    endpoint: r.endpoint,
    status: r.status,
  }));
  assert.ok(calls.length <= 10);
  report.otherUsersUnchanged = hash(await other()) === before;
  assert.equal(report.otherUsersUnchanged, true);
  report.checks.push("其他用户计划与事实版本不变、实际调用不超过10次");
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.message;
  if (headers) {
    const u = await api("/usage");
    report.providerRequests = u.recent.filter(
      (r) => r.provider === "amap" && r.endpoint.startsWith("/"),
    ).length;
  }
  process.exitCode = 1;
} finally {
  writeFileSync(
    "verification/sprint17-real.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  await sql.end();
}
