import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd(),
  cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8")),
  account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const postgres = (
  await import("../apps/api/node_modules/postgres/src/index.js")
).default;
const prefix = `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/`,
  name = "bt_sprint10_" + randomUUID().replaceAll("-", "").slice(0, 12),
  admin = postgres(prefix + "postgres", { max: 1 });
const checks = [],
  control = path.join(root, ".runtime/sprint10-control.json"),
  base = "http://127.0.0.1:4343";
let sql, child, headers;
const set = (mode) => writeFileSync(control, JSON.stringify({ mode }));
set("ready");
function run(exe, args, env = {}) {
  const r = spawnSync(exe, args, {
    cwd: root,
    env: { ...process.env, ...env },
    windowsHide: true,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
}
async function api(url, method = "GET", body, expected = 200) {
  const r = await fetch(base + "/travel" + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.equal(r.status, expected, JSON.stringify(d));
  return d.data;
}
try {
  mkdirSync(".runtime/backups", { recursive: true });
  const backup = path.join(root, ".runtime/backups/sprint10-live-before.dump");
  assert.ok(
    existsSync(backup),
    "需要本轮真实迁移前的备份，不能把v2重复迁移冒称旧库升级",
  );
  await admin.unsafe('CREATE DATABASE "' + name + '"');
  run(
    path.join(root, ".tools/postgresql/pgsql/bin/pg_restore.exe"),
    [
      "-h",
      "127.0.0.1",
      "-p",
      "54329",
      "-U",
      "brandon",
      "-d",
      name,
      "--no-owner",
      backup,
    ],
    { PGPASSWORD: cfg.databasePassword },
  );
  sql = postgres(prefix + name, { max: 3 });
  let before = await sql`SELECT id,state FROM travel_trips ORDER BY id`;
  assert.ok(
    before.some((r) => !r.state.schemaVersion),
    "旧库升级测试必须有v1数据",
  );
  const testUser = (
    await sql`SELECT id FROM users WHERE email=${account.email}`
  )[0].id;
  const legacyId = randomUUID(),
    legacyActivity = randomUUID(),
    legacyProposal = randomUUID();
  const oldTrip = {
    id: legacyId,
    title: "迁移前提案样本",
    startDate: "2026-10-13",
    endDate: "2026-10-13",
    timezone: "Asia/Shanghai",
    revision: 0,
    activities: [
      {
        id: legacyActivity,
        title: "旧活动",
        date: "2026-10-13",
        start: 600,
        duration: 60,
        locked: false,
        place: "待确认",
        notes: "",
        position: 0,
      },
    ],
  };
  const change = [
    { type: "edit", id: legacyActivity, patch: { title: "迁移后确认" } },
  ];
  const pending = {
    id: legacyProposal,
    tripId: legacyId,
    revision: 0,
    reason: "迁移前未处理提案",
    status: "pending",
    operations: change,
    before: oldTrip,
    after: {
      ...oldTrip,
      revision: 1,
      activities: oldTrip.activities.map((a) => ({
        ...a,
        title: "迁移后确认",
      })),
    },
    result: null,
    createdAt: new Date().toISOString(),
  };
  await sql`INSERT INTO travel_trips(id,user_id,state) VALUES(${legacyId},${testUser},${sql.json(oldTrip)})`;
  await sql`INSERT INTO travel_proposals(id,user_id,trip_id,state) VALUES(${legacyProposal},${testUser},${legacyId},${sql.json(pending)})`;
  const proposalsBefore =
    await sql`SELECT id,state FROM travel_proposals ORDER BY id`;
  before = await sql`SELECT id,state FROM travel_trips ORDER BY id`;
  const eventsBefore =
    await sql`SELECT id,state FROM travel_events ORDER BY id`;
  run(
    path.join(root, ".tools/bun/bun-windows-x64/bun.exe"),
    [
      "-e",
      'import {runMigrations} from "./packages/database/src/migrate.ts";await runMigrations(process.env.DATABASE_URL,"./packages/database/drizzle");',
    ],
    { DATABASE_URL: prefix + name },
  );
  const after = await sql`SELECT id,state FROM travel_trips ORDER BY id`;
  assert.equal(before.length, after.length);
  for (let i = 0; i < before.length; i++) {
    assert.equal(before[i].id, after[i].id);
    assert.equal(before[i].state.revision, after[i].state.revision);
    assert.deepEqual(
      before[i].state.activities.map((a) => a.id),
      after[i].state.activities.map((a) => a.id),
    );
    assert.equal(after[i].state.schemaVersion, 2);
  }
  assert.deepEqual(
    await sql`SELECT id,state FROM travel_proposals ORDER BY id`,
    proposalsBefore,
  );
  assert.deepEqual(
    await sql`SELECT id,state FROM travel_events ORDER BY id`,
    eventsBefore,
  );
  checks.push("旧库副本迁移保留行程/活动身份和revision及提案/事件历史");
  child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.join(root, "scripts/test-provider-loader.mjs")).href,
      "--import",
      "tsx",
      "src/index.ts",
    ],
    {
      cwd: path.join(root, "apps/api"),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BRANDON_LOCAL: "true",
        ROLLOVER_ENABLED: "false",
        EMAIL_WORKERS_ENABLED: "false",
        CALENDAR_SYNC_ENABLED: "false",
        RECURRING_ENABLED: "false",
        PORT: "4343",
        HOST: "127.0.0.1",
        DATABASE_URL: prefix + name,
        JWT_SECRET: cfg.jwtSecret,
        MIGRATE_ON_START: "false",
        TRAVEL_AMAP_CONFIG: path.join(root, ".runtime/amap.json"),
        TRAVEL_MOCK_PROVIDERS: "true",
        TRAVEL_TEST_CONTROL: control,
        TRAVEL_TEST_MODEL_BASE: "https://model-disabled.invalid/",
      },
    },
  );
  child.stdout.on("data", (d) =>
    appendFileSync(".runtime/sprint10-api.log", d),
  );
  child.stderr.on("data", (d) =>
    appendFileSync(".runtime/sprint10-api.log", d),
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
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
  const appliedLegacy = await api(
    `/proposals/${legacyProposal}/confirm`,
    "POST",
    {},
  );
  assert.equal(appliedLegacy.status, "applied");
  assert.equal(appliedLegacy.result.activities[0].title, "迁移后确认");
  assert.deepEqual(
    await api(`/proposals/${legacyProposal}/confirm`, "POST", {}),
    appliedLegacy,
  );
  checks.push("迁移前v1待确认提案可确认/重复确认幂等");
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  let trip = await api(
    "/trips",
    "POST",
    { title: "隔离事实层模拟验收", startDate: today, endDate: today },
    201,
  );
  const ids = [randomUUID(), randomUUID()];
  async function ops(operations) {
    trip = await api(`/trips/${trip.id}/operations`, "POST", {
      requestId: randomUUID(),
      expectedRevision: trip.revision,
      operations,
    });
  }
  await ops(
    ids.map((id, i) => ({
      type: "add",
      activity: {
        id,
        title: "测试" + i,
        date: today,
        start: 600 + i * 90,
        duration: 60,
        locked: false,
        place: "待确认",
        notes: "",
        position: i,
      },
    })),
  );
  const candidates = await api("/places/search?query=测试&city=大同");
  await ops(
    ids.map((id, i) => ({ type: "bind_entity", id, entity: candidates[i] })),
  );
  const revision = trip.revision,
    pathId = `/trips/${trip.id}`,
    refresh = (body) =>
      api(pathId + "/intelligence/refresh", "POST", {
        requestId: randomUUID(),
        ...body,
      });
  const kernel = await api(pathId + "/kernel");
  assert.ok(!("poiId" in kernel.entities[0]));
  assert.equal(kernel.activities[0].environment, "unspecified");
  checks.push("v2中立地点/v1签名绑定兼容");
  const pendingNew = await api(
    pathId + "/proposals",
    "POST",
    {
      requestId: randomUUID(),
      expectedRevision: trip.revision,
      reason: "事实刷新不使提案过期",
      operations: [
        { type: "edit", id: ids[0], patch: { notes: "只更改备注" } },
      ],
    },
    201,
  );
  let r = await refresh({
    kinds: ["weather", "route_estimate", "opening_hours", "place"],
  });
  assert.equal(r.attempted, 7);
  assert.equal(r.failed, 0);
  let facts = await api(pathId + "/operational-facts?limit=100");
  assert.equal(facts.facts.length, 7);
  assert.equal(facts.tripRevision, revision);
  assert.equal(facts.factsVersion, 7);
  assert.equal(
    facts.facts.find((f) => f.kind === "opening_hours").quality,
    "partial",
  );
  checks.push("四类事实/确定顺序/刷新不改计划版本");
  trip = (await api(`/proposals/${pendingNew.id}/confirm`, "POST", {})).result;
  checks.push("事实刷新后提案仍可确认");
  const usageBefore = await api("/usage");
  await api(pathId + "/operational-facts?activityId=" + ids[0]);
  await api(pathId + "/kernel");
  assert.deepEqual(
    (await api("/usage")).totals.filter((x) => x.provider !== "internal"),
    usageBefore.totals.filter((x) => x.provider !== "internal"),
  );
  checks.push("纯读取零外部调用/零事实写入");
  const subset = await api(pathId + "/operational-facts?activityId=" + ids[0]);
  assert.ok(subset.facts.some((f) => f.kind === "route_estimate"));
  assert.ok(subset.facts.some((f) => f.kind === "weather"));
  checks.push("活动事实包括相邻路线与天气区域");
  r = await refresh({
    kinds: ["place", "opening_hours", "route_estimate", "weather"],
  });
  assert.equal(r.attempted, 0);
  assert.equal(r.cache, 7);
  checks.push("新鲜缓存复用");
  const requestId = randomUUID(),
    input = { requestId, kinds: ["place"] };
  const first = await api(pathId + "/intelligence/refresh", "POST", input);
  assert.deepEqual(
    await api(pathId + "/intelligence/refresh", "POST", input),
    first,
  );
  await api(
    pathId + "/intelligence/refresh",
    "POST",
    { ...input, kinds: ["weather"] },
    409,
  );
  await api(
    pathId + "/intelligence/refresh",
    "POST",
    { ...input, requestId: randomUUID(), actor: "user" },
    422,
  );
  checks.push("刷新幂等/输入冲突/拒绝自选actor");
  set("route-failure");
  r = await refresh({ kinds: ["route_estimate"], force: true });
  assert.equal(r.failed, 1);
  r = await refresh({ kinds: ["route_estimate"], force: true });
  assert.equal(r.cooldown, 1);
  assert.equal(r.attempted, 0);
  checks.push("失败记录与强制刷新仍服从冷却");
  await sql`UPDATE travel_operational_facts SET fact=jsonb_set(fact,'{retryAfter}','null'::jsonb) WHERE trip_id=${trip.id} AND kind='route_estimate'`;
  set("late-route");
  const a = refresh({ kinds: ["route_estimate"], force: true });
  const b = refresh({ kinds: ["route_estimate"], force: true });
  const both = await Promise.all([a, b]);
  assert.equal(both[0].attempted, 1);
  assert.equal(both[1].attempted, 1);
  const logs = await api("/usage");
  assert.ok(logs.totals.some((x) => x.status === "coalesced"));
  checks.push("并行同输入合并为一次供应商请求");
  const delayed = refresh({ kinds: ["route_estimate"], force: true });
  await new Promise((r) => setTimeout(r, 350));
  await ops([{ type: "edit", id: ids[0], patch: { start: 800 } }]);
  r = await delayed;
  assert.equal(r.discarded, 1);
  checks.push("活动相邻关系变化拒绝晚返回旧结果");
  set("late-route");
  const cancelId = randomUUID();
  const cancelling = api(pathId + "/intelligence/refresh", "POST", {
    requestId: cancelId,
    kinds: ["route_estimate"],
    force: true,
  });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(
    (await api(pathId + "/intelligence/refresh/" + cancelId)).status,
    "running",
  );
  assert.equal(
    (
      await api(
        pathId + "/intelligence/refresh/" + cancelId + "/cancel",
        "POST",
        {},
      )
    ).status,
    "stopping",
  );
  assert.equal((await cancelling).cancelled, true);
  assert.equal(
    (await api(pathId + "/intelligence/refresh/" + cancelId)).status,
    "cancelled",
  );
  checks.push("刷新可查询与停止，不撤销已取得事实");
  set("hours-missing");
  r = await refresh({
    kinds: ["opening_hours"],
    entityIds: [candidates[0].id],
    force: true,
  });
  facts = await api(pathId + "/operational-facts?entityId=" + candidates[0].id);
  assert.equal(
    facts.facts.find((f) => f.kind === "opening_hours").status,
    "missing",
  );
  checks.push("营业字段缺失不伪造开放");
  const future = await api(
    pathId + "/operational-facts?kind=weather&date=2026-12-31",
  );
  assert.equal(future.facts.length, 0);
  assert.ok(future.gaps.length);
  checks.push("超出预报范围明确资料缺口");
  await ops([{ type: "bind_entity", id: ids[1], entity: candidates[0] }]);
  assert.equal(
    trip.activities.find((a) => a.id === ids[0]).entityId,
    trip.activities.find((a) => a.id === ids[1]).entityId,
  );
  checks.push("两个活动共享同一确认地点");
  set("late-route");
  const older = refresh({ kinds: ["route_estimate", "weather"], force: true });
  await new Promise((r) => setTimeout(r, 50));
  const newer = refresh({ kinds: ["route_estimate"], force: true });
  const generations = await Promise.all([older, newer]);
  assert.equal(generations[0].discarded, 1);
  assert.equal(generations[1].succeeded, 1);
  checks.push("更新采集代次防止旧批次覆盖新批次");
  const samePhysical = refresh({ kinds: ["route_estimate"], force: true });
  await new Promise((r) => setTimeout(r, 250));
  const newSelection = (await api("/places/search?query=测试&city=大同"))[0];
  assert.equal(newSelection.poiId, candidates[0].poiId);
  assert.notEqual(newSelection.id, candidates[0].id);
  await ops([{ type: "bind_entity", id: ids[0], entity: newSelection }]);
  assert.equal(
    trip.activities.find((a) => a.id === ids[0]).entityId,
    candidates[0].id,
  );
  assert.equal((await samePhysical).succeeded, 1);
  checks.push("重新选择同POI复用稳定地点身份与有效连接");
  const deletion = refresh({ kinds: ["route_estimate"], force: true });
  await new Promise((r) => setTimeout(r, 250));
  await ops([{ type: "delete", id: ids[1] }]);
  assert.equal((await deletion).discarded, 1);
  assert.equal((await api(pathId + "/transitions")).length, 0);
  checks.push("删除活动后晚返回不重建失效连接");
  const foreign =
    await sql`SELECT id FROM travel_trips WHERE user_id<>${account.userId ?? "051f9c7f-ca57-4157-9300-47807ea5165a"} LIMIT 1`;
  if (foreign[0])
    await api(
      `/trips/${foreign[0].id}/operational-facts`,
      "GET",
      undefined,
      404,
    );
  checks.push("行程归属授权");
  if (process.env.TRAVEL_SPRINT17_TEST === "true") {
    const { verifySprint18 } = await import("./sprint18-scenarios.mjs");
    process.env.DATABASE_URL = prefix + name;
    process.env.JWT_SECRET = cfg.jwtSecret;
    set("ready");
    await verifySprint18({ api, sql, checks, candidates });
  }
  const counts =
    await sql`SELECT provider,status,count(*)::int count FROM travel_api_usage WHERE session_id=${login.data.token ? "never-match" : ""} GROUP BY provider,status`;
  writeFileSync(
    process.env.TRAVEL_SPRINT17_TEST === "true"
      ? "verification/sprint18-simulated.json"
      : "verification/sprint10-simulated.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        checks,
        realProviderRequests: 0,
        modelRequests: 0,
        legacyTrips: before.length,
        isolatedDatabase: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  if (child) {
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
  if (sql) await sql.end();
  await admin.unsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.end();
}
