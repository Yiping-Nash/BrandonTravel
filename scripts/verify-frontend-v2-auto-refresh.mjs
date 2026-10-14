import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
await import("../apps/api/node_modules/tsx/dist/loader.mjs");
const { weatherLocation } =
  await import("../packages/utils/src/travel-weather-location.ts");
const { buildIntelligenceSnapshot } =
  await import("../packages/utils/src/travel-inspection.ts");
const { applyOperations } = await import("../apps/api/src/travel/domain.ts");
const original = JSON.parse(
    readFileSync("verification/sprint12-ui-fixture.json", "utf8"),
  ),
  account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
try {
  for (const width of [1440]) {
    const trip = structuredClone(original.trip);
    trip.title = "Sprint18首次使用验收";
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
    trip.activities.push({
      ...trip.activities[0],
      id: randomUUID(),
      title: "远日活动",
      date: trip.endDate,
      start: 600,
      locked: false,
    });
    trip.activities.push({
      ...trip.activities[0],
      id: randomUUID(),
      title: "待安排样例",
      date: null,
      start: null,
      locked: false,
    });
    const originalRangeEnd = trip.endDate;
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
    const legacyWeather = seed.find(
      (f) =>
        f.value?.kind === "weather" && f.value.dataKind === "daily_forecast",
    );
    for (let i = seed.length - 1; i >= 0; i--)
      if (seed[i].kind === "weather") seed.splice(i, 1);
    for (const e of trip.entities) {
      const f = structuredClone(legacyWeather),
        p = weatherLocation(e);
      f.id = randomUUID();
      f.value.providerId = "open-meteo";
      f.value.regionCode = p.key;
      f.value.regionName = p.name;
      f.subjectKey = p.key + ":daily_forecast";
      f.appliesTo.regionRef = p.key;
      seed.push(f);
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
    let mockNow = Date.now(),
      failRefresh = false,
      holdRefresh = false,
      releaseRefresh;
    const requestKinds = [];
    let facts = [],
      version = 0,
      queries = 0,
      readFailure = false,
      weatherOverride = false;
    const snap = () =>
      buildIntelligenceSnapshot(
        trip,
        facts,
        original.facts.sources,
        version,
        {},
        new Date(mockNow),
      );
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    await page.addInitScript(() =>
      localStorage.setItem("bt-auto-facts:v2", "false"),
    );
    await page.clock.install({ time: new Date(mockNow) });
    await page.clock.pauseAt(new Date(mockNow));
    page.on("pageerror", (e) => errors.push(e.message));
    let writes = 0;
    await page.context().route("**/api/travel/**", async (r) => {
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
      if (path === "/exchange-rates")
        data = {
          base: "CNY",
          date: today,
          rates: { CNY: 1, USD: 0.14, EUR: 0.12, JPY: 20, GBP: 0.1, HKD: 1.1 },
          source: "fixture",
          queriedAt: new Date().toISOString(),
          cache: true,
          stale: false,
        };
      else if (path.endsWith("/chat")) data = [];
      else if (
        path.endsWith("/operations") &&
        r.request().method() === "POST"
      ) {
        const body = r.request().postDataJSON();
        try {
          if (body.expectedRevision !== trip.revision)
            throw new Error("版本冲突");
          const result = applyOperations(trip, body.operations, "user");
          Object.assign(trip, result);
          writes++;
          data = trip;
        } catch (e) {
          return r.fulfill({
            status: 409,
            json: { success: false, error: { message: e.message } },
          });
        }
      } else if (path === "/trips") data = [trip, other];
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
        if (weatherOverride) {
          const d = data.days[0],
            r = d.regions.find((r) => r.status === "AVAILABLE");
          d.cities = ["广州", "佛山", "珠海", "深圳"];
          d.regions = d.cities.map((city, i) => ({
            ...r,
            id: "synthetic-city-" + i,
            name: city,
            dayCondition: "晴",
            lowTemperature: 10 + i,
            highTemperature: 20 + i,
          }));
        }
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
        requestKinds.push(b.kinds);
        if (holdRefresh)
          await new Promise((resolve) => (releaseRefresh = resolve));
        if (failRefresh)
          return r.fulfill({
            status: 503,
            json: { success: false, error: { message: "模拟供应商失败" } },
          });
        assert.deepEqual(
          [...b.dates].sort(),
          [
            ...new Set(
              trip.activities
                .filter((a) => a.date && a.start !== null)
                .map((a) => a.date),
            ),
          ].sort(),
        );
        assert.equal(b.force, false);
        const selected = seed.filter((f) => b.kinds.includes(f.kind));
        facts = [
          ...facts.filter((f) => !b.kinds.includes(f.kind)),
          ...selected,
        ];
        for (const f of selected) {
          f.expiresAt = new Date(
            mockNow + (f.kind === "weather" ? 6 * 3600000 : 20 * 60000),
          ).toISOString();
        }
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
    await page.waitForURL("http://127.0.0.1:4331/");
    await page
      .getByRole("heading", { name: "我的旅行", exact: true })
      .waitFor();
    assert.equal(await page.locator(".bt-trip-card").count(), 2);
    await page.getByLabel("外观").selectOption("teal");
    assert.equal(
      await page.locator(".bt-v2").first().getAttribute("data-theme"),
      "teal",
    );
    await page.screenshot({
      path: `verification/frontend-v2-weekly-dashboard-${width}.png`,
      fullPage: true,
    });
    await page.locator(".bt-trip-card").first().click();
    await page
      .getByRole("heading", { name: trip.title, exact: true, level: 1 })
      .waitFor();
    await page
      .locator('[data-block-id="' + trip.activities[0].id + '"]')
      .waitFor();

    const revision = trip.revision;
    const settle = async () => {
      await page.clock.runFor(1500);
      await page.waitForTimeout(300);
    };
    await settle();
    assert.equal(queries, 0, "关闭自动时纯读取不刷新");
    await page
      .getByRole("button", { name: "资料更新选项", exact: true })
      .click();
    await page.getByRole("checkbox", { name: "自动更新当前行程" }).check();
    await settle();
    await expect.poll(() => queries).toBe(1);
    await expect.poll(() => facts.length).toBeGreaterThan(0);
    await settle();
    assert.equal(queries, 1, "新鲜资料不重复刷新");
    // Server snapshot clock and browser timer clock advance together.
    const advance = async (ms) => {
      mockNow += ms;
      await page.clock.fastForward(ms);
      await settle();
      await settle();
    };
    await advance(21 * 60000);
    await expect.poll(() => queries).toBe(2);
    assert.deepEqual(requestKinds.at(-1), ["route_estimate"]);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(6 * 3600000);
    assert.equal(queries, 2, "模拟隐藏页面不查询");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    await expect.poll(() => queries).toBe(3);
    assert(requestKinds.at(-1).includes("weather"));
    assert(requestKinds.at(-1).includes("route_estimate"));
    failRefresh = true;
    await advance(21 * 60000);
    await expect.poll(() => queries).toBe(4);
    await advance(2 * 60000);
    assert.equal(queries, 4, "失败五分钟内不重试");
    failRefresh = false;
    await advance(4 * 60000);
    await expect.poll(() => queries).toBe(5);
    assert.equal(trip.revision, revision, "事实刷新不改计划版本");
    await page.getByRole("checkbox", { name: "自动更新当前行程" }).uncheck();
    await advance(7 * 3600000);
    assert.equal(queries, 5, "关闭自动后停止调度");
    holdRefresh = true;
    await page
      .getByRole("button", { name: "更新全部天气与路程", exact: true })
      .click();
    await expect.poll(() => queries).toBe(6);
    const second = await page.context().newPage();
    await second.goto("http://127.0.0.1:4331/trips/" + trip.id);
    await second
      .getByRole("heading", { name: trip.title, exact: true, level: 1 })
      .waitFor();
    await second
      .getByRole("button", { name: "更新全部天气与路程", exact: true })
      .click();
    await second
      .getByRole("button", { name: "资料更新选项", exact: true })
      .click();
    await expect(second.locator(".bt-refresh-menu")).toContainText(
      "其他页面正在更新",
    );
    assert.equal(queries, 6, "真实Web Locks阻止双标签重复请求");
    holdRefresh = false;
    releaseRefresh();
    await page.waitForTimeout(300);
    await second.close();
    checks.push({
      crossTabLock: true,
      width,
      visibleAutomatic: true,
      route20Minutes: true,
      weather6Hours: true,
      hiddenPaused: true,
      resumeOnce: true,
      failureCooldown: true,
      disabledStops: true,
      readOnlyRevision: true,
      simulatedRefreshes: queries,
      requestKinds,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(
  "verification/frontend-v2-auto-refresh.json",
  JSON.stringify(
    {
      checks,
      errors,
      actualProviderRequests: 0,
      actualModelRequests: 0,
      clock: "模拟时钟与模拟visibility；真实Edge页面",
    },
    null,
    2,
  ),
);
assert.equal(errors.length, 0);
console.log(JSON.stringify(checks));
