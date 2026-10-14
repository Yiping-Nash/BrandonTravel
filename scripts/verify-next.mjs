import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
const a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const base = "http://127.0.0.1:4331/api/travel";
let checks = [];
const headers = {
  Authorization: "Bearer " + a.token,
  "Content-Type": "application/json",
  "X-Travel-Test": "true",
};
async function api(path, method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.ok(r.ok, `${path} ${r.status}: ${d.error?.message}`);
  return d.data;
}
let t = await api("/trips", "POST", {
  title: "地图与聊天验收",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
});
async function mutate(operations) {
  t = await api(`/trips/${t.id}/operations`, "POST", {
    requestId: randomUUID(),
    expectedRevision: t.revision,
    operations,
  });
  return t;
}
const items = ["华严寺", "善化寺", "待安排甲", "待安排乙"].map((title, i) => ({
  id: randomUUID(),
  title,
  date: i < 2 ? "2026-10-01" : null,
  start: i < 2 ? 600 + i * 120 : null,
  duration: 60,
  position: i,
  locked: false,
  place: title,
  notes: "",
}));
await mutate(items.map((activity) => ({ type: "add", activity })));
await mutate([{ type: "reorder_pending", ids: [items[3].id, items[2].id] }]);
assert.equal(t.activities.find((x) => x.id === items[3].id).position, 0);
checks.push("完整排序原子保存");
await mutate([
  { type: "edit", id: items[1].id, patch: { start: null, position: 10 } },
]);
assert.equal(t.activities.find((x) => x.id === items[1].id).date, "2026-10-01");
checks.push("返回待安排保留日期与身份");
await mutate([{ type: "edit", id: items[1].id, patch: { start: 720 } }]);
const entities = [];
for (const query of ["华严寺", "善化寺"]) {
  const list = await api(
    "/places/search?" + new URLSearchParams({ query, city: "大同" }),
  );
  assert.ok(list.length);
  entities.push(list.find((x) => x.name === query) ?? list[0]);
}
checks.push("真实高德地点候选查询");
await mutate(
  entities.map((entity, i) => ({
    type: "bind_entity",
    id: items[i].id,
    entity,
  })),
);
assert.equal(t.entities.length, 2);
checks.push("用户确认绑定稳定地点引用");
const rev = t.revision;
let transitions = await api(`/trips/${t.id}/transitions/refresh`, "POST", {
  force: false,
});
assert.equal(transitions.length, 1);
assert.equal(transitions[0].estimate.status, "ready");
assert.ok(transitions[0].estimate.distanceMeters >= 0);
const walking = transitions[0];
assert.equal((await api(`/trips/${t.id}`)).revision, rev);
checks.push("真实高德步行估计不改计划版本");
const before = await api("/usage");
await api(`/trips/${t.id}/transitions/refresh`, "POST", { force: false });
const after = await api("/usage");
assert.ok(
  after.totals.find((x) => x.provider === "amap" && x.status === "cache")
    .count >= 1,
);
assert.equal(
  after.totals
    .filter((x) => x.provider === "amap" && x.status === "success")
    .reduce((s, x) => s + x.count, 0),
  before.totals
    .filter((x) => x.provider === "amap" && x.status === "success")
    .reduce((s, x) => s + x.count, 0),
);
checks.push("15分钟缓存不重复调用高德");
await mutate([
  {
    type: "transition_mode",
    fromId: items[0].id,
    toId: items[1].id,
    mode: "driving",
  },
]);
transitions = await api(`/trips/${t.id}/transitions`);
assert.equal(transitions[0].estimate, null);
transitions = await api(`/trips/${t.id}/transitions/refresh`, "POST", {
  force: false,
});
assert.equal(transitions[0].estimate.status, "ready");
checks.push("方式变化使旧估计失效并查询真实驾车");
const inspection = await api(`/trips/${t.id}/inspection`);
assert.ok(inspection.operations.length);
assert.ok(inspection.operations[0].before && inspection.operations[0].after);
checks.push("检查器记录修改前后");
const usage = await api("/usage");
assert.ok(usage.totals.some((x) => x.provider === "internal"));
assert.ok(usage.recent.every((x) => !("apiKey" in x)));
checks.push("本登录全部旅行及高德调用可见，无凭据");
const cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8"));
const postgres = (
  await import("../apps/api/node_modules/postgres/src/index.js")
).default;
const sql = postgres(
  `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
  { max: 1 },
);
const jwtSession = createHash("sha256")
  .update("Bearer " + a.token)
  .digest("hex");
await sql`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status) SELECT ${randomUUID()},user_id,'different-session','amap','test','acceptance','success' FROM travel_trips WHERE id=${t.id}`;
const scoped = await api("/usage");
assert.ok(!scoped.recent.some((x) => x.endpoint === "test"));
await sql.end();
checks.push("同用户其他登录记录隔离");
writeFileSync(
  ".runtime/next-account.json",
  JSON.stringify({ ...a, tripId: t.id }),
);
writeFileSync(
  "verification/next-api.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      checks,
      walking: {
        distanceMeters: walking.estimate.distanceMeters,
        durationSeconds: walking.estimate.durationSeconds,
      },
      driving: {
        distanceMeters: transitions[0].estimate.distanceMeters,
        durationSeconds: transitions[0].estimate.durationSeconds,
      },
      externalCalls: 4,
    },
    null,
    2,
  ),
);
console.log(
  `${checks.length}项下一阶段API检查通过；实际高德2次搜索+2次路径查询`,
);
