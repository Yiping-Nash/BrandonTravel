import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = process.cwd(),
  cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8")),
  model = JSON.parse(readFileSync(".runtime/model-api.json", "utf8")),
  a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const controlPath = path.join(root, ".runtime/provider-control.json");
let control = { mode: "ready" };
const set = (data) => {
  control = { ...control, ...data };
  writeFileSync(controlPath, JSON.stringify(control));
};
set({});
const apiProcess = spawn(
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
      PORT: "4342",
      HOST: "127.0.0.1",
      API_URL: "http://127.0.0.1:4342",
      DATABASE_URL: `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
      JWT_SECRET: cfg.jwtSecret,
      MIGRATE_ON_START: "true",
      MIGRATIONS_DIR: path.join(root, "packages/database/drizzle"),
      TRAVEL_AMAP_CONFIG: path.join(root, ".runtime/amap.json"),
      TRAVEL_MODEL_CONFIG: path.join(root, ".runtime/model-api.json"),
      TRAVEL_MOCK_PROVIDERS: "true",
      TRAVEL_TEST_CONTROL: controlPath,
      TRAVEL_TEST_MODEL_BASE: model.baseUrl,
    },
  },
);
apiProcess.stdout.on("data", (d) => appendFileSync(".runtime/mock-api.log", d));
apiProcess.stderr.on("data", (d) => appendFileSync(".runtime/mock-api.log", d));
const base = "http://127.0.0.1:4342/travel",
  headers = {
    Authorization: "Bearer " + a.token,
    "Content-Type": "application/json",
    "X-Travel-Test": "true",
  },
  checks = [];
async function api(url, method = "GET", body, expect = 200) {
  const r = await fetch(base + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.equal(r.status, expect, `${url}: ${JSON.stringify(data)}`);
  return data.data;
}
async function complete(id, tripId) {
  for (let i = 0; i < 100; i++) {
    const runs = await api(`/trips/${tripId}/chat`);
    const run = runs.find((x) => x.id === id);
    if (run?.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw Error("模拟聊天未完成");
}
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4342/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = await (
    await fetch("http://127.0.0.1:4342/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: a.email, password: a.password }),
    })
  ).json();
  headers.Authorization = "Bearer " + login.data.token;
  let trip = await api(
    "/trips",
    "POST",
    { title: "模拟异常验收", startDate: "2026-10-01", endDate: "2026-10-01" },
    201,
  );
  const items = [0, 1].map((i) => ({
    id: randomUUID(),
    title: "模拟活动" + i,
    date: "2026-10-01",
    start: 600 + i * 90,
    duration: 60,
    locked: i === 0,
    place: "原地点",
    notes: "",
    position: i,
  }));
  trip = await api(`/trips/${trip.id}/operations`, "POST", {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    operations: items.map((activity) => ({ type: "add", activity })),
  });
  set({
    tripId: trip.id,
    otherTripId: a.tripId,
    revision: trip.revision,
    fixedId: items[0].id,
    requestId: randomUUID(),
  });
  const ask = async (mode) => {
    set({ mode });
    const run = await api(
      `/trips/${trip.id}/chat`,
      "POST",
      { requestId: randomUUID(), message: "模拟 " + mode },
      202,
    );
    return complete(run.id, trip.id);
  };
  let run = await ask("model-failure");
  assert.equal(run.status, "failed");
  assert.equal(run.requests, 1);
  checks.push("模型429记录失败，不宣称成功");
  const usage = await api("/usage");
  assert.ok(usage.totals.some((t) => t.provider === "model-mock"));
  assert.ok(usage.recent.some((r) => r.endpoint === "POST /auth/login"));
  checks.push("新登录的模型调用与认证日志同会话可见");
  run = await ask("wrong-trip");
  assert.ok(
    run.events.some((e) => e.name === "get_trip" && e.status === "failed"),
  );
  checks.push("聊天MCP拒绝同账号其他行程");
  run = await ask("fixed");
  assert.ok(
    run.events.some(
      (e) => e.name === "propose_trip_change" && e.status === "failed",
    ),
  );
  assert.equal((await api("/trips/" + trip.id)).revision, trip.revision);
  checks.push("AI固定时间提案拒绝，权威状态未变");
  run = await ask("unknown-tool");
  assert.equal(run.status, "failed");
  checks.push("未注册工具拒绝");
  set({ mode: "cancel" });
  const cancelled = await api(
    `/trips/${trip.id}/chat`,
    "POST",
    { requestId: randomUUID(), message: "模拟取消" },
    202,
  );
  await api(
    `/trips/${trip.id}/chat`,
    "POST",
    { requestId: randomUUID(), message: "并发消息" },
    409,
  );
  await api(`/trips/${trip.id}/chat/${cancelled.id}/stop`, "POST", {});
  const stopped = await complete(cancelled.id, trip.id);
  assert.equal(stopped.status, "cancelled");
  checks.push("停止中断模型请求；同用户并发消息拒绝");
  await api(`/trips/${trip.id}/chat`, "POST", {
    requestId: cancelled.id,
    message: "模拟取消",
  });
  await api(
    `/trips/${trip.id}/chat`,
    "POST",
    { requestId: cancelled.id, message: "重复ID不同内容" },
    409,
  );
  checks.push("聊天消息幂等与重复ID冲突");
  // User chooses mock fixtures only in this separate test trip.
  const candidates = await api("/places/search?query=模拟&city=大同");
  const entity = (i) => candidates[i];
  await api(
    `/trips/${trip.id}/operations`,
    "POST",
    {
      expectedRevision: trip.revision,
      requestId: randomUUID(),
      operations: [
        {
          type: "bind_entity",
          id: items[1].id,
          entity: { ...entity(1), longitude: 115 },
        },
      ],
    },
    422,
  );
  checks.push("伪造坐标候选证明拒绝");
  set({
    entity: entity(1),
    activityId: items[1].id,
    revision: trip.revision,
    requestId: randomUUID(),
  });
  set({ mode: "recommend" });
  const recommendation = await api(
    `/trips/${trip.id}/chat`,
    "POST",
    { requestId: randomUUID(), message: "推荐大同餐厅" },
    202,
  );
  const options = await complete(recommendation.id, trip.id);
  const selected = options.candidates[0];
  set({ mode: "bind-entity", candidateId: selected.candidateId });
  const binding = await api(
    `/trips/${trip.id}/chat`,
    "POST",
    {
      requestId: randomUUID(),
      message: "选择这个地点并关联到活动",
      selectedCandidateId: selected.candidateId,
    },
    202,
  );
  const boundProposal = await complete(binding.id, trip.id);
  assert.ok(
    boundProposal.events.some(
      (e) => e.name === "propose_trip_change" && e.status === "done",
    ),
  );
  assert.ok(!(await api("/trips/" + trip.id)).activities[1].entityId);
  checks.push("AI可通过真实MCP提案选择候选，但确认前不绑定");
  trip = await api(`/trips/${trip.id}/operations`, "POST", {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    operations: [{ type: "edit", id: items[0].id, patch: { locked: false } }],
  });
  trip = await api(`/trips/${trip.id}/operations`, "POST", {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    operations: items.map((a, i) => ({
      type: "bind_entity",
      id: a.id,
      entity: entity(i),
    })),
  });
  set({ mode: "route-failure" });
  let rows = await api(`/trips/${trip.id}/transitions/refresh`, "POST", {
    force: true,
  });
  assert.equal(rows[0].estimate.status, "unknown");
  assert.equal(rows[0].estimate.durationSeconds, null);
  checks.push("高德配额失败显示未知，不伪造零耗时");
  // Sprint10: quota cooldown prevents a forced network retry. End the simulated
  // cooldown explicitly so this separate scenario actually has an in-flight call.
  const cooldownSql = (
    await import("../apps/api/node_modules/postgres/src/index.js")
  ).default(
    `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
    { max: 1 },
  );
  await cooldownSql`UPDATE travel_operational_facts SET fact=jsonb_set(fact,'{retryAfter}','null'::jsonb) WHERE trip_id=${trip.id} AND kind='route_estimate'`;
  await cooldownSql.end();
  set({ mode: "late-route" });
  const pending = api(`/trips/${trip.id}/transitions/refresh`, "POST", {
    force: true,
  });
  await new Promise((r) => setTimeout(r, 150));
  trip = await api(`/trips/${trip.id}/operations`, "POST", {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    operations: [
      { type: "edit", id: items[1].id, patch: { place: "已改变地点" } },
    ],
  });
  rows = await pending;
  assert.equal(rows[0].fingerprint, null);
  assert.equal(rows[0].estimate, null);
  checks.push("晚返回的旧路线不写入新地点连接");
  const owner = JSON.parse(
    readFileSync(".runtime/live-chat-case.json", "utf8"),
  );
  const foreign = await fetch(base + "/trips/" + trip.id + "/chat", {
    headers: { Authorization: "Bearer " + owner.token },
  });
  assert.equal(foreign.status, 404);
  checks.push("跨用户聊天隔离");
  const postgres = (
      await import("../apps/api/node_modules/postgres/src/index.js")
    ).default,
    sql = postgres(
      `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
      { max: 1 },
    );
  const interruptedId = randomUUID();
  await sql`INSERT INTO travel_chat_runs(id,user_id,trip_id,state) SELECT ${interruptedId},user_id,${trip.id},${sql.json({ id: interruptedId, tripId: trip.id, message: "模拟重启", status: "running", events: [], requests: 0, inputTokens: 0, outputTokens: 0, createdAt: new Date().toISOString() })} FROM travel_trips WHERE id=${trip.id}`;
  await sql.end();
  const recovered = await api(`/trips/${trip.id}/chat`);
  assert.ok(
    recovered.some((r) => r.message === "模拟重启" && r.status === "cancelled"),
  );
  checks.push("中断后的持久化聊天标记取消");
  writeFileSync(
    "verification/next-failures.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        mode: "isolated API + injected mock providers; zero real model/map calls",
        checks,
      },
      null,
      2,
    ),
  );
  console.log(checks.length + "项模拟异常与隔离检查通过，无真实外部请求");
} finally {
  apiProcess.kill();
}
