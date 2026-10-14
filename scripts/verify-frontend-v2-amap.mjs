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
  for (const width of [1440, 390]) {
    const trip = structuredClone(original.trip);
    trip.title = "双地图隔离验收";
    trip.activities[1].entityId = trip.activities[0].entityId;
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Shanghai",
    });
    trip.startDate = today;
    trip.endDate = new Date(Date.parse(today + "T00:00:00Z") + 2 * 86400000)
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
      );
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.addInitScript(() =>
      localStorage.setItem("bt-auto-facts:v2", "false"),
    );
    page.on("pageerror", (e) => errors.push(e.message));
    let writes = 0,
      missingConfig = false;
    let delayConfig = false,
      enteredConfig,
      releaseConfig;
    const mapEvents = [];
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
      if (path === "/map/config") {
        if (delayConfig) {
          enteredConfig();
          await new Promise((resolve) => (releaseConfig = resolve));
        }
        if (missingConfig)
          return r.fulfill({
            status: 503,
            json: {
              success: false,
              error: {
                message:
                  "尚未配置高德Web端（JS API）Key与安全密钥；Web服务Key不能替代",
              },
            },
          });
        data = {
          key: "fixture-key-only",
          version: "2.0",
          serviceHost: "/api/amap-map/_AMapService",
        };
      } else if (path === "/map/events") {
        mapEvents.push(r.request().postDataJSON());
        data = { recorded: true };
      } else if (path === "/exchange-rates")
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
    await page.route("https://webapi.amap.com/loader.js", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: `
window.__amap={loads:0,destroys:0,fits:0,centers:0,zooms:0,layers:[],styles:[],fail:false};
class FakeMap{constructor(el,options){this.el=el;this.zoom=11;this.items=[];this.options=options;}on(name,cb){if(name==='complete')setTimeout(cb,5);}off(){}addControl(){}add(items){for(const i of [].concat(items)){this.items.push(i);if(i.content)this.el.appendChild(i.content);}}remove(items){items.forEach(i=>i.content?.remove());}setMapStyle(s){window.__amap.styles.push(s);}setLayers(ls){window.__amap.layers.push(ls.map(l=>l.kind));}setFitView(){window.__amap.fits++;}setCenter(){window.__amap.centers++;}getZoom(){return this.zoom;}setZoom(z){this.zoom=z;window.__amap.zooms++;}destroy(){this.el.replaceChildren();window.__amap.destroys++;}}
class Marker{constructor(o){Object.assign(this,o);}}class Polyline{constructor(o){Object.assign(this,o);}}class TileLayer{constructor(){this.kind='normal';}}
TileLayer.Satellite=class{constructor(){this.kind='satellite';}};TileLayer.RoadNet=class{constructor(){this.kind='roadnet';}};
window.AMapLoader={reset(){},load(opts){window.__amap.loads++;if(window.__amap.fail)return Promise.reject(new Error('fixture failed'));return Promise.resolve({Map:FakeMap,Marker,Polyline,TileLayer,Scale:class{},ToolBar:class{}});}};`,
      }),
    );
    await page.route(
      /https:\/\/(?:webapi|restapi|webrd|wprd)[^/]*\.amap\.com\/(?!loader\.js)/,
      (r) => r.abort(),
    );
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

    const before = trip.revision;
    assert.equal(
      await page.locator(".travel-amap-canvas").count(),
      0,
      "默认不初始化SDK",
    );
    await page
      .getByRole("button", { name: "展开方位与路程", exact: true })
      .click();
    await expect(page.getByLabel("地图模式")).toHaveValue("simple");
    const simpleTitles = await page
      .locator("svg [data-map-point] title")
      .allTextContents();
    await page.getByLabel("地图模式").selectOption("amap");
    await expect(page.locator(".travel-amap-canvas")).toBeVisible();
    await page
      .getByRole("button", { name: "适配全部地点", exact: true })
      .waitFor();
    await expect(
      page.getByRole("button", { name: "放大高德地图", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".travel-amap-marker")).toHaveCount(1);
    assert.equal(simpleTitles.length, 2);
    await page.locator(".travel-amap-marker").click();
    await expect(page.getByRole("group", { name: "同地点活动" })).toBeVisible();
    await page
      .getByRole("group", { name: "同地点活动" })
      .getByRole("button")
      .first()
      .click();
    await expect(page.locator(".travel-amap-marker")).toHaveAttribute(
      "data-selected",
      "true",
    );
    const fit = await page.evaluate(() => window.__amap.fits),
      centers = await page.evaluate(() => window.__amap.centers);
    for (const style of ["normal", "light", "grey", "whitesmoke"])
      await page.getByLabel("高德地图样式").selectOption(style);
    assert.equal(
      await page.evaluate(() => window.__amap.fits),
      fit,
      "样式切换不重置视野",
    );
    assert.equal(await page.evaluate(() => window.__amap.centers), centers);
    await page.getByLabel("高德底图").selectOption("satellite");
    await expect(page.getByLabel("高德地图样式")).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.__amap.layers.at(-1)), [
      "satellite",
      "roadnet",
    ]);
    await page.getByLabel("高德底图").selectOption("simple");
    await expect(page.getByLabel("高德地图样式")).toHaveValue("whitesmoke");
    await page
      .getByRole("button", { name: "放大高德地图", exact: true })
      .click();
    await page
      .getByRole("button", { name: "缩小高德地图", exact: true })
      .click();
    assert.equal(await page.evaluate(() => window.__amap.zooms), 2);
    await page.getByLabel("方位图日期").selectOption("all");
    await expect(page.locator(".travel-amap-marker")).toHaveCount(1);
    await page
      .getByRole("button", { name: "适配全部地点", exact: true })
      .click();
    assert((await page.evaluate(() => window.__amap.fits)) > fit);
    await page.screenshot({
      path: "verification/frontend-v2-amap-" + width + ".png",
      fullPage: true,
    });
    const destroyed = await page.evaluate(() => window.__amap.destroys);
    await page
      .locator(".travel-route-heading")
      .getByRole("button", { name: "收起", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => window.__amap.destroys),
      destroyed + 1,
    );
    await page
      .getByRole("button", { name: "展开方位与路程", exact: true })
      .click();
    await expect(page.getByLabel("地图模式")).toHaveValue("amap");
    await expect(
      page.getByRole("button", { name: "放大高德地图", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("地图模式").selectOption("simple");
    assert.equal(await page.locator(".travel-amap-canvas").count(), 0);
    await page.evaluate(() => (window.__amap.fail = true));
    await page.getByLabel("地图模式").selectOption("amap");
    await expect(page.locator(".travel-amap [role=alert]")).toContainText(
      "鉴权或SDK加载失败",
    );
    await page.evaluate(() => (window.__amap.fail = false));
    await page
      .getByRole("button", { name: "重试高德地图", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "放大高德地图", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("地图模式").selectOption("simple");
    missingConfig = true;
    await page.getByLabel("地图模式").selectOption("amap");
    await expect(page.locator(".travel-amap [role=alert]")).toContainText(
      "Web服务Key不能替代",
    );
    await page.getByRole("button", { name: "切回简易图", exact: true }).click();
    await expect(page.getByLabel("地图模式")).toHaveValue("simple");
    missingConfig = false;
    delayConfig = true;
    const entered = new Promise((resolve) => (enteredConfig = resolve));
    const beforeLoads = await page.evaluate(() => window.__amap.loads);
    await page.getByLabel("地图模式").selectOption("amap");
    await entered;
    await page.getByLabel("地图模式").selectOption("simple");
    releaseConfig();
    delayConfig = false;
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => window.__amap.loads),
      beforeLoads,
      "旧配置晚返回不初始化地图",
    );
    assert.equal(await page.locator(".travel-amap-canvas").count(), 0);
    assert.equal(trip.revision, before);
    assert.equal(writes, 0);
    assert.equal(queries, 0);
    await page.getByRole("link", { name: "切换旧版", exact: true }).click();
    await page.getByLabel("选择行程").waitFor();
    await expect(page.getByLabel("地图模式")).toHaveCount(0);
    assert(mapEvents.some((e) => e.event === "initialized"));
    assert(mapEvents.some((e) => e.event === "load_failed"));
    assert(mapEvents.some((e) => e.event === "destroyed"));
    checks.push({
      width,
      lateResponseDiscarded: true,
      defaultLazy: true,
      overlapSelection: true,
      sharedNumbering: true,
      styleAndSatellite: true,
      preserveCamera: true,
      zoomControls: true,
      dateFilterAndFit: true,
      collapseDestroy: true,
      preferences: true,
      retry: true,
      missingCredentials: true,
      legacyUnchanged: true,
      planWrites: writes,
      factRefreshes: queries,
      mapEvents: mapEvents.map((e) => e.event),
    });
    await page.close();
  }
} finally {
  await browser.close();
}
assert.deepEqual(errors, []);
writeFileSync(
  "verification/frontend-v2-amap-browser.json",
  JSON.stringify(
    {
      checks,
      errors,
      actualSdkInitializations: 0,
      actualProviderRequests: 0,
      modelRequests: 0,
      method: "真实Edge，模拟官方Loader/地图实现；不代表真实底图接通",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(checks));
