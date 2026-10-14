import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const base = "http://127.0.0.1:4332",
  checks = [],
  runs = [];
let headers = { "Content-Type": "application/json", "X-Travel-Test": "true" },
  calls = 0;
async function api(path, method = "GET", body, extra = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { ...headers, ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.ok(r.ok, `${path}: ${r.status}: ${d.error?.message}`);
  return d.data;
}
const login = await api("/auth/login", "POST", {
  email: a.email,
  password: a.password,
});
headers.Authorization = "Bearer " + login.token;
const beforeUsage = await api("/travel/usage");
let trip = await api("/travel/trips", "POST", {
  title: "Sprint07真实模型与路程隔离验收",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
});
const items = ["华严寺", "善化寺", "朋友提到的小院"].map((title, i) => ({
  id: randomUUID(),
  title,
  notes: "隔离测试活动",
  place: "地点待确认",
  date: i === 2 ? "2026-10-02" : "2026-10-01",
  start: i === 0 ? 645 : i === 1 ? 780 : 540,
  duration: 60,
  locked: false,
  position: i,
}));
trip = await api(`/travel/trips/${trip.id}/operations`, "POST", {
  requestId: randomUUID(),
  expectedRevision: trip.revision,
  operations: items.map((activity) => ({ type: "add", activity })),
});
const candidates = await Promise.all(
  ["华严寺", "善化寺"].map((query) =>
    api(
      `/travel/places/search?${new URLSearchParams({ query, city: "大同" })}`,
    ),
  ),
);
const chosen = candidates.map(
  (rows, i) =>
    rows.find((e) => e.name === items[i].title) ??
    rows.find((e) => e.name.includes(items[i].title)),
);
assert.ok(chosen.every(Boolean), "必须存在真实候选，不伪造地点");
trip = await api(`/travel/trips/${trip.id}/operations`, "POST", {
  requestId: randomUUID(),
  expectedRevision: trip.revision,
  operations: chosen.map((entity, i) => ({
    type: "bind_entity",
    id: items[i].id,
    entity,
  })),
});
let rows = await api(`/travel/trips/${trip.id}/transitions/refresh`, "POST", {
  force: true,
});
assert.equal(rows[0].mode, "driving");
assert.equal(rows[0].estimate.status, "ready");
assert.ok(rows[0].estimate.durationSeconds > 0);
checks.push("真实高德默认驾车距离/耗时，计划revision不增加");
assert.equal((await api(`/travel/trips/${trip.id}`)).revision, trip.revision);
trip = await api(`/travel/trips/${trip.id}/operations`, "POST", {
  requestId: randomUUID(),
  expectedRevision: trip.revision,
  operations: [
    {
      type: "transition_mode",
      fromId: items[0].id,
      toId: items[1].id,
      mode: "walking",
    },
  ],
});
rows = await api(`/travel/trips/${trip.id}/transitions/refresh`, "POST", {
  force: true,
});
assert.equal(rows[0].mode, "walking");
assert.equal(rows[0].estimate.status, "ready");
checks.push("真实高德显式步行保留并重新估计");
async function ask(message) {
  assert.ok(calls < 10);
  const run = await api(
    `/travel/trips/${trip.id}/chat`,
    "POST",
    { requestId: randomUUID(), message },
    { "X-Travel-Model-Limit": String(Math.min(6, 10 - calls)) },
  );
  let done;
  const deadline = Date.now() + 95000;
  while (Date.now() < deadline) {
    done = (await api(`/travel/trips/${trip.id}/chat`)).find(
      (r) => r.id === run.id,
    );
    if (done.status !== "running") break;
    await new Promise((r) => setTimeout(r, 600));
  }
  assert.ok(done && done.status !== "running");
  calls += done.requests;
  assert.ok(calls <= 10);
  runs.push(done);
  console.log("真实聊天", done.outcome, done.requests, "次请求");
  return done;
}
const revision = trip.revision;
const result = await ask(
  "第一天（10月1日）华严寺提早到十点，第二天（10月2日）朋友提到的小院改到十二点，时长不变，两项一起提出修改建议，不要直接执行。",
);
assert.equal(result.outcome, "proposal_created", JSON.stringify(result.events));
const receipt = result.events.find((e) => e.proposalId);
assert.ok(receipt);
const proposal = await api("/travel/proposals/" + receipt.proposalId);
assert.equal(
  proposal.after.activities.find((e) => e.id === items[0].id).start,
  600,
);
assert.equal(
  proposal.after.activities.find((e) => e.id === items[2].id).start,
  720,
);
assert.equal((await api(`/travel/trips/${trip.id}`)).revision, revision);
checks.push("真实千问多项提案、host结束验证、确认前不变");
await api(`/travel/proposals/${proposal.id}/confirm`, "POST");
trip = await api(`/travel/trips/${trip.id}`);
assert.equal(trip.activities.find((e) => e.id === items[0].id).start, 600);
checks.push("用户确认后事务执行，读取一致");
const clarified = await ask(
  "周一华严寺提早到十点，周二朋友提到的小院改到十二点",
);
assert.equal(clarified.outcome, "needs_clarification");
assert.equal(clarified.requests, 0);
checks.push("原反馈日期歧义澄清，无额外模型费");
const readonly = await ask(
  "检查第一天华严寺到善化寺的路程是否来得及，仅读取和解释，不提出修改。",
);
assert.equal(readonly.outcome, "answered", JSON.stringify(readonly.events));
assert.ok(readonly.events.some((e) => e.name === "get_transitions"));
checks.push("真实千问MCP路线查询，手动确认后读取最新行程");
const usage = await api("/travel/usage");
writeFileSync(
  "verification/sprint07-live.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      tripId: trip.id,
      checks,
      calls,
      inputTokens: runs.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: runs.reduce((n, r) => n + r.outputTokens, 0),
      runs: runs.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        requests: r.requests,
        tools: r.events
          .filter((e) => e.kind === "tool")
          .map((e) => ({ name: e.name, status: e.status })),
      })),
      usageBefore: beforeUsage,
      usageAfter: usage,
    },
    null,
    2,
  ),
);
console.log(
  checks.length + "项真实模型/高德验收完成；模型共" + calls + "次请求",
);
