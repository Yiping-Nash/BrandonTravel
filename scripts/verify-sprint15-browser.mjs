import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
await import("../apps/api/node_modules/tsx/dist/loader.mjs");
const { applyOperations } = await import("../apps/api/src/travel/domain.ts");
const { buildIntelligenceSnapshot } =
  await import("../packages/utils/src/travel-inspection.ts");
const account = JSON.parse(readFileSync(".runtime/test-account.json"));
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
try {
  for (const width of [1440, 390]) {
    let trip = {
      id: randomUUID(),
      title: "编辑验收",
      startDate: "2026-10-13",
      endDate: "2026-10-15",
      timezone: "Asia/Shanghai",
      revision: 0,
      activities: [0, 1, 2].map((i) => ({
        id: randomUUID(),
        title: "编辑活动" + i,
        date: "2026-10-13",
        start: 600 + i * 90,
        duration: 60,
        locked: false,
        notes: "保留",
        place: "待确认",
        position: i,
      })),
    };
    const ids = trip.activities.map((a) => a.id);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/travel/**", async (r) => {
      const path = new URL(r.request().url()).pathname.replace(
        "/api/travel",
        "",
      );
      let data;
      if (path === "/trips") data = [trip];
      else if (path === "/trips/" + trip.id) data = trip;
      else if (path.endsWith("/operations")) {
        try {
          trip = applyOperations(
            trip,
            r.request().postDataJSON().operations,
            "user",
          );
        } catch (e) {
          return r.fulfill({
            status: 422,
            json: { success: false, error: { message: e.message } },
          });
        }
        data = trip;
      } else if (path.endsWith("/kernel"))
        data = {
          ...trip,
          schemaVersion: 2,
          activities: trip.activities.map((a) => ({
            ...a,
            environment: "unspecified",
          })),
        };
      else if (path.endsWith("/intelligence-snapshot"))
        data = buildIntelligenceSnapshot(trip, [], [], 0);
      else if (path.includes("/operational-facts"))
        data = {
          facts: [],
          sources: [],
          gaps: [],
          tripRevision: trip.revision,
          factsVersion: 0,
          nextCursor: null,
        };
      else if (path.includes("/transitions")) data = [];
      else if (path.includes("/proposals"))
        data = { items: [], total: 0, historyTotal: 0, nextCursor: null };
      else
        return r.fulfill({
          status: 400,
          json: { success: false, error: { message: "测试阻止未知请求" } },
        });
      await r.fulfill({ json: { success: true, data } });
    });
    await page.goto("http://127.0.0.1:4331/login");
    await page.locator("input[type=email]").fill(account.email);
    await page.locator("input[type=password]").fill(account.password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL("**/app");
    await page.goto("http://127.0.0.1:4331/travel");
    await page.getByRole("heading", { name: "编辑验收" }).waitFor();
    await page.getByRole("button", { name: "选择模式", exact: true }).click();
    for (const id of ids.slice(0, 2))
      await page.locator('[data-block-id="' + id + '"]').click();
    await page.getByText("已选择2项", { exact: false }).waitFor();
    assert.equal(await page.locator('[data-selected="true"]').count(), 2);

    if (width === 1440) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "选择模式", exact: true }).click();
      await page.locator('[data-block-id="' + ids[0] + '"]').scrollIntoViewIfNeeded();
      const a = await page
          .locator('[data-block-id="' + ids[0] + '"]')
          .boundingBox(),
        b = await page
          .locator('[data-block-id="' + ids[1] + '"]')
          .boundingBox();
      await page.mouse.move(a.x + a.width + 8, a.y - 4);
      await page.mouse.down();
      await page.mouse.move(a.x - 3, b.y + b.height + 3, { steps: 12 });
      await page.mouse.up();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-selected="true"]').length === 2,
      );
      assert.equal(await page.locator('[data-selected="true"]').count(), 2);
      checks.push("1440空白框选、可见区域命中、不触发移动");
    }
    const before = structuredClone(trip);
    trip.activities[0].locked = true;
    await page
      .getByRole("button", { name: "批量退回待安排", exact: true })
      .click();
    await page.getByRole("alert").filter({ hasText: "请先解除固定" }).waitFor();
    assert.equal(await page.locator('[data-selected="true"]').count(), 2);
    assert.equal(trip.activities[1].start, before.activities[1].start);
    trip.activities[0].locked = false;
    checks.push(width + "整批失败保留选择和活动");
    await page.getByRole("button", { name: "批量移动", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("平移分钟").fill("30");
    await dialog.getByRole("button", { name: "确认整体平移" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(trip.activities[0].start, 630);
    assert.equal(trip.activities[1].start, 720);
    checks.push(width + "多选整体平移保持间距并清除选择");
    await page.getByRole("button", { name: "选择模式", exact: true }).click();
    for (const id of ids.slice(0, 2))
      await page.locator('[data-block-id="' + id + '"]').click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('[data-selected="true"]').count(), 0);
    checks.push(width + "Escape取消不写计划");
    await page.getByRole("button", { name: "选择模式", exact: true }).click();
    for (const id of ids.slice(0, 2))
      await page.locator('[data-block-id="' + id + '"]').click();
    await page
      .getByRole("button", { name: "批量退回待安排", exact: true })
      .click();
    await page
      .locator(".travel-pending-groups summary")
      .filter({ hasText: "原2026-10-13计划" })
      .waitFor();
    assert.equal(trip.activities[0].backlogOriginDate, "2026-10-13");
    assert.equal(trip.activities[1].start, null);
    checks.push(width + "批量退回原日期分组");
    await page.getByRole("button", { name: "选择模式", exact: true }).click();
    await page.locator('[data-block-id="' + ids[2] + '"]').click();
    await page.getByRole("button", { name: "批量删除", exact: true }).click();
    dialog = page.getByRole("dialog");
    assert.equal(trip.activities.length, 3);
    await dialog.getByRole("button", { name: "确认删除这些活动" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(trip.activities.length, 2);
    checks.push(width + "删除确认前后及原子结果");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 4,
      ),
    );
    await page.screenshot({
      path: "verification/sprint15-" + width + ".png",
      fullPage: true,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint15-browser.json",
    JSON.stringify(
      {
        checks,
        errors,
        realProviderRequests: 0,
        modelRequests: 0,
        nativePhone: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  await browser.close();
}
