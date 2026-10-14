import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
const cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8")),
  account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const pg = (await import("../apps/api/node_modules/postgres/src/index.js"))
  .default;
const connection =
    "postgresql://brandon:" +
    cfg.databasePassword +
    "@127.0.0.1:54329/brandontravel",
  sql = pg(connection, { max: 1 });
process.env.DATABASE_URL = connection;
process.env.JWT_SECRET = cfg.jwtSecret;
process.env.TRAVEL_OPEN_METEO_TEST_BUDGET_FILE =
  ".runtime/sprint18/budget.json";
process.env.TRAVEL_FACTS_ALLOW_NETWORK = "true";
await import("../apps/api/node_modules/tsx/dist/loader.mjs");
const { refreshFacts } =
  await import("../apps/api/src/travel/kernel/service.ts");
const { db } = await import("../apps/api/src/travel/store.ts");
const report = {
  checks: [],
  trips: [],
  modelRequests: 0,
  amapRequests: 0,
  providerCredits: null,
};
let headers;
async function api(p, method = "GET", body) {
  const r = await fetch("http://127.0.0.1:4332/travel" + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    d = await r.json();
  assert.equal(
    r.status,
    p === "/trips" && method === "POST" ? 201 : 200,
    d.error?.message,
  );
  return d.data;
}
try {
  const login = await (
    await fetch("http://127.0.0.1:4332/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
      }),
    })
  ).json();
  assert.ok(login.data?.token);
  headers = {
    Authorization: "Bearer " + login.data.token,
    "Content-Type": "application/json",
  };
  const payload = JSON.parse(
      Buffer.from(login.data.token.split(".")[1], "base64url"),
    ),
    user = (await sql`select id from users where email=${account.email}`)[0].id,
    session = createHash("sha256").update(payload.sessionId).digest("hex");
  const ctx = {
    userId: user,
    actor: "user",
    session,
    purpose: "sprint18-acceptance",
  };
  const before = JSON.stringify(
    await sql`select id,state,facts_version from travel_trips where user_id<>${user} order by id`,
  );
  const owned = await api("/trips");
  const entities = owned.flatMap((t) => t.entities ?? []);
  const places = ["华严寺", "广东省博物馆"].map((name) =>
    entities.find((e) => e.name === name),
  );
  assert.ok(
    places.every((e) => e?.poiId),
    "需要独立测试账号已有真实地点缓存",
  );
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  const offset = (n) =>
    new Date(Date.parse(today + "T00:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
  for (let i = 0; i < 2; i++)
    for (const far of [false, true]) {
      const e = {
        ...places[i],
        id: randomUUID(),
        selectedAt: new Date().toISOString(),
      };
      delete e.selectionProof;
      e.selectionProof = createHmac("sha256", cfg.jwtSecret)
        .update(JSON.stringify([user, e]))
        .digest("hex");
      let trip = await api("/trips", "POST", {
        title:
          (i ? "广东八日" : "山西七日") +
          (far ? "远期趋势" : "逐日天气") +
          "（Sprint18独立验收）",
        startDate: far ? offset(16) : "2026-10-13",
        endDate: far ? offset(45) : i ? "2026-10-20" : "2026-10-19",
      });
      const dates = far
        ? [offset(16), offset(30), offset(45)]
        : Array.from({ length: i ? 8 : 7 }, (_, n) =>
            new Date(Date.parse("2026-10-13T00:00:00Z") + n * 86400000)
              .toISOString()
              .slice(0, 10),
          );
      trip = await api("/trips/" + trip.id + "/operations", "POST", {
        requestId: randomUUID(),
        expectedRevision: trip.revision,
        operations: dates.flatMap((date, n) => {
          const id = randomUUID();
          return [
            {
              type: "add",
              activity: {
                id,
                title: (far ? "趋势" : "日级") + "日期验证" + n,
                date,
                start: 600,
                duration: 60,
                locked: false,
                position: n,
                place: e.name,
                notes: "复用独立测试账号已有真实POI；并非各日真实旅游安排",
              },
            },
            { type: "bind_entity", id, entity: e },
          ];
        }),
      });
      const result = await refreshFacts(ctx, trip.id, {
        requestId: randomUUID(),
        kinds: ["weather"],
        force: false,
      });
      assert.equal(result.failed, 0, "供应商失败，停止不重试");
      assert.equal(result.succeeded, 1);
      const s = await api("/trips/" + trip.id + "/intelligence-snapshot");
      assert.equal(s.evaluation.tripRevision, trip.revision);
      const used = s.days.filter((d) => dates.includes(d.date));
      for (const d of used) {
        assert.ok(["AVAILABLE", "NOT_PROVIDED"].includes(d.regions[0]?.status));
        assert.equal(
          d.regions[0]?.forecastKind,
          far ? "outlook" : "daily_forecast",
        );
      }
      const f = s.facts.find((f) => f.kind === "weather");
      assert.equal(f.value.providerId, "open-meteo");
      assert.equal(f.sourcePublishedAt, null);
      assert.ok(
        f.value.days.length > 0 && f.value.days.length <= (far ? 46 : 16),
      );
      const again = await refreshFacts(ctx, trip.id, {
        requestId: randomUUID(),
        kinds: ["weather"],
        force: false,
      });
      assert.equal(again.attempted, 0);
      assert.equal(again.cache, 1);
      report.trips.push({
        id: trip.id,
        kind: far ? "outlook" : "daily_forecast",
        poi: { name: e.name, city: e.city },
        reusedPoi: true,
        dates: used.map((d) => ({
          date: d.date,
          status: d.regions[0].status,
          condition: d.regions[0].dayCondition,
          high: d.regions[0].highTemperature,
          low: d.regions[0].lowTemperature,
          trend: d.regions[0].trend,
        })),
        refresh: result,
        cache: again.cache,
        planRevision: trip.revision,
        factsVersion: s.evaluation.factsVersion,
      });
    }
  assert.equal(
    JSON.stringify(
      await sql`select id,state,facts_version from travel_trips where user_id<>${user} order by id`,
    ),
    before,
  );
  const logs =
    await sql`select provider,status,count(*)::int count from travel_api_usage where session_id=${session} group by provider,status`;
  assert.ok(
    !logs.some(
      (l) =>
        (l.provider === "amap" || l.provider === "model") &&
        ["success", "failed", "running"].includes(l.status),
    ),
  );
  report.usage = logs;
  report.requestsIncludingProbe = JSON.parse(
    readFileSync(".runtime/sprint18/budget.json", "utf8"),
  ).count;
  report.checks = [
    "实际EC46尾日可能全为null，仅可用日期归一化；第46天资料缺失如实显示",
    "山西七日与广东八日每个日期选择对应返回值，真实地点缓存复用",
    "16天日级与第17/31/46天EC46边界按实际返回逐日匹配",
    "趋势与预报分开缓存，重复刷新0HTTP",
    "模型发布时间未知，不伪造",
    "事实更新不改计划版本；不改其他用户计划",
  ];
  report.status = "PASS";
  console.log(
    JSON.stringify({
      status: report.status,
      requests: report.requestsIncludingProbe,
      checks: report.checks,
    }),
  );
} catch (e) {
  report.status = "FAILED";
  report.error = e.message;
  process.exitCode = 1;
  console.log(report.error);
} finally {
  writeFileSync(
    "verification/sprint18-real.json",
    JSON.stringify(report, null, 2),
  );
  await sql.end();
  await db().end();
}
