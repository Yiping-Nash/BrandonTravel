import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const account = JSON.parse(readFileSync(".runtime/test-account.json")),
  e = JSON.parse(readFileSync("verification/sprint18-real.json"));
assert.equal(e.status, "PASS");
const b = await chromium.launch({ channel: "msedge", headless: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const p = await b.newPage({ viewport: { width, height: 1000 } });
    let blocked = 0;
    p.on("pageerror", (e) => {
      throw e;
    });
    await p.route("**/api/travel/**", (r) => {
      const u = new URL(r.request().url()).pathname;
      if (
        r.request().method() !== "GET" ||
        u.includes("/places/") ||
        u.includes("refresh") ||
        u.includes("preview")
      ) {
        blocked++;
        return r.abort();
      }
      return r.continue();
    });
    await p.goto("http://127.0.0.1:4331/login");
    await p.locator("input[type=email]").fill(account.email);
    await p.locator("input[type=password]").fill(account.password);
    await p.locator("button[type=submit]").click();
    await p.waitForURL("**/app");
    await p.goto("http://127.0.0.1:4331/travel");
    for (const trip of e.trips) {
      await p.locator("select").first().selectOption(trip.id);
      const date = trip.dates[0].date;
      const d = p.locator('[data-weather-date="' + date + '"]');
      await d
        .getByText(
          trip.kind === "outlook"
            ? "已取得远期趋势（不确定）"
            : "已取得日级预报",
          { exact: true },
        )
        .waitFor();
      if (trip.kind === "outlook") {
        await d.getByText(/日均温度集合P10–P90/).waitFor();
        await d.getByText("天气来源与详情", { exact: true }).click();
        await d.getByText(/模型发布时间未提供/).waitFor();
        await d.getByText(/51个成员/).waitFor();
      } else
        await d
          .getByText(new RegExp(trip.dates[0].condition))
          .first()
          .waitFor();
      checks.push(
        width +
          "真实" +
          trip.poi.city +
          " " +
          trip.kind +
          "来自已保存Facts/来源及趋势不确定性可见",
      );
    }
    assert.equal(blocked, 0);
    await p.screenshot({
      path: "verification/sprint18-real-" + width + ".png",
      fullPage: true,
    });
    await p.close();
  }
  writeFileSync(
    "verification/sprint18-real-browser.json",
    JSON.stringify(
      { checks, pureRead: true, newProviderRequests: 0, modelRequests: 0 },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(checks));
} finally {
  await b.close();
}
