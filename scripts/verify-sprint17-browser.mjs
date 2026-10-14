import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
await import("../apps/api/node_modules/tsx/dist/loader.mjs");
const { buildIntelligenceSnapshot } =
  await import("../packages/utils/src/travel-inspection.ts");
const original = JSON.parse(
    readFileSync("verification/sprint12-ui-fixture.json", "utf8"),
  ),
  account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
try {
  for (const width of [1440, 390]) {
    const trip = structuredClone(original.trip);
    trip.title = "Sprint17首次使用验收";
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Shanghai",
    });
    trip.startDate = today;
    trip.endDate = new Date(Date.parse(today + "T00:00:00Z") + 5 * 86400000)
      .toISOString()
      .slice(0, 10);
    trip.activities = trip.activities.slice(0, 2);
    trip.activities.forEach((a, i) => {
      a.date = today;
      a.start = 600 + i * 90;
      a.duration = 60;
    });
    const seed = structuredClone(original.facts.facts);
    for (const f of seed) {
      f.freshness = "fresh";
      f.expiresAt = new Date(Date.now() + 3600000).toISOString();
      if (f.value?.kind === "route_estimate") {
        f.value.durationSeconds = 2580;
        f.value.distanceMeters = 3150;
      }
      if (
        f.value?.kind === "weather" &&
        f.value.dataKind === "daily_forecast"
      ) {
        f.value.days = f.value.days.slice(0, 1);
        f.value.days[0].date = today;
        f.appliesTo.dates = [today];
      }
    }
    const other = {
      ...structuredClone(trip),
      id: randomUUID(),
      title: "另一条零资料行程",
      entities: [],
      activities: trip.activities.map((a) => ({
        ...a,
        id: randomUUID(),
        entityId: undefined,
      })),
    };
    let delayRead = false,
      enteredRead,
      releaseRead;
    let facts = [],
      version = 0,
      queries = 0,
      readFailure = false;
    const snap = () =>
      buildIntelligenceSnapshot(
        trip,
        facts,
        original.facts.sources,
        version,
        {},
      );
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/travel/**", async (r) => {
      const path = new URL(r.request().url()).pathname.replace(
        "/api/travel",
        "",
      );
      let data;
      if (path.includes(other.id)) {
        const snapshot = buildIntelligenceSnapshot(other, [], [], 0, {});
        data = path.endsWith("/intelligence-snapshot")
          ? snapshot
          : path.endsWith("/kernel")
            ? {
                ...other,
                schemaVersion: 2,
                activities: other.activities.map((a) => ({
                  ...a,
                  environment: "unspecified",
                })),
              }
            : path.endsWith("/transitions")
              ? snapshot.connections.map((c) => ({
                  ...c,
                  gapMinutes: c.gapSeconds / 60,
                  freshness: "unknown",
                  estimate: null,
                }))
              : path.includes("/proposals")
                ? { items: [], total: 0, historyTotal: 0, nextCursor: null }
                : path.includes("/operational-facts")
                  ? {
                      facts: [],
                      sources: [],
                      gaps: [],
                      tripRevision: other.revision,
                      factsVersion: 0,
                      nextCursor: null,
                    }
                  : other;
        return r.fulfill({ json: { success: true, data } });
      }
      if (path === "/trips") data = [trip, other];
      else if (path === "/trips/" + trip.id) data = trip;
      else if (path.endsWith("/kernel"))
        data = {
          ...trip,
          schemaVersion: 2,
          activities: trip.activities.map((a) => ({
            ...a,
            environment: "unspecified",
          })),
        };
      else if (path.endsWith("/intelligence-snapshot")) {
        if (readFailure)
          return r.fulfill({
            status: 503,
            json: { success: false, error: { message: "模拟读取失败" } },
          });
        if (delayRead) {
          delayRead = false;
          enteredRead();
          await new Promise((resolve) => (releaseRead = resolve));
        }
        data = snap();
      } else if (path.includes("/operational-facts"))
        data = {
          facts,
          sources: original.facts.sources,
          gaps: [],
          tripRevision: trip.revision,
          factsVersion: version,
          nextCursor: null,
        };
      else if (path.endsWith("/intelligence/refresh")) {
        queries++;
        const b = r.request().postDataJSON();
        assert.deepEqual(b.dates, [today]);
        assert.equal(b.force, false);
        const selected = seed.filter((f) => b.kinds.includes(f.kind));
        facts = [
          ...facts.filter((f) => !b.kinds.includes(f.kind)),
          ...selected,
        ];
        version++;
        data = {
          attempted: selected.length,
          succeeded: selected.length,
          failed: 0,
          blocked: 0,
          cooldown: 0,
          cache: 0,
          discarded: 0,
        };
      } else if (path.endsWith("/transitions"))
        data = snap().connections.map((c) => ({
          ...c,
          gapMinutes: c.gapSeconds / 60,
          freshness: c.state === "UNKNOWN" ? "unknown" : "fresh",
          fingerprint: "mock",
          estimate:
            c.durationSeconds === null
              ? null
              : {
                  status: "ready",
                  distanceMeters: c.distanceMeters,
                  durationSeconds: c.durationSeconds,
                  source: "amap",
                  queriedAt: new Date().toISOString(),
                },
        }));
      else if (path.includes("/proposals"))
        data = { items: [], total: 0, historyTotal: 0, nextCursor: null };
      else
        return r.fulfill({
          status: 400,
          json: { success: false, error: { message: "测试阻止未知请求" } },
        });
      return r.fulfill({ json: { success: true, data } });
    });
    await page.goto("http://127.0.0.1:4331/login");
    await page.locator("input[type=email]").fill(account.email);
    await page.locator("input[type=password]").fill(account.password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL("**/app");
    await page.goto("http://127.0.0.1:4331/travel");
    await page
      .getByRole("heading", { name: trip.title, exact: true })
      .waitFor();
    const day = page.locator('[data-weather-date="' + today + '"]');
    await day.getByText(/点击获取将先取得地点详情/).waitFor();
    await page
      .locator(".travel-timeline-transition")
      .getByText(/路程未查询/)
      .waitFor();
    assert.equal(queries, 0);
    const future = page.locator('[data-weather-date="' + trip.endDate + '"]');
    assert.equal(
      await future.getByRole("button", { name: "获取当天天气" }).count(),
      0,
    );
    checks.push(width + "零资料未查询/未知连接可见/空日及范围外没有查询按钮");
    const viewport = page.locator(
      ".travel-grid [data-radix-scroll-area-viewport]",
    );
    const manualScroll = await viewport.evaluate((el) => {
      el.scrollTop += 32;
      return el.scrollTop;
    });
    const readAgain = page.waitForResponse((r) =>
      r.url().includes("/intelligence-snapshot"),
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("travel-facts-updated")),
    );
    await readAgain;
    assert.equal(await viewport.evaluate((el) => el.scrollTop), manualScroll);
    checks.push(width + "只读刷新保留手动滚动位置");
    const revision = trip.revision;
    await day
      .getByRole("button", { name: "获取当天天气", exact: true })
      .click();
    await day.getByText("已取得日级预报", { exact: true }).waitFor();
    assert.equal(trip.revision, revision);
    assert.equal(queries, 1);
    assert.equal(
      await page
        .locator(".travel-timeline-transition")
        .getByText(/路程未查询/)
        .count(),
      1,
    );
    checks.push(
      width + "首次天气日期限定/预报不依赖环境/不修改计划/不隐式查询路线",
    );
    await page
      .getByRole("button", {
        name: today.slice(5) + " 获取当天路程",
        exact: true,
      })
      .click();
    await page
      .locator(".travel-timeline-transition")
      .getByText(/约43分钟.*少13分/)
      .waitFor();
    await page
      .getByRole("button", { name: "展开方位与路程", exact: true })
      .click();
    await page
      .locator(".travel-route-panel")
      .getByText(/3.1公里.*约43分钟/)
      .waitFor();
    await page
      .locator(".travel-route-panel")
      .getByText(/少13分钟/)
      .waitFor();
    checks.push(width + "首次路程耗时/不足13分钟在时间表与方位模块一致");
    await day.locator("summary").filter({ hasText: "当天注意事项" }).click();
    const notices = await day.innerText();
    assert.doesNotMatch(notices, /缺少现实资料/);
    checks.push(width + "当天缺口按资料类型汇总且实际冲突优先");
    for (const f of facts)
      if (f.kind === "route_estimate") {
        f.expiresAt = new Date(Date.now() - 1000).toISOString();
        f.freshness = "stale";
      }
    version++;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("travel-facts-updated")),
    );
    await page
      .locator(".travel-timeline-transition")
      .getByText(/估计已过期/)
      .waitFor();
    assert.equal(
      await page
        .locator(".travel-timeline-transition")
        .getByText(/约43分钟/)
        .count(),
      0,
    );
    assert.equal(queries, 2);
    checks.push(width + "过期不回退旧耗时/只读更新不调用外部");
    readFailure = true;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("travel-facts-updated")),
    );
    await page
      .locator(".travel-intelligence")
      .getByRole("alert")
      .getByText(/模拟读取失败/)
      .waitFor();
    await page
      .locator(".travel-timeline-transition")
      .getByText(/检查读取中/)
      .waitFor();
    readFailure = false;
    await page
      .getByRole("button", { name: "重试读取（不查询供应商）" })
      .click();
    await page
      .locator(".travel-timeline-transition")
      .getByText(/估计已过期/)
      .waitFor();
    assert.equal(queries, 2);
    checks.push(width + "Snapshot失败有明确错误/连接保留/纯读重试恢复");
    await page.screenshot({
      path: "verification/sprint17-" + width + ".png",
      fullPage: true,
    });
    const entered = new Promise((resolve) => (enteredRead = resolve));
    delayRead = true;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("travel-facts-updated")),
    );
    await entered;
    await page.locator("select").first().selectOption(other.id);
    await page
      .getByRole("heading", { name: other.title, exact: true })
      .waitFor();
    releaseRead();
    await page
      .getByText("先为活动绑定真实地点，再获取天气", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByText("已取得日级预报", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .locator(".travel-timeline-transition")
        .getByText(/约43分钟/)
        .count(),
      0,
    );
    assert.equal(queries, 2);
    checks.push(width + "切换行程后旧Snapshot晚返回不覆盖新行程");
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint17-browser.json",
    JSON.stringify(
      { checks, passed: checks.length, providerRequests: 0, modelRequests: 0 },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  await browser.close();
}
