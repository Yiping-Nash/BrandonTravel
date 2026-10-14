import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
await import("../apps/api/node_modules/tsx/dist/loader.mjs");
const { buildIntelligenceSnapshot } =
  await import("../packages/utils/src/travel-inspection.ts");
const { calculateDemo, demoScenes } =
  await import("../apps/api/src/travel/kernel/demo.ts");
const fixtures = JSON.parse(
  readFileSync("fixtures/travel/future-plans.json", "utf8"),
).fixtures;
const account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errors.push(e.message));
    const trip = structuredClone(fixtures[0].trip);
    const env = {};
    let calls = 0,
      lastDemo = null;
    await page.route("**/api/travel/**", async (r) => {
      const path = new URL(r.request().url()).pathname.replace(
        "/api/travel",
        "",
      );
      let data;
      if (path === "/trips") data = [trip];
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
      else if (path.endsWith("/intelligence-snapshot"))
        data = buildIntelligenceSnapshot(trip, [], [], 0, env);
      else if (path.includes("/operational-facts"))
        data = {
          tripRevision: trip.revision,
          factsVersion: 0,
          facts: [],
          sources: [],
          gaps: [],
          total: 0,
          nextCursor: null,
        };
      else if (path.includes("/transitions")) data = [];
      else if (path.includes("/proposals"))
        data = { items: [], total: 0, historyTotal: 0, nextCursor: null };
      else if (path === "/intelligence-demo") {
        calls++;
        data =
          r.request().method() === "POST"
            ? calculateDemo(r.request().postDataJSON())
            : demoScenes;
        if (r.request().method() === "POST") lastDemo = data;
      } else if (path === "/usage") data = { totals: [], recent: [] };
      else if (path.includes("/inspection")) data = {};
      else
        return r.fulfill({
          status: 400,
          json: { success: false, error: { message: "测试阻止未声明请求" } },
        });
      return r.fulfill({ json: { success: true, data } });
    });
    await page.goto("http://127.0.0.1:4331/login");
    await page.locator("input[type=email]").fill(account.email);
    await page.locator("input[type=password]").fill(account.password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL("**/app");
    await page.goto("http://127.0.0.1:4331/travel");
    const panel = page.locator(".travel-intelligence");
    await panel.getByText(/计划状态 · 0处冲突/).waitFor();
    assert.equal(await panel.locator("article[data-reason]").count(), 0);
    assert.match(await panel.innerText(), /待补信息/);
    assert.equal(calls, 0);
    assert.equal(
      await panel
        .locator("summary:visible")
        .filter({ hasText: "未确认真实地点" })
        .count(),
      1,
    );
    await panel.screenshot({
      path: "verification/sprint13-status-" + width + ".png",
    });
    await panel.getByText("查看检查详情", { exact: true }).click();
    const dev = panel.getByText("开发验收 · 智能检查器", { exact: true });
    assert.equal(await dev.evaluate((e) => e.parentElement.open), false);
    await dev.click();
    assert.match(await panel.innerText(), /READY（功能已实现）/);
    assert.equal(calls, 0);
    checks.push(
      width + "未来山西资料缺口聚合、READY与覆盖分离、检查器打开纯读",
    );
    await panel.getByText("规则演示 · 不落库沙盒", { exact: true }).click();
    const demo = panel
      .locator("details")
      .filter({ has: page.getByText("规则演示 · 不落库沙盒", { exact: true }) })
      .last();
    await demo.getByText(/模拟时刻/).waitFor();
    assert.match(await demo.innerText(), /固定模拟时钟/);
    const scenario = demo.getByLabel("演示场景");
    for (const id of [
      "overlap",
      "route-shortage",
      "lunch-closure",
      "weather",
      "missing-place",
      "forecast-out-of-range",
    ]) {
      await scenario.selectOption(id);
      await page.waitForTimeout(120);
      const snapshot = calculateDemo({ scene: id });
      if (
        id === "overlap" ||
        id === "route-shortage" ||
        id === "lunch-closure"
      ) {
        const inputs = demo.locator("input[type=time]");
        const index = id === "lunch-closure" ? 0 : 1;
        await inputs
          .nth(index)
          .fill(
            id === "overlap"
              ? "10:30"
              : id === "route-shortage"
                ? "14:45"
                : "17:00",
          );
        await page.waitForTimeout(120);
        const rule =
          id === "overlap"
            ? "OVERLAP"
            : id === "route-shortage"
              ? "TRANSITION_GAP"
              : "OPENING_COVERAGE";
        assert.ok(
          lastDemo.evaluation.results
            .filter((r) => r.rule === rule)
            .every((r) => r.state === "VALID"),
        );
      } else if (id === "weather") {
        await demo
          .getByLabel(snapshot.activities[0].title + "演示环境")
          .selectOption("indoor");
        await page.waitForTimeout(120);
        assert.match(await demo.innerText(), /不适用1/);
      } else if (id === "forecast-out-of-range")
        assert.match(await demo.innerText(), /预报范围/);
    }
    await demo.getByRole("button", { name: "重置演示" }).click();
    checks.push(width + "四类沙盒交互、UNKNOWN、固定模拟时钟和重置");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 4,
      ),
    );
    await page.screenshot({
      path: "verification/sprint13-" + width + ".png",
      fullPage: true,
    });
    checks.push(width + "展开滚动及无水平溢出");
    await page.close();
  }
  for (const f of fixtures) {
    const s = buildIntelligenceSnapshot(f.trip, [], [], 0);
    assert.equal(
      s.roots.filter((r) => r.reason === "PLACE_UNCONFIRMED").length,
      f.trip.activities.filter((a) => a.start !== null && a.date).length,
    );
    checks.push(f.key + "未来样例按活动根因去重");
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint13-browser.json",
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
