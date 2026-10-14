/** Public POIs + synthetic user only. No LLM, no production trip. */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:net";
const root = process.cwd(),
  output = path.join(root, ".runtime/evals", Date.now() + "-provider");
mkdirSync(output, { recursive: true });
const cfg = JSON.parse(
  readFileSync(".runtime/config.json", "utf8").replace(/^\uFEFF/, ""),
);
const postgres = (
  await import("../apps/api/node_modules/postgres/src/index.js")
).default;
const admin = postgres(
  `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/postgres`,
  { max: 1 },
);
const name = "bt_eval_" + randomUUID().replaceAll("-", "").slice(0, 12),
  database = `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/${name}`;
const server = createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
await new Promise<void>((r) => server.close(() => r()));
const base = "http://127.0.0.1:" + port;
let child: any,
  sql: any,
  headers: any = { "Content-Type": "application/json" };
async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(base + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(JSON.stringify(data));
  return data.data;
}
try {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(root, "apps/api"),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BRANDON_LOCAL: "true",
      DATABASE_URL: database,
      JWT_SECRET: randomBytes(32).toString("hex"),
      PORT: String(port),
      HOST: "127.0.0.1",
      API_URL: base,
      MIGRATE_ON_START: "true",
      MIGRATIONS_DIR: path.join(root, "packages/database/drizzle"),
      TRAVEL_AMAP_CONFIG: path.join(root, ".runtime/amap.json"),
      TRAVEL_FACTS_ALLOW_NETWORK: "true",
      TRAVEL_MOCK_PROVIDERS: "false",
      TRAVEL_EVAL_TRACE: "false",
      TRAVEL_EVAL_FIXTURES: "synthetic",
      ROLLOVER_ENABLED: "false",
      EMAIL_WORKERS_ENABLED: "false",
      CALENDAR_SYNC_ENABLED: "false",
      RECURRING_ENABLED: "false",
      REDIS_URL: "",
      RESEND_API_KEY: "",
    },
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (d: Buffer) =>
      appendFileSync(path.join(output, "api.log"), d),
    );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  assert(ready);
  sql = postgres(database, { max: 1 });
  const email = `provider-fixture-${randomUUID()}@example.invalid`,
    password = "Fixture9!" + randomBytes(20).toString("hex");
  await api("/auth/register", "POST", {
    email,
    password,
    name: "虚构Provider链路验收",
  });
  const login = await api("/auth/login", "POST", { email, password });
  headers = { ...headers, Authorization: "Bearer " + login.token };
  const date = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  const trip = await api("/travel/trips", "POST", {
    title: "虚构Provider链路验收",
    startDate: date,
    endDate: date,
  });
  const entities = [];
  for (const query of ["山西博物院", "晋祠"]) {
    const rows = await api(
      "/travel/places/search?" + new URLSearchParams({ query, city: "太原" }),
    );
    const selected = rows.find((e: any) => e.name === query) || rows[0];
    assert(selected, "供应商未返回候选");
    entities.push(selected);
  }
  const activities = entities.map((e: any, i) => ({
    id: randomUUID(),
    title: "Provider测试" + (i + 1),
    date,
    start: 600 + i * 240,
    duration: 60,
    notes: "测试计划不是预订",
    place: e.name,
    position: i,
    locked: false,
  }));
  let current = await api(`/travel/trips/${trip.id}/operations`, "POST", {
    requestId: randomUUID(),
    expectedRevision: trip.revision,
    operations: [
      ...activities.map((activity) => ({ type: "add", activity })),
      ...activities.map((a, i) => ({
        type: "bind_entity",
        id: a.id,
        entity: entities[i],
      })),
    ],
  });
  const key = await api("/travel/keys", "POST", {});
  const userHeaders = headers;
  headers = { "Content-Type": "application/json", "X-Travel-Key": key.key };
  const refresh = await api(
    `/travel/trips/${trip.id}/prepare-operational-facts`,
    "POST",
    {
      requestId: randomUUID(),
      date,
      kinds: ["weather", "route_estimate"],
      entityIds: entities.map((e) => e.id),
    },
  );
  const context = await api(
    `/travel/trips/${trip.id}/planning-context?date=${date}`,
  );
  const first =
    await sql`SELECT provider,endpoint,status,error FROM travel_api_usage WHERE provider IN ('amap','open-meteo') AND endpoint<>'facts-cache' ORDER BY created_at`;
  assert(first.length <= 8, "供应商请求超过隔离样例上限");
  const cached = await api(
    `/travel/trips/${trip.id}/prepare-operational-facts`,
    "POST",
    {
      requestId: randomUUID(),
      date,
      kinds: ["weather", "route_estimate"],
      entityIds: entities.map((e) => e.id),
    },
  );
  const second =
    await sql`SELECT provider,endpoint,status,error FROM travel_api_usage WHERE provider IN ('amap','open-meteo') AND endpoint<>'facts-cache' ORDER BY created_at`;
  writeFileSync(
    path.join(output, "cache-debug.json"),
    JSON.stringify({ first, second, refresh, cached, context }, null, 2),
  );
  assert.equal(second.length, first.length, "缓存/冷却重复查询未去重");
  headers = userHeaders;
  const after = await api(`/travel/trips/${trip.id}`);
  assert.deepEqual(after, current, "刷新修改了计划");
  const report = {
    providerRequests: first.length,
    requests: first,
    refresh,
    cached,
    planRevisionUnchanged: true,
    context,
    modelRequests: 0,
    scope: "独立虚构账号，公开真实POI；不作为Golden规则Fixture",
    realRoute: context.evaluation.results.some(
      (r: any) =>
        r.rule === "TRANSITION_GAP" && r.details.durationSeconds !== null,
    ),
    realWeather: context.facts.some(
      (f: any) => f.kind === "weather" && f.status === "available",
    ),
  };
  writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      providerRequests: report.providerRequests,
      realRoute: report.realRoute,
      realWeather: report.realWeather,
      report: path.relative(root, path.join(output, "report.json")),
    }),
  );
  if (!report.realRoute || !report.realWeather) process.exitCode = 1;
} catch (e) {
  writeFileSync(
    path.join(output, "failure.txt"),
    e instanceof Error ? e.message : "failure",
  );
  console.error(e instanceof Error ? e.message : "failure");
  process.exitCode = 1;
} finally {
  child?.kill();
  await new Promise((r) => setTimeout(r, 500));
  await sql?.end();
  assert(/^bt_eval_[a-f0-9]+$/.test(name));
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH(FORCE)`);
  await admin.end();
}
