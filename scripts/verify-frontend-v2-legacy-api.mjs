import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { Client } from "../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
const base = "http://127.0.0.1:4331/api";
const results = [];
const check = (name, condition) => {
  assert.ok(condition, name);
  results.push({ name, status: "通过" });
};
let token, key;
async function req(path, method = "GET", body, expected = 200, agent = false) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(agent
        ? { "X-Travel-Key": key }
        : { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(
    r.status,
    expected,
    `${method} ${path}: ${JSON.stringify(data)}`,
  );
  return data;
}
const existing = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const { email, password } = existing;
token = (await req("/auth/login", "POST", { email, password })).data.token;
check("既有隔离账号登录（不新增密码文件）", true);
const user = (await req("/auth/me")).data;
check("会话读取", user.email === email);
let trip = (
  await req(
    "/travel/trips",
    "POST",
    { title: "验收行程", startDate: "2026-10-01", endDate: "2026-10-03" },
    201,
  )
).data;
const a = {
  id: randomUUID(),
  title: "华严寺",
  notes: "示例",
  place: "华严寺",
  date: "2026-10-01",
  start: 630,
  duration: 90,
  locked: false,
  position: 0,
};
const b = {
  ...a,
  id: randomUUID(),
  title: "固定返程",
  date: "2026-10-03",
  start: 1050,
  duration: 30,
  locked: true,
  position: 1,
};
async function mutate(ops, status = 200, input) {
  const payload = input || {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    operations: ops,
  };
  const r = await req(
    `/travel/trips/${trip.id}/operations`,
    "POST",
    payload,
    status,
  );
  if (status === 200) trip = r.data;
  return r;
}
await mutate([
  { type: "add", activity: a },
  { type: "add", activity: b },
]);
check("创建活动", trip.activities.length === 2);
const repeated = {
  expectedRevision: trip.revision,
  requestId: randomUUID(),
  operations: [
    { type: "edit", id: a.id, patch: { date: "2026-10-03", start: 660 } },
  ],
};
await mutate(null, 200, repeated);
await mutate(null, 200, repeated);
check(
  "移动保持身份且重复请求只执行一次",
  trip.activities.filter((x) => x.id === a.id).length === 1 &&
    trip.revision === 2,
);
await mutate(
  [{ type: "edit", id: a.id, patch: { start: 1400, duration: 90 } }],
  422,
);
check("跨午夜拒绝", true);
await mutate([{ type: "edit", id: b.id, patch: { start: 1040 } }], 422);
await mutate([{ type: "delete", id: b.id }], 422);
check("固定活动保护", true);
await mutate(null, 409, { ...repeated, requestId: randomUUID() });
check("旧版本拒绝覆盖", true);
const rollbackRev = trip.revision;
await mutate(
  [
    { type: "edit", id: a.id, patch: { title: "错误批次" } },
    { type: "delete", id: b.id },
  ],
  422,
);
let stored = (await req(`/travel/trips/${trip.id}`)).data;
check(
  "多操作失败原子回滚",
  stored.revision === rollbackRev &&
    stored.activities.find((x) => x.id === a.id).title === "华严寺",
);
await mutate([
  { type: "edit", id: a.id, patch: { date: "2026-10-03", start: 1050 } },
]);
check(
  "重叠允许保存并提示",
  (await req(`/travel/trips/${trip.id}`)).conflicts.length === 1,
);
key = (await req("/travel/keys", "POST", {}, 201)).data.key;
await req(
  `/travel/trips/${trip.id}/operations`,
  "POST",
  {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    operations: [{ type: "delete", id: a.id }],
  },
  403,
  true,
);
check("AI不能直接写入", true);
await req(
  `/travel/trips/${trip.id}/proposals`,
  "POST",
  {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    reason: "越权",
    operations: [
      { type: "edit", id: b.id, patch: { locked: false } },
      { type: "edit", id: b.id, patch: { start: 600 } },
    ],
  },
  403,
  true,
);
check("AI不能两步解除固定", true);
const pInput = {
  expectedRevision: trip.revision,
  requestId: randomUUID(),
  reason: "移动华严寺到第三天11点",
  operations: [
    { type: "edit", id: a.id, patch: { date: "2026-10-03", start: 660 } },
  ],
};
let p = (
  await req(`/travel/trips/${trip.id}/proposals`, "POST", pInput, 201, true)
).data;
const pRepeat = (
  await req(`/travel/trips/${trip.id}/proposals`, "POST", pInput, 201, true)
).data;
check("重复提案去重", pRepeat.id === p.id);
stored = (await req(`/travel/trips/${trip.id}`)).data;
check(
  "提案不修改行程",
  stored.revision === trip.revision &&
    stored.activities.find((x) => x.id === a.id).start === 1050,
);
await req(`/travel/proposals/${p.id}/confirm`, "POST", {}, 403, true);
check("AI不能确认提案", true);
p = (await req(`/travel/proposals/${p.id}/confirm`, "POST", {})).data;
const p2 = (await req(`/travel/proposals/${p.id}/confirm`, "POST", {})).data;
trip = p.result;
check(
  "用户确认且重复确认只执行一次",
  p.status === "applied" &&
    p2.result.revision === trip.revision &&
    trip.activities.find((x) => x.id === a.id).start === 660,
);
const pending = (
  await req(
    `/travel/trips/${trip.id}/proposals`,
    "POST",
    { ...pInput, requestId: randomUUID(), expectedRevision: trip.revision },
    201,
    true,
  )
).data;
await mutate([{ type: "edit", id: a.id, patch: { notes: "用户的新修改" } }]);
await req(`/travel/proposals/${pending.id}/confirm`, "POST", {}, 409);
check("过期提案拒绝", true);
await req(`/travel/proposals/${pending.id}/reject`, "POST", {});
check(
  "拒绝不修改行程",
  (await req(`/travel/trips/${trip.id}`)).data.revision === trip.revision,
);
await mutate([{ type: "edit", id: b.id, patch: { locked: false } }]);
await mutate([{ type: "delete", id: b.id }]);
check("明确解除固定后删除", trip.activities.length === 1);
mkdirSync(".runtime", { recursive: true });
writeFileSync(
  ".runtime/baseline-ui-fixture.json",
  JSON.stringify({ tripId: trip.id }),
);
const client = new Client({ name: "brandontravel-acceptance", version: "1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.cwd() + "/mcp/build/travel-index.js"],
  env: {
    ...process.env,
    TRAVEL_KEY_FILE: process.cwd() + "/.runtime/test-key.json",
    TRAVEL_API_URL: "http://127.0.0.1:4332",
  },
});
await client.connect(transport);
try {
  const tools = await client.listTools();
  check(
    "真实stdio MCP握手及兼容核心工具",
    [
      "list_trips",
      "get_trip",
      "get_proposal",
      "propose_trip_change",
      "search_places",
      "resolve_trip_date",
      "get_transitions",
      "refresh_transitions",
    ].every((name) => tools.tools.some((t) => t.name === name)),
  );
  const read = await client.callTool({
    name: "get_trip",
    arguments: { tripId: trip.id },
  });
  check("MCP读取真实状态", !read.isError);
  const proposal = await client.callTool({
    name: "propose_trip_change",
    arguments: {
      tripId: trip.id,
      expectedRevision: trip.revision,
      requestId: randomUUID(),
      reason: "MCP协议验收",
      operations: [{ type: "edit", id: a.id, patch: { start: 675 } }],
    },
  });
  check("MCP创建提案", !proposal.isError);
  const data = JSON.parse(proposal.content[0].text);
  check("MCP提案结果保持待确认", data.status === "pending");
} finally {
  await client.close();
}
mkdirSync("verification", { recursive: true });
writeFileSync(
  "verification/frontend-v2-legacy-api.json",
  JSON.stringify({ date: "2026-10-06", results }, null, 2),
);
console.log(
  `${results.length} 项 API/MCP 验收通过（不等同于真实 AI 模型验收）`,
);
