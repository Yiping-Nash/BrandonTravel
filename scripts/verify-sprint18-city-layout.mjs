import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
await import("../apps/api/node_modules/tsx/dist/loader.mjs");
const { buildIntelligenceSnapshot } =
  await import("../packages/utils/src/travel-inspection.ts");
const seed = JSON.parse(
    readFileSync("verification/sprint12-ui-fixture.json", "utf8"),
  ),
  account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const checks = [],
  errors = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const width of [1440, 390]) {
    const trip = structuredClone(seed.trip);
    trip.title = "Sprint18城市与列头验收";
    trip.startDate = "2026-10-13";
    trip.endDate = "2026-10-20";
    trip.activities = trip.activities.slice(0, 2);
    trip.activities.forEach((a, i) => {
      a.date = trip.startDate;
      a.locked = i === 1;
      a.start = 600 + i * 120;
    });
    trip.entities.forEach((e) => (e.city = "大同"));
    const saved = () => JSON.stringify(trip);
    let saves = 0,
      mode = "ready",
      searches = [],
      refreshes = 0;
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/travel/**", async (r) => {
      const u = new URL(r.request().url()),
        p = u.pathname.replace("/api/travel", "");
      let data;
      if (p === "/places/search") {
        const city = u.searchParams.get("city");
        searches.push(city);
        if (mode === "failure")
          return r.fulfill({
            status: 503,
            json: { success: false, error: { message: "模拟地点查询失败" } },
          });
        if (city === "太原") await new Promise((a) => setTimeout(a, 1600));
        data = [
          {
            ...trip.entities[0],
            id: randomUUID(),
            city,
            name: city + "模拟景点",
            poiId: "mock-" + city,
            selectionProof: "mock-only",
          },
        ];
      } else if (p === "/trips") data = [trip];
      else if (p === "/trips/" + trip.id) data = trip;
      else if (p.endsWith("/kernel/operations")) {
        saves++;
        const b = r.request().postDataJSON();
        assert.equal(b.expectedRevision, trip.revision);
        for (const op of b.operations) {
          const a = trip.activities.find((a) => a.id === op.id);
          if (op.type === "edit") Object.assign(a, op.patch);
          if (op.type === "bind_entity") {
            assert.ok(op.entity);
            a.entityId = op.entity.id;
            trip.entities.push(op.entity);
          }
        }
        trip.revision++;
        data = trip;
      } else if (p.endsWith("/kernel"))
        data = {
          ...trip,
          schemaVersion: 2,
          activities: trip.activities.map((a) => ({
            ...a,
            environment: "unspecified",
          })),
        };
      else if (p.endsWith("/intelligence-snapshot"))
        data = buildIntelligenceSnapshot(trip, [], [], 0, {});
      else if (p.includes("/operational-facts"))
        data = {
          facts: [],
          sources: [],
          gaps: [],
          tripRevision: trip.revision,
          factsVersion: 0,
          nextCursor: null,
        };
      else if (p.endsWith("/transitions"))
        data = buildIntelligenceSnapshot(trip, [], [], 0, {}).connections.map(
          (c) => ({
            ...c,
            gapMinutes: c.gapSeconds / 60,
            freshness: "unknown",
            estimate: null,
          }),
        );
      else if (p.includes("/proposals"))
        data = { items: [], total: 0, historyTotal: 0, nextCursor: null };
      else if (p.endsWith("/intelligence/refresh")) {
        refreshes++;
        data = {
          attempted: 0,
          succeeded: 0,
          failed: 0,
          cache: 0,
          cooldown: 0,
          blocked: 0,
          discarded: 0,
        };
      } else
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
    const cols = page.locator(".travel-grid [data-day-action]");
    await cols.first().waitFor();
    assert.equal(await cols.count(), width === 390 ? 1 : 8);
    const boxes = await cols.evaluateAll((es) =>
      es.map((e) => {
        const p = e.parentElement.getBoundingClientRect();
        return { x: p.x, y: p.y, w: p.width, h: p.height };
      }),
    );
    console.log(JSON.stringify({ width, boxes }));
    for (let i = 1; i < boxes.length; i++) {
      assert.ok(Math.abs(boxes[i].y - boxes[0].y) < 1);
      assert.ok(Math.abs(boxes[i].w - boxes[0].w) <= 1);
      assert.ok(Math.abs(boxes[i].x - boxes[i - 1].x - boxes[i - 1].w) < 2);
    }
    const button = cols.first().getByRole("button");
    await button.click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(refreshes, 1);
    checks.push(
      width + "日期列头按钮同一横排/列宽一致/手机单列/点击不创建活动",
    );
    const open = async (i) => {
      await page
        .locator(".travel-day-list button")
        .filter({ hasText: trip.activities[i].title })
        .first()
        .click();
      return page.getByRole("dialog");
    };
    let d = await open(0);
    const before = saved();
    const city = d.getByLabel("地点搜索城市");
    assert.equal(await city.inputValue(), "大同");
    await city.fill("");
    await page.waitForTimeout(150);
    assert.equal(await city.inputValue(), "");
    await city.fill("忻州");
    await d.getByRole("button", { name: "按此城市重新选地点" }).click();
    await d.getByRole("button", { name: /忻州模拟景点/ }).waitFor();
    assert.equal(saved(), before);
    await d.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(saved(), before);
    checks.push(width + "清空保持手动/全选替换忻州/重新搜索/取消不改地点");
    d = await open(0);
    assert.equal(await d.getByLabel("地点搜索城市").inputValue(), "大同");
    await d.getByLabel("地点搜索城市").fill("忻州");
    await d.getByRole("button", { name: "按此城市重新选地点" }).click();
    mode = "failure";
    await d.getByLabel("地点", { exact: true }).fill("新的查询");
    await d.getByText("模拟地点查询失败").waitFor();
    assert.equal(await d.getByLabel("地点搜索城市").inputValue(), "忻州");
    assert.equal(saved(), before);
    checks.push(width + "搜索失败保留城市草稿/已保存地点不变");
    mode = "ready";
    await d.getByLabel("地点搜索城市").fill("太原");
    await page.waitForTimeout(750);
    await d.getByLabel("地点搜索城市").fill("忻州");
    await d.getByRole("button", { name: /忻州模拟景点/ }).waitFor();
    await page.waitForTimeout(1700);
    assert.equal(
      await d.getByRole("button", { name: /太原模拟景点/ }).count(),
      0,
    );
    checks.push(width + "旧城市晚返回不覆盖新候选");
    await d.getByRole("button", { name: /忻州模拟景点/ }).click();
    await d.getByRole("button", { name: "保存", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    assert.equal(saves, 1);
    assert.equal(
      trip.entities.find((e) => e.id === trip.activities[0].entityId).city,
      "忻州",
    );
    checks.push(width + "选定候选后通过共享mutation保存");
    d = await open(1);
    assert.equal(await d.getByLabel("地点搜索城市").isDisabled(), true);
    assert.equal(
      await d.getByRole("button", { name: "重新输入地点" }).isDisabled(),
      true,
    );
    await d.getByRole("button", { name: "取消", exact: true }).click();
    checks.push(width + "切换活动重新初始化/固定地点保护");
    await page.screenshot({
      path: "verification/sprint18-layout-" + width + ".png",
      fullPage: true,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint18-city-layout.json",
    JSON.stringify(
      {
        checks,
        passed: checks.length,
        actualAmapRequests: 0,
        modelRequests: 0,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  await browser.close();
}
