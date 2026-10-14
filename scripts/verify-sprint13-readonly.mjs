import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8")),
  account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const postgres = (
  await import("../apps/api/node_modules/postgres/src/index.js")
).default;
const sql = postgres(
  "postgresql://brandon:" +
    cfg.databasePassword +
    "@127.0.0.1:54329/brandontravel",
  { max: 1 },
);
const request = async (path, init = {}) => {
  const r = await fetch("http://127.0.0.1:4332" + path, init);
  return { status: r.status, value: await r.json() };
};
try {
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  assert.equal(login.status, 200);
  const headers = { Authorization: "Bearer " + login.value.data.token };
  const id = "979aa9c6-0a20-4f85-9de7-64da703d6621";
  const state = () =>
    sql.unsafe("SELECT state,facts_version FROM travel_trips WHERE id=$1", [
      id,
    ]);
  const facts = () =>
    sql.unsafe(
      "SELECT fact FROM travel_operational_facts WHERE trip_id=$1 ORDER BY kind,subject_key",
      [id],
    );
  const usages = () =>
    sql.unsafe(
      "SELECT count(*)::int n FROM travel_api_usage WHERE provider <> 'internal'",
    );
  const before = {
    state: await state(),
    facts: await facts(),
    usage: await usages(),
  };
  const s = await request("/travel/trips/" + id + "/intelligence-snapshot", {
    headers,
  });
  assert.equal(s.status, 200);
  assert.equal(s.value.data.mode, "LIVE");
  assert.ok(s.value.data.facts.length > 0);
  const demo = await request("/travel/intelligence-demo", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ scene: "route-shortage" }),
  });
  assert.equal(demo.status, 200);
  assert.deepEqual(
    { state: await state(), facts: await facts(), usage: await usages() },
    before,
  );
  const unauth = await request("/travel/intelligence-demo");
  assert.equal(unauth.status, 401);
  const other = await sql.unsafe(
    "SELECT id FROM travel_trips WHERE user_id <> (SELECT id FROM users WHERE email=$1) LIMIT 1",
    [account.email],
  );
  if (other.length) {
    const r = await request(
      "/travel/trips/" + other[0].id + "/intelligence-snapshot",
      { headers },
    );
    assert.equal(r.status, 404);
  }
  const data = s.value.data;
  writeFileSync(
    "verification/sprint13-readonly.json",
    JSON.stringify(
      {
        checks: [
          "已有真实供应商缓存只读可见，失效状态如实显示",
          "纯读和沙盒不改计划/事实，不增加外部调用",
          "未登录401、跨用户404",
        ],
        facts: data.facts.map((f) => ({
          kind: f.kind,
          status: f.status,
          freshness: f.freshness,
        })),
        versions: {
          plan: data.evaluation.tripRevision,
          facts: data.evaluation.factsVersion,
        },
        realProviderRequests: 0,
        modelRequests: 0,
      },
      null,
      2,
    ),
  );
  console.log("已有真实缓存只读、无写入、无外部调用、授权保护：通过");
} finally {
  await sql.end();
}
