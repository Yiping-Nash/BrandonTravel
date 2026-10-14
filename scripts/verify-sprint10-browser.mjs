import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  real = JSON.parse(readFileSync("verification/sprint10-real.json", "utf8"));
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (e) => errors.push(e.message));
    let refreshCalls = 0,
      stopCalls = 0;
    await page.route("**/transitions/refresh", (r) =>
      r.fulfill({ json: { success: true, data: [] } }),
    );
    await page.route("**/intelligence/refresh/*/cancel", (r) => {
      stopCalls++;
      return r.fulfill({
        json: { success: true, data: { status: "stopping" } },
      });
    });
    await page.route("**/intelligence/refresh", async (r) => {
      refreshCalls++;
      await new Promise((resolve) => setTimeout(resolve, 800));
      return r.fulfill({
        json: {
          success: true,
          data: { attempted: 0, blocked: 0, cancelled: stopCalls > 0 },
        },
      });
    });
    await page.goto("http://127.0.0.1:4331/login");
    await page.locator("input[type=email]").fill(account.email);
    await page.locator("input[type=password]").fill(account.password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL("**/app");
    await page.getByLabel("选择行程").selectOption(real.tripId);
    const panel = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: "现实信息与来源" }) });
    await panel.locator("summary").click();
    await panel.getByText("来源：amap", { exact: false }).first().waitFor();
    assert.match(await panel.innerText(), /待解析|待规则解析/);
    assert.equal(refreshCalls, 0);
    await panel.getByRole("button", { name: "刷新现实信息" }).click();
    await panel.getByRole("button", { name: "停止刷新" }).click();
    await page.waitForTimeout(1000);
    assert.equal(stopCalls, 1);
    assert.match(await panel.innerText(), /刷新已停止/);
    assert.equal(refreshCalls, 1);
    assert.ok((await panel.locator("article").count()) >= 7);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `verification/sprint10-${viewport.width}.png`,
      fullPage: true,
    });
    checks.push(`${viewport.width}px来源/待解析/折叠/手动刷新与停止/无横向溢出`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint10-browser.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        checks,
        errors,
        realRefreshRequests: 0,
        modelRequests: 0,
        mobileRealDevice: "unverified",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(checks));
} finally {
  await browser.close();
}
