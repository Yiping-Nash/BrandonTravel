import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { validateTrip, conflicts } from "../apps/api/src/travel/domain.ts";
import { importFutureSamples } from "../apps/web/src/components/travel/future-samples.ts";
const a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const input = JSON.parse(
  readFileSync("fixtures/travel/future-plans.json", "utf8"),
);
const faults = JSON.parse(
  readFileSync("fixtures/travel/timetable-faults.json", "utf8"),
);
const cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8"));
const pg = (await import("../apps/api/node_modules/postgres/src/index.js"))
  .default;
const sql = pg(
  `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
  { max: 1 },
);
const evidence = {
  date: new Date().toISOString(),
  checks: [],
  targetAccountImport: "pending-normal-login",
  providerRequests: 0,
  modelRequests: 0,
  status: "running",
  trips: [],
};
const hash = (t) =>
  createHash("sha256").update(JSON.stringify(t)).digest("hex");
let browser;
try {
  const loginResponse = await fetch("http://127.0.0.1:4332/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: a.email, password: a.password }),
  });
  assert.ok(loginResponse.ok);
  const login = (await loginResponse.json()).data;
  const api = async (p, method = "GET", body) => {
    const r = await fetch("http://127.0.0.1:4332/travel" + p, {
      method,
      headers: {
        Authorization: "Bearer " + login.token,
        "Content-Type": "application/json",
        "X-Travel-Test": "true",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await r.json();
    assert.ok(r.ok, `${p}: ${r.status} ${d.error?.message ?? ""}`);
    return d.data;
  };
  const allBefore = await sql`SELECT id,state FROM travel_trips ORDER BY id`;
  const saved = new Map(allBefore.map((t) => [t.id, hash(t.state)]));
  const externalBefore = (
    await sql`SELECT count(*)::int AS count FROM travel_api_usage WHERE provider IN ('model','amap')`
  )[0].count;
  for (const f of input.fixtures) {
    validateTrip(f.trip);
    assert.equal(conflicts(f.trip).length, 0);
    assert.equal(f.trip.activities.filter((a) => a.start === null).length, 3);
    assert.ok(
      f.trip.activities.every(
        (a) => !a.entityId && a.notes.includes("模拟测试"),
      ),
    );
  }
  for (const c of faults.cases) validateTrip(c.trip);
  assert.ok(conflicts(faults.cases[0].trip).length);
  const route = faults.cases.find((c) => c.key === "route-shortage");
  const [from, to] = route.trip.activities;
  assert.equal(
    Math.ceil(route.mockFacts[0].durationSeconds / 60) -
      (to.start - from.start - from.duration),
    13,
  );
  evidence.checks.push(
    "两条主样例合法、无重叠；未定位与模拟备注明确",
    "五个隔离副本合法；当前重叠规则命中、13分钟输入算术正确",
  );
  // Exercise the exact UI importer with normal account authentication first.
  const imported = await importFutureSamples(api);
  evidence.trips = imported.map((t) => ({
    id: t.id,
    title: t.title,
    activities: t.activities.length,
    revision: t.revision,
    startDate: t.startDate,
    endDate: t.endDate,
    testAccountOnly: true,
  }));
  for (let i = 0; i < imported.length; i++) {
    const t = await api("/trips/" + imported[i].id);
    assert.deepEqual(t.activities, input.fixtures[i].trip.activities);
  }
  const count = (await api("/trips")).length;
  const again = await importFutureSamples(api);
  assert.equal((await api("/trips")).length, count);
  assert.deepEqual(
    again.map((t) => t.id),
    imported.map((t) => t.id),
  );
  assert.deepEqual(
    again.map((t) => t.revision),
    imported.map((t) => t.revision),
  );
  evidence.checks.push(
    "真实共享REST持久化并重新读取一致",
    "重复导入不新增行程或revision",
  );
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors = [];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/transitions/refresh", (r) =>
      r.fulfill({ json: { success: true, data: [] } }),
    );
    await page.route("**/places/search?**", (r) => r.abort());
    await page.goto("http://127.0.0.1:4331/login");
    await page.locator("input[type=email]").fill(a.email);
    await page.locator("input[type=password]").fill(a.password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL("**/app");
    await page
      .getByRole("button", { name: "载入未来模拟样例", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "两条未来模拟样例已载入" })
      .waitFor();
    for (const t of imported) {
      await page.getByLabel("选择行程").selectOption(t.id);
      await page.getByRole("heading", { name: t.title, exact: true }).waitFor();
      await page.reload();
      await page.getByLabel("选择行程").selectOption(t.id);
      await page.getByRole("heading", { name: t.title, exact: true }).waitFor();
    }
    await page.screenshot({
      path: `verification/future-samples-${width}.png`,
      fullPage: true,
    });
    await page.close();
    evidence.checks.push(
      `${width}px正常登录、按钮导入及刷新后重新选择两条持久样例`,
    );
  }
  assert.deepEqual(errors, []);
  assert.equal((await api("/trips")).length, count);
  const allAfter = await sql`SELECT id,state FROM travel_trips ORDER BY id`;
  for (const t of allAfter)
    if (saved.has(t.id))
      assert.equal(hash(t.state), saved.get(t.id), "既有行程改变");
  const externalAfter = (
    await sql`SELECT count(*)::int AS count FROM travel_api_usage WHERE provider IN ('model','amap')`
  )[0].count;
  assert.equal(externalAfter, externalBefore);
  evidence.checks.push(
    "全库既有行程状态未改变；本轮真实高德／模型均为0",
    "浏览器无pageerror；故障模拟事实未导入任何账号",
  );
  evidence.status = "passed";
  writeFileSync(
    "verification/future-samples.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: evidence.status,
      checks: evidence.checks.length,
      trips: evidence.trips,
      target: evidence.targetAccountImport,
    }),
  );
} catch (error) {
  evidence.status = "failed";
  evidence.error = error instanceof Error ? error.message : "验收失败";
  writeFileSync(
    "verification/future-samples.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  throw error;
} finally {
  if (browser) await browser.close();
  await sql.end();
}
