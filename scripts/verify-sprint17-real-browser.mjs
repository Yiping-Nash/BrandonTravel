import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  e = JSON.parse(readFileSync("verification/sprint17-real.json", "utf8"));
assert.equal(e.status, "passed");
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let blocked = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/travel/**", (r) => {
      const p = new URL(r.request().url()).pathname;
      if (
        r.request().method() !== "GET" ||
        p.includes("/places/") ||
        p.includes("refresh") ||
        p.includes("preview")
      ) {
        blocked++;
        return r.abort();
      }
      return r.continue();
    });
    await page.goto("http://127.0.0.1:4331/login");
    await page.locator("input[type=email]").fill(a.email);
    await page.locator("input[type=password]").fill(a.password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL("**/app");
    await page.goto("http://127.0.0.1:4331/travel");
    await page.locator("select").first().selectOption(e.tripId);
    await page
      .getByRole("heading", {
        name: "Sprint17西安首次天气与路线（隔离测试）",
        exact: true,
      })
      .waitFor();
    const day = page.locator('[data-weather-date="' + e.connection.date + '"]');
    await day.getByText("已取得日级预报", { exact: true }).waitFor();
    for (const r of e.weather)
      await day
        .getByText(r.name + " · " + r.dayCondition, { exact: false })
        .waitFor();
    const minutes = Math.ceil(e.connection.durationSeconds / 60);
    await page
      .locator(".travel-timeline-transition")
      .getByText("约" + minutes + "分钟", { exact: false })
      .waitFor();
    await page
      .getByRole("button", { name: "展开方位与路程", exact: true })
      .click();
    await page
      .locator(".travel-route-panel")
      .getByText("约" + minutes + "分钟", { exact: false })
      .waitFor();
    await page.locator(".travel-grid").scrollIntoViewIfNeeded();
    const visible = await page
      .locator(".travel-timeline-transition")
      .evaluate((el) => {
        const b = el.getBoundingClientRect(),
          v = el
            .closest("[data-radix-scroll-area-viewport]")
            .getBoundingClientRect();
        return b.top < v.bottom && b.bottom > v.top;
      });
    assert.equal(visible, true, "连接必须实际在日历滚动窗口内");
    assert.equal(blocked, 0);
    checks.push(
      width +
        "真实缓存天气与时间表/方位模块耗时一致、连接在滚动区内实际可见，浏览无外部查询",
    );
    await page.screenshot({
      path: "verification/sprint17-real-" + width + ".png",
      fullPage: true,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint17-real-browser.json",
    JSON.stringify({ checks, providerRequests: 0, modelRequests: 0 }, null, 2),
  );
  console.log(JSON.stringify({ checks }));
} finally {
  await browser.close();
}
