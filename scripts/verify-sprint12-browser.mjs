import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
await import("../apps/api/node_modules/tsx/dist/loader.mjs");
const { evaluate } =
  await import("../packages/utils/src/travel-intelligence.ts");
const original = JSON.parse(
    readFileSync("verification/sprint12-ui-fixture.json", "utf8"),
  ),
  account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const fixture = structuredClone(original),
      place = fixture.facts.facts.find(
        (f) =>
          f.kind === "place" &&
          f.subjectKey === fixture.trip.activities[1].entityId,
      ),
      w = fixture.facts.facts.find(
        (f) => f.subjectKey === "140200:daily_forecast",
      );
    place.value.regionCode = "440106";
    const second = structuredClone(w);
    second.id = randomUUID();
    second.subjectKey = "440106:daily_forecast";
    second.value.regionCode = "440106";
    second.value.regionName = "模拟广州天河";
    second.appliesTo.regionRef = "440106";
    fixture.facts.facts.push(second);
    fixture.facts.nextCursor = null;
    const env = () =>
      Object.fromEntries(
        fixture.kernel.activities.map((a) => [a.id, a.environment]),
      );
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (e) => errors.push(e.message));
    let saves = 0,
      previewCalls = 0;
    await page.route("**/api/travel/**", async (r) => {
      const path = new URL(r.request().url()).pathname.replace(
        "/api/travel",
        "",
      );
      let data;
      if (path === "/places/search")
        data = fixture.trip.entities.map((e) => ({
          ...e,
          selectionProof: "test-only",
        }));
      else if (path === "/trips") data = [fixture.trip];
      else if (path === "/trips/" + fixture.trip.id) data = fixture.trip;
      else if (path.endsWith("/kernel")) data = fixture.kernel;
      else if (path.endsWith("/kernel/operations")) {
        saves++;
        const body = r.request().postDataJSON();
        if (saves === 1)
          return r.fulfill({
            status: 409,
            json: {
              success: false,
              error: { message: "模拟并发冲突，请刷新" },
            },
          });
        for (const op of body.operations)
          if (op.type === "edit")
            Object.assign(
              fixture.trip.activities.find((a) => a.id === op.id),
              op.patch,
            );
        for (const e of body.environments)
          fixture.kernel.activities.find(
            (a) => a.id === e.activityId,
          ).environment = e.environment;
        fixture.trip.revision++;
        fixture.kernel.revision = fixture.trip.revision;
        fixture.facts.tripRevision = fixture.trip.revision;
        data = fixture.trip;
      } else if (path.includes("operational-facts")) data = fixture.facts;
      else if (path.endsWith("/intelligence"))
        data = evaluate(
          fixture.trip,
          fixture.facts.facts,
          fixture.facts.factsVersion,
          new Date(),
          undefined,
          env(),
        );
      else if (path.includes("/intelligence/refresh"))
        data = { attempted: 0, blocked: 0, cancelled: false };
      else if (path.endsWith("/transitions")) data = fixture.transitions;
      else if (path.endsWith("/transitions/refresh"))
        data = fixture.transitions;
      else if (path.includes("proposals"))
        data = { items: [], total: 0, historyTotal: 0, nextCursor: null };
      else if (path.endsWith("/place-preview")) {
        previewCalls++;
        data = {
          facts: fixture.facts.facts.filter(
            (f) =>
              f.subjectKey === r.request().postDataJSON().id &&
              (f.kind === "place" || f.kind === "opening_hours"),
          ),
          cached: false,
        };
      } else return r.continue();
      return r.fulfill({ json: { success: true, data } });
    });
    await page.goto("http://127.0.0.1:4331/login");
    await page.locator("input[type=email]").fill(account.email);
    await page.locator("input[type=password]").fill(account.password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL("**/app", { timeout: 20000 });
    await page.goto("http://127.0.0.1:4331/travel");
    await page.getByRole("heading", { name: fixture.trip.title }).waitFor();
    await page
      .locator(".travel-intelligence")
      .getByText(/1项提醒/)
      .waitFor();
    const weather = page.getByLabel("每日天气");
    await weather.locator("summary").first().click();
    await weather.getByText("模拟广州天河", { exact: false }).first().waitFor();
    assert.match(await weather.innerText(), /2个天气区域/);
    checks.push(viewport.width + "多区域日天气/日级说明");
    const issue = page
      .locator('article[data-rule="WEATHER_EXPOSURE"]')
      .filter({ hasText: "提醒" })
      .first();
    await issue.locator("summary").click();
    await issue.locator("[data-fact-id]").first().waitFor();
    assert.match(await issue.innerText(), /发布/);
    checks.push(viewport.width + "检查依据展示真实字段投影及时间/版本");
    await page
      .locator(".travel-day-list button")
      .filter({ hasText: fixture.trip.activities[0].title })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("活动环境").selectOption("outdoor");
    await dialog.locator("[data-place-details] summary").click();
    await dialog.locator("[data-fact-id]").first().waitFor();
    const link = dialog.getByRole("link", { name: "在高德查看" }).first();
    assert.equal(
      new URL(await link.getAttribute("href")).searchParams.get("poiid"),
      fixture.trip.entities[0].poiId,
    );
    assert.match(await dialog.innerText(), /每周营业原文/);
    assert.equal(previewCalls, 0);
    checks.push(viewport.width + "事件资料/精准POI外链/打开不调用供应商");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.getByText("模拟并发冲突，请刷新").waitFor();
    assert.equal(await dialog.getByLabel("活动环境").inputValue(), "outdoor");
    checks.push(viewport.width + "保存失败保留草稿");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(fixture.kernel.activities[0].environment, "outdoor");
    checks.push(viewport.width + "环境修改经内核事务保存");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 4,
      ),
    );
    await page.screenshot({
      path: "verification/sprint12-" + viewport.width + ".png",
      fullPage: true,
    });
    await page
      .locator(".travel-day-list button")
      .filter({ hasText: fixture.trip.activities[0].title })
      .first()
      .click();
    const candidateDialog = page.getByRole("dialog");
    await candidateDialog.waitFor();
    await candidateDialog.getByRole("button", { name: "重新输入地点" }).click();
    await candidateDialog.getByLabel("地点", { exact: true }).fill("模拟候选");
    await candidateDialog.locator(".travel-place-result").first().waitFor();
    const outer = candidateDialog
      .locator(".travel-place-results > div")
      .first();
    await outer.locator("summary").first().click();
    await outer.locator("[data-place-details] summary").click();
    const rev = fixture.trip.revision;
    await outer.getByRole("button", { name: "查询候选详情" }).click();
    await outer.locator("[data-fact-id]").first().waitFor();
    assert.equal(previewCalls, 1);
    assert.equal(fixture.trip.revision, rev);
    const bounds = await candidateDialog.boundingBox();
    assert.ok(bounds.height < viewport.height);
    assert.ok(
      await candidateDialog
        .locator(".travel-form-fields")
        .evaluate((e) => e.scrollHeight >= e.clientHeight),
    );
    checks.push(
      viewport.width + "绑定前候选按需查看/不写计划/弹窗与资料分别滚动",
    );
    await page.screenshot({
      path: "verification/sprint12-dialog-" + viewport.width + ".png",
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint12-browser.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
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
