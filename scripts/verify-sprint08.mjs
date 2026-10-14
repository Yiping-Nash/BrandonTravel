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
    {
      title: "Sprint08隔离验收",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
    },
    201,
  );
  const activities = [
    {
      id: randomUUID(),
      title: "华严寺",
      notes: "仅详情可见：" + "长备注".repeat(3000),
      place: "地点待确认",
      date: "2026-10-01",
      start: 645,
      duration: 60,
      position: 0,
      locked: false,
    },
    {
      id: randomUUID(),
      title: "返程 · 大同南站",
      notes: "",
      place: "大同南站",
      date: "2026-10-03",
      start: 1050,
      duration: 60,
      position: 1,
      locked: true,
    },
  ];
  trip = await api(`/trips/${trip.id}/operations`, "POST", {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    operations: activities.map((activity) => ({ type: "add", activity })),
  });
  const chat = async (message, extra = {}) => {
    const run = await api(
      `/trips/${trip.id}/chat`,
      "POST",
      { message, requestId: randomUUID(), ...extra },
      202,
    );
    return complete(run.id, trip.id);
  };
  set({ mode: "fixed", tripId: trip.id, fixedId: activities[1].id });
  const fixed = await chat("帮我把大同南站返程提早一小时");
  assert.equal(fixed.requests, 0);
  assert.equal(fixed.outcome, "needs_clarification");
  assert.match(JSON.stringify(fixed.events), /手动解除固定/);
  checks.push("固定保护：0模型请求、不重复解锁");
  set({ mode: "unlock" });
  const unlock = await chat("模拟unlock");
  assert.equal(unlock.requests, 1);
  assert.equal(unlock.outcome, "needs_clarification");
  assert.match(JSON.stringify(unlock.events), /不能固定或解除固定/);
  checks.push("模型尝试解锁被宿主即时拒绝，一轮结束且不调用修改MCP");
  set({ mode: "date-wrong" });
  const corrected = await chat("周六13:00午餐");
  assert.equal(corrected.requests, 3);
  assert.equal(corrected.outcome, "proposal_created");
  let pending = await api(`/trips/${trip.id}/proposals?status=pending`);
  assert.equal(pending.total, 1);
  const proposal = pending.items[0];
  assert.equal(proposal.operations[0].activity.date, "2026-10-03");
  assert.match(JSON.stringify(corrected.events), /2026-10-03/);
  assert.equal((await api(`/trips/${trip.id}`)).revision, trip.revision);
  checks.push("错误周五提案未持久化，纠正周六后才生成提案；日期与星期可审查");
  await api(
    `/trips/${trip.id}/proposals`,
    "POST",
    {
      expectedRevision: trip.revision,
      requestId: randomUUID(),
      reason: "故意伪造日期",
      operations: [
        { type: "edit", id: activities[0].id, patch: { date: "2026-10-02" } },
      ],
      dateConstraints: [
        {
          activityId: activities[0].id,
          date: "2026-10-02",
          expression: "周六",
        },
      ],
    },
    422,
  );
  checks.push("REST同样拒绝伪造日期约束");
  set({ mode: "recommend" });
  const recommendation = await chat("推荐大同周六的餐厅");
  assert.equal(recommendation.outcome, "answered");
  assert.equal(recommendation.requests, 2);
  assert.ok(
    recommendation.candidates.length > 0 &&
      recommendation.candidates.length <= 3,
  );
  assert.equal(
    recommendation.events.filter(
      (e) => e.kind === "tool" && e.name === "search_places",
    ).length,
    1,
  );
  assert.ok(!JSON.stringify(recommendation).includes("selectionProof"));
  assert.match(JSON.stringify(recommendation.events), /口碑.*未知/);
  assert.equal(
    (await api(`/trips/${trip.id}/proposals?status=pending`)).total,
    1,
  );
  checks.push("推荐真实MCP模拟搜索一次，两轮结束，候选不改行程且凭据不公开");
  set({ mode: "recommend-loop" });
  const loop = await chat("推荐大同周六游玩地点");
  assert.ok(loop.requests <= 2);
  assert.equal(loop.outcome, "answered");
  checks.push("模型继续搜索时宿主结束为已有候选回答");
  const chosen = loop.candidates[0];
  set({
    mode: "bind-entity",
    tripId: trip.id,
    activityId: activities[0].id,
    candidateId: chosen.candidateId,
  });
  const bound = await chat(`选择${chosen.name}，安排华严寺`, {
    selectedCandidateId: chosen.candidateId,
  });
  assert.equal(bound.outcome, "proposal_created");
  assert.equal((await api(`/trips/${trip.id}`)).revision, trip.revision);
  checks.push("用户选定才允许候选绑定提案，确认前状态不变");
  set({ mode: "network-once" });
  const network = await chat("读取目前行程，不修改");
  assert.equal(network.requests, 2);
  assert.equal(network.outcome, "answered");
  assert.match(network.diagnostics[0].reason, /重试一次/);
  checks.push("网络失败只在预算内重试一次，并记录诊断");
  set({ mode: "recommend" });
  const noCity = await chat("推荐周六餐厅");
  assert.equal(noCity.outcome, "needs_clarification");
  assert.ok(
    !noCity.events.some((e) => e.kind === "tool" && e.name === "search_places"),
  );
  checks.push("未确认城市且未指定城市时澄清，不让模型猜测搜索");
  const overview = await api(`/trips/${trip.id}/agent?view=overview`),
    receipt = await api(`/proposals/${proposal.id}/agent`);
  assert.ok(!JSON.stringify(overview).includes("长备注"));
  assert.ok(!("before" in receipt) && !("after" in receipt));
  JSON.parse(JSON.stringify(receipt));
  assert.ok(corrected.diagnostics.every((d) => d.contextChars < 20000));
  checks.push("概览和提案回执为有效精简JSON，完整备注按ID读取");
  await api(`/proposals/${proposal.id}/confirm`, "POST", {});
  trip = await api(`/trips/${trip.id}`);
  const reread = (await api(`/trips/${trip.id}/chat`)).find(
    (r) => r.id === corrected.id,
  );
  assert.equal(
    reread.events.find((e) => e.proposalId === proposal.id).proposalStatus,
    "applied",
  );
  checks.push("确认后聊天回执读回已执行状态");
  const pg = (
    await import(
      pathToFileURL(
        path.join(root, "apps/api/node_modules/postgres/src/index.js"),
      ).href
    )
  ).default;
  const sql = pg(
    `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
    { max: 1 },
  );
  try {
    const template = await api(`/proposals/${proposal.id}`);
    for (let i = 0; i < 23; i++) {
      const id = randomUUID(),
        state = {
          ...template,
          id,
          status: "rejected",
          reason: `隔离历史${i}`,
          processedAt: new Date(Date.now() + i * 1000).toISOString(),
        };
      await sql`INSERT INTO travel_proposals(id,user_id,trip_id,state) VALUES(${id},${login.data.user.id},${trip.id},${sql.json(state)})`;
    }
  } finally {
    await sql.end();
  }
  const history = await api(
    `/trips/${trip.id}/proposals?status=history&limit=20`,
  );
  assert.equal(history.items.length, 20);
  assert.equal(history.total, 24);
  assert.equal(history.nextCursor, 20);
  assert.equal(history.items[0].reason, "隔离历史22");
  const next = await api(
    `/trips/${trip.id}/proposals?status=history&limit=20&cursor=20`,
  );
  assert.equal(next.items.length, 4);
  assert.equal(next.nextCursor, null);
  checks.push("待处理与历史隔离，处理时间倒序，每页20条且无重复");
  // Only non-sensitive fixture IDs are persisted. Login credentials remain in memory.
  writeFileSync(
    ".runtime/sprint08-ui-fixture.json",
    JSON.stringify({
      tripId: trip.id,
      activityIds: activities.map((x) => x.id),
    }),
  );
  writeFileSync(
    "verification/sprint08-mock.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        mode: "isolated real MCP + mock providers; zero paid requests",
        checks,
        contextChars: corrected.diagnostics.map((d) => d.contextChars),
        requests: {
          fixed: fixed.requests,
          date: corrected.requests,
          recommend: recommendation.requests,
          searchLoop: loop.requests,
        },
      },
      null,
      2,
    ),
  );
  console.log(checks.length + "项Sprint08隔离验收通过");
} finally {
  apiProcess.kill();
}
