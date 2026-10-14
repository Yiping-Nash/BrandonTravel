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
    trip.title = "Sprint18首次使用验收";
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
    let writes = 0;
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
    await expect(page.locator("[data-day-header]")).toHaveCount(7); // Three-day Trip.
    await page.getByRole("button", { name: "编辑日期", exact: true }).click();
    const seventh = new Date(Date.parse(today + "T00:00:00Z") + 6 * 86400000)
      .toISOString()
      .slice(0, 10);
    await page.getByLabel("行程结束日期").fill(seventh);
    await page
      .getByRole("button", { name: "确认修改日期", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await expect(page.locator("[data-day-header]")).toHaveCount(7); // Seven-day Trip.
    const beforeFactsRevision = trip.revision;
    await page
      .getByRole("button", { name: "资料更新选项", exact: true })
      .click();
    await page.getByRole("button", { name: "仅更新天气", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector(".bt-day-weather")?.textContent.includes("°"),
    );
    await page.screenshot({
      path: `.runtime/weekly-first-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page
        .locator("[data-day-header]")
        .first()
        .locator(".bt-weather-city")
        .count(),
      1,
      "同城两个地点只展示一张天气卡",
    );
    const headingSizes = await page
      .locator("[data-day-header]")
      .first()
      .evaluate((el) => ({
        weekday: getComputedStyle(el.querySelector("[data-weekday]")).fontSize,
        date: getComputedStyle(el.querySelector("[data-date]")).fontSize,
      }));
    assert.equal(headingSizes.weekday, headingSizes.date);
    assert.equal(await page.locator(".bt-weather-icon").count(), 1);

    await page
      .getByRole("button", { name: "资料更新选项", exact: true })
      .click();
    await page.getByRole("button", { name: "仅更新路程", exact: true }).click();
    await page
      .locator(".travel-timeline-transition")
      .filter({ hasText: "43分钟" })
      .waitFor();
    assert.match(
      await page.locator(".travel-timeline-transition").first().innerText(),
      /空档30分.*少13分/,
    );
    assert.equal(trip.revision, beforeFactsRevision);
    weatherOverride = true;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("travel-facts-updated")),
    );
    await expect(
      page.locator("[data-day-header]").first().locator(".bt-weather-city"),
    ).toHaveCount(3);
    assert.match(
      await page.locator("[data-day-header]").first().innerText(),
      /另1城/,
    );
    assert.equal(
      await page
        .locator("[data-day-header]")
        .first()
        .getByRole("status")
        .count(),
      0,
    );
    await page.locator("[data-day-header]").first().getByRole("button").click();
    await expect(page.getByRole("dialog").getByText(/深圳/)).toBeVisible();
    await page.keyboard.press("Escape");
    weatherOverride = false;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("travel-facts-updated")),
    );
    await expect(
      page.locator("[data-day-header]").first().locator(".bt-weather-city"),
    ).toHaveCount(1);
    if (width === 1440) {
      const label = page.locator(".travel-timeline-transition").first();
      const labelBox = await label.boundingBox();
      const x = labelBox.x + labelBox.width / 2,
        y = labelBox.y + labelBox.height + 6;
      assert.equal(
        await page.evaluate(
          ({ x, y }) =>
            !!document
              .elementFromPoint(x, y)
              ?.closest(".travel-timeline-transition"),
          { x, y },
        ),
        false,
        "连接标签下面空白不被透明按钮接管",
      );
      await page.mouse.click(x, y);
      await page.getByRole("dialog").waitFor();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(trip.revision, beforeFactsRevision);
      await label.click();
      await expect(
        page
          .locator(".travel-route-panel")
          .getByRole("button", { name: "收起", exact: true }),
      ).toBeVisible();
    }

    const first = page.locator(
      '[data-block-id="' + trip.activities[0].id + '"]',
    );
    const h = (await first.boundingBox()).height;
    await page
      .getByRole("button", { name: "增加时间密度", exact: true })
      .click();
    await page.waitForFunction(
      ({ id, h }) =>
        document
          .querySelector(`[data-block-id="${id}"]`)
          .getBoundingClientRect().height >
        h + 10,
      { id: trip.activities[0].id, h },
    );
    if (width === 1440) {
      await first.scrollIntoViewIfNeeded();
      const expectedStart = trip.activities[0].start + 30;
      const box = await first.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 18);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 58, { steps: 12 });
      await page.mouse.up();
      await first.getByText("10:30–11:30", { exact: true }).waitFor();
      assert.equal(trip.activities[0].start, expectedStart);
      await page
        .getByRole("button", { name: "编辑日期", exact: true })
        .waitFor();
      await expect(
        page.getByRole("button", { name: "编辑日期", exact: true }),
      ).toBeEnabled();
      await first.locator('[data-resize="bottom"]').scrollIntoViewIfNeeded();
      const bottom = await first
        .locator('[data-resize="bottom"]')
        .boundingBox();
      assert.equal(
        await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.getAttribute("data-resize"),
          { x: bottom.x + bottom.width / 2, y: bottom.y + 2 },
        ),
        "bottom",
      );
      await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + 2);
      await page.mouse.down();
      await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + 22, {
        steps: 8,
      });
      await page.mouse.up();
      await first.getByText("10:30–11:45", { exact: true }).waitFor();
      assert.equal(trip.activities[0].duration, 75);
      const beforeCancel = JSON.stringify(trip);
      const cancelBox = await first.boundingBox();
      await page.mouse.move(cancelBox.x + 30, cancelBox.y + 20);
      await page.mouse.down();
      await page.mouse.move(cancelBox.x + 30, cancelBox.y + 60, { steps: 8 });
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.equal(JSON.stringify(trip), beforeCancel);
      const fixed = page.locator(`[data-block-id="${trip.activities[1].id}"]`);
      assert.equal(await fixed.locator('[data-resize="bottom"]').count(), 0);
    }
    assert.equal(
      await page.getByRole("button", { name: "日视图", exact: true }).count(),
      0,
    );
    assert.equal(await page.locator("[data-day-header]").count(), 7);
    const header = page.locator("[data-day-header]").first();
    assert.equal(
      await header
        .getByRole("button", { name: "获取天气", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await header.getByRole("button", { name: "路程", exact: true }).count(),
      0,
    );
    const metrics = await page.locator(".bt-calendar").evaluate((el) => ({
      width: el.clientWidth,
      headerWidth: el.querySelector("[data-day-header]").getBoundingClientRect()
        .width,
    }));
    assert.ok(
      Math.abs(
        metrics.headerWidth -
          (metrics.width - (width === 390 ? 48 : 56)) / (width === 390 ? 4 : 7),
      ) < 2,
      "可见列宽按七/四列计算",
    );
    if (width === 1440) {
      await page.getByRole("button", { name: "选择模式", exact: true }).click();
      await first.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 100));
      const b = await first.boundingBox();
      const sx = b.x + b.width / 2 - 20,
        sy = b.y - 8,
        ex = sx + 40,
        ey = sy + 28;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(ex, ey, { steps: 6 });
      const band = await page.locator("[data-selection-band]").boundingBox();
      assert.ok(
        Math.abs(band.x - sx) < 1 &&
          Math.abs(band.y - sy) < 1 &&
          Math.abs(band.width - 40) < 1,
        "Portal框选不漂移",
      );
      await page
        .locator("[data-radix-scroll-area-viewport]")
        .first()
        .evaluate((el) => (el.scrollTop += 8));
      await expect(page.getByText("已选择1项", { exact: false })).toBeVisible();
      await page.mouse.up();
      assert.equal(await page.locator("[data-selection-band]").count(), 0);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
    }
    await page.getByRole("button", { name: "查看提醒 ⌄" }).click();
    await page.getByText("资料覆盖与待补信息", { exact: true }).waitFor();
    if (width === 1440) {
      await page
        .locator(".bt-issue")
        .filter({ hasText: "重叠" })
        .getByRole("button", { name: "定位到活动 →" })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-block-id][data-selected="true"]')
            .length === 2,
      );
    }

    await page.getByRole("button", { name: "选择模式", exact: true }).click();
    await first.press("Enter");
    await page.getByRole("button", { name: "批量移动", exact: true }).click();
    const startBeforeBatch = trip.activities[0].start;
    await page.getByLabel("平移分钟", { exact: true }).fill("15");
    await page
      .getByRole("button", { name: "确认整体平移", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(trip.activities[0].start, startBeforeBatch + 15);
    await page.getByRole("button", { name: "选择模式", exact: true }).click();
    await first.click();
    await page
      .getByRole("button", { name: "批量退回待安排", exact: true })
      .click();
    await first.waitFor({ state: "hidden" });
    assert.equal(trip.activities[0].start, null);
    assert.equal(trip.activities[0].backlogOriginDate, today);
    await page
      .locator(
        `[data-pending-id="${trip.activities[0].id}"] .travel-card-title`,
      )
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("开始时间（留空待安排）", { exact: true })
      .fill("10:00");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await first.waitFor();
    assert.equal(trip.activities[0].start, 600);
    assert.ok(!trip.activities[0].backlogOriginDate);
    await page.getByRole("button", { name: "＋ 活动", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    const saveBox = await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .boundingBox();
    assert.ok(saveBox.y >= 0 && saveBox.y + saveBox.height <= 1000);
    await page.screenshot({
      path: `verification/frontend-v2-weekly-activity-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("dialog")
      .getByLabel("标题", { exact: true })
      .fill("V2新增活动");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.ok(trip.activities.some((a) => a.title === "V2新增活动"));
    await page.getByRole("button", { name: "编辑日期", exact: true }).click();
    await page.getByLabel("行程结束日期").fill(today);
    await page
      .getByRole("button", { name: "确认修改日期", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      trip.activities.find((a) => a.title === "远日活动").start,
      null,
    );
    assert.equal(
      trip.activities.find((a) => a.title === "远日活动").backlogOriginDate,
      originalRangeEnd,
    );
    await page.reload();
    await page
      .getByRole("heading", { name: trip.title, exact: true, level: 1 })
      .waitFor();
    assert.equal(
      await page.locator("[data-day-header]").count(),
      7,
      "三天以内仍补齐七列",
    );
    const outside = new Date(Date.parse(today + "T00:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
    await page.locator(".bt-calendar").evaluate((el) => (el.scrollLeft = 0));
    const outsideCol = page.locator(
      `[data-day-column][data-calendar-date="${outside}"]`,
    );
    await outsideCol.scrollIntoViewIfNeeded();
    const outer = await outsideCol.boundingBox(),
      viewport = await page
        .locator(".bt-calendar [data-radix-scroll-area-viewport]")
        .boundingBox();
    await page.mouse.click(outer.x + outer.width / 2, viewport.y + 100);
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("dialog")
      .getByLabel("标题", { exact: true })
      .fill("范围外新活动");
    const originalRevision = trip.revision;
    page.once("dialog", (d) => d.dismiss());
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    assert.equal(trip.revision, originalRevision);
    assert.equal(trip.endDate, today);
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(trip.endDate, outside);
    assert.equal(trip.revision, originalRevision + 1);
    assert.ok(
      trip.activities.some(
        (a) => a.title === "范围外新活动" && a.date === outside,
      ),
    );
    await page.getByRole("button", { name: "编辑日期", exact: true }).click();
    const tenth = new Date(Date.parse(today + "T00:00:00Z") + 9 * 86400000)
      .toISOString()
      .slice(0, 10);
    await page.getByLabel("行程结束日期").fill(tenth);
    await page
      .getByRole("button", { name: "确认修改日期", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await expect(page.locator("[data-day-header]")).toHaveCount(14);
    await page.locator(".bt-calendar").evaluate((el) => (el.scrollLeft = 0));
    const headerBox = await page
        .locator("[data-day-header]")
        .first()
        .boundingBox(),
      axis = await page.locator("[data-hour-axis]").first().boundingBox();
    await page.locator(".bt-calendar").evaluate((el) => (el.scrollLeft = 400));
    await expect
      .poll(() =>
        page
          .locator("[data-hour-axis]")
          .first()
          .boundingBox()
          .then((b) => Math.round(b.x)),
      )
      .toBe(Math.round(axis.x));
    assert.ok(
      Math.abs(
        (await page.locator("[data-day-header]").first().boundingBox()).x -
          (headerBox.x - 400),
      ) < 2,
    );
    await page.locator(".bt-calendar").evaluate((el) => (el.scrollLeft = 0));
    const area = await page.locator(".bt-calendar").boundingBox();
    await page.mouse.move(area.x + area.width / 2, area.y + 40);
    await page.mouse.wheel(250, 0);
    await expect
      .poll(() => page.locator(".bt-calendar").evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    if (width === 1440) {
      await page.locator(".bt-calendar").evaluate((el) => (el.scrollLeft = 0));
      await page.mouse.move(area.x + area.width / 2, area.y + 180);
      await page.mouse.click(area.x + area.width / 2, area.y + 180, {
        button: "middle",
      });
      await expect(page.locator(".bt-calendar")).toHaveAttribute(
        "data-panning",
        "true",
      );
      await page.mouse.move(area.x + area.width / 2 + 80, area.y + 180);
      await expect
        .poll(() =>
          page.locator(".bt-calendar").evaluate((el) => el.scrollLeft),
        )
        .toBeGreaterThan(30);
      await page.keyboard.press("Escape");
      await expect(page.locator(".bt-calendar")).toHaveAttribute(
        "data-panning",
        "false",
      );
    }
    if (width === 1440) {
      await page.locator(".bt-calendar").scrollIntoViewIfNeeded();
      await page
        .locator(".bt-calendar")
        .evaluate((el) => (el.scrollLeft = 400));
      await page.getByRole("button", { name: "选择模式", exact: true }).click();
      const grid = await page.locator(".bt-calendar").boundingBox();
      const viewport = await page
        .locator("[data-radix-scroll-area-viewport]")
        .first()
        .boundingBox();
      const x = grid.x + grid.width / 2,
        y = Math.max(grid.y + 130, viewport.y + 20);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(grid.x - 50, y + 50, { steps: 5 });
      const band = await page.locator("[data-selection-band]").boundingBox();
      const axisBox = await page
        .locator("[data-hour-axis]")
        .first()
        .boundingBox();
      assert(
        band.x >= axisBox.x + axisBox.width - 1,
        "横向滚动后框选不侵入时间轴",
      );
      assert.equal(
        await page.locator("[data-selected=true]").count(),
        0,
        "屏幕外活动不进入框选",
      );
      await page.mouse.up();
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await expect
      .poll(() => page.locator(".bt-calendar").evaluate((el) => el.scrollLeft))
      .toBe(0);
    await page.getByRole("button", { name: "✦ 问 Brandon" }).click();
    await page.getByRole("complementary", { name: "Brandon助手" }).waitFor();
    await page.screenshot({
      path: `verification/frontend-v2-weekly-brandon-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal(queries, 2);
    assert.equal(await page.locator(".bt-error").count(), 0);
    await page.screenshot({
      path: `verification/frontend-v2-weekly-workspace-${width}.png`,
      fullPage: true,
    });
    const revision = trip.revision;
    await page.getByRole("link", { name: "切换旧版" }).click();
    await page.locator(".travel-app").waitFor();
    await expect(page.locator(".travel-app")).toHaveAttribute(
      "data-trip-id",
      trip.id,
    );
    assert.equal(trip.revision, revision);
    assert.equal(await page.locator(".bt-v2").count(), 0);
    await page.screenshot({
      path: `verification/frontend-v2-weekly-legacy-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "返回新版", exact: true }).click();
    await page
      .getByRole("heading", { name: trip.title, exact: true, level: 1 })
      .waitFor();
    await page.getByRole("button", { name: "＋ 活动", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page
        .locator(".travel-form-fields")
        .evaluate((el) => getComputedStyle(el).display),
      "grid",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    checks.push({
      width,
      dashboard: true,
      theme: true,
      create: true,
      range: true,
      group: true,
      density: true,
      legacy: true,
      compactMultiCityWeather: true,
      transitionHitArea: width === 1440,
      preciseBand: width === 1440,
      continuousColumns: true,
      horizontalNavigation: true,
      outsideCreationAtomic: true,
      densityDragAndResize: width === 1440,
      issuePairLocation: width === 1440,
      selectionAndBatch: true,
      legacyRoundTripStyle: true,
      returnAndReschedule: true,
      explicitMockQueries: queries,
      realProviderRequests: 0,
      weatherAndRouteProjection: true,
      writes,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/frontend-v2-weekly-browser.json",
    JSON.stringify(
      { checks, errors, modelRequests: 0, externalRequests: 0 },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser.close();
}
