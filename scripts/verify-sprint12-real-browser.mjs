import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  real = JSON.parse(readFileSync("verification/sprint12-real.json", "utf8"));
const b = await chromium.launch({ channel: "msedge", headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/transitions/refresh", (r) =>
    r.fulfill({ json: { success: true, data: [] } }),
  );
  await p.goto("http://127.0.0.1:4331/login");
  await p.locator("input[type=email]").fill(account.email);
  await p.locator("input[type=password]").fill(account.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("**/app");
  await p.getByLabel("选择行程").selectOption(real.tripId);
  await p
    .getByRole("heading", {
      name: "Sprint12真实天气与地点来源（隔离测试，非旅行建议）",
      exact: true,
    })
    .waitFor();
  const weather = p.getByLabel("每日天气");
  await weather.locator("summary").click();
  await weather
    .getByText(/平城区/)
    .first()
    .waitFor();
  await weather
    .getByText(/天河区/)
    .first()
    .waitFor();
  assert.match(await weather.innerText(), /2026-10-11/);
  await p
    .locator(".travel-day-list button")
    .filter({ hasText: "华严寺" })
    .first()
    .click();
  const d = p.getByRole("dialog");
  await d.locator("[data-place-details] summary").click();
  await d.getByText(/0352-2042001/).waitFor();
  await d.getByText(/每周营业原文/).waitFor();
  await p.screenshot({ path: "verification/sprint12-real-place.png" });
  const usage = await p.evaluate(async () => {
    const token = localStorage.getItem("open_sunsama_token");
    return (
      await (
        await fetch("/api/travel/usage", {
          headers: { Authorization: "Bearer " + token },
        })
      ).json()
    ).data;
  });
  assert.ok(
    !usage.totals.some(
      (t) =>
        (t.provider === "amap" || t.provider === "model") &&
        t.status === "success",
    ),
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint12-real-browser.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        tripId: real.tripId,
        checks: [
          "真实后端天气展示两个行政区",
          "展示实际预报日期至10月11日",
          "事件资料展示真实营业原文/电话",
          "只读浏览无高德/模型调用",
        ],
        routeRefreshIntercepted: true,
        modelCalls: 0,
        providerCalls: 0,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "真实后端资料UI4项通过（路线自动刷新拦截，其他数据为真实API读取）",
  );
} finally {
  await b.close();
}
