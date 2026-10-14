import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const a = {
  ...JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  ...JSON.parse(readFileSync(".runtime/baseline-ui-fixture.json", "utf8")),
};
// Obtain a fresh session; baseline fixture deliberately stores no token.
a.token = (
  await (
    await fetch("http://127.0.0.1:4331/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: a.email, password: a.password }),
    })
  ).json()
).data.token;
const b = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
const pass = (name) => results.push({ name, status: "通过" });
async function login(p) {
  await p.route("**/api/travel/exchange-rates*", (r) =>
    r.fulfill({
      status: 503,
      json: { success: false, error: { message: "隔离验收禁用外部汇率" } },
    }),
  );
  await p.goto("http://127.0.0.1:4331/login");
  await p.locator("input[type=email]").fill(a.email);
  await p.locator("input[type=password]").fill(a.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("http://127.0.0.1:4331/");
  await p.goto("http://127.0.0.1:4331/app");
  await p.getByLabel("选择行程").selectOption(a.tripId);
}
try {
  const p = await b.newPage({ viewport: { width: 1365, height: 900 } });
  await login(p);
  await p.getByRole("heading", { name: "验收行程", exact: true }).waitFor();
  pass("浏览器真实登录与读取");
  await p.getByRole("button", { name: "添加活动", exact: true }).click();
  const d = p.getByRole("dialog");
  await d.getByLabel("标题", { exact: true }).fill("浏览器验收活动");
  await d.getByLabel("日期", { exact: true }).fill("2026-10-02");
  await d.getByLabel("开始时间（留空待安排）").fill("12:10");
  await d.getByRole("button", { name: "保存", exact: true }).click();
  await d.waitFor({ state: "hidden" });
  pass("网页创建并保存");
  await p.reload();
  await p.getByLabel("选择行程").selectOption(a.tripId);
  await p.locator(`[data-trip-id="${a.tripId}"]`).waitFor();
  await p
    .getByRole("button", {
      name: "2026-10-02 12:10 · 浏览器验收活动",
      exact: true,
    })
    .waitFor();
  pass("刷新恢复");
  await p
    .getByRole("button", {
      name: "2026-10-02 12:10 · 浏览器验收活动",
      exact: true,
    })
    .click();
  await d.getByLabel("日期", { exact: true }).fill("2026-10-03");
  await d.getByLabel("开始时间（留空待安排）").fill("13:20");
  await d.getByRole("button", { name: "保存", exact: true }).click();
  await d.waitFor({ state: "hidden" });
  pass("按钮跨日移动与时间编辑");
  const m = await b.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await login(m);
  await m
    .getByRole("button", {
      name: "2026-10-03 13:20 · 浏览器验收活动",
      exact: true,
    })
    .waitFor();
  pass("第二浏览器上下文共享服务端状态");
  assert.equal(
    await m.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  pass("手机宽度无水平溢出");
  await m
    .getByRole("button", {
      name: "2026-10-03 13:20 · 浏览器验收活动",
      exact: true,
    })
    .click();
  const md = m.getByRole("dialog");
  await md.getByRole("button", { name: "固定活动", exact: true }).click();
  await md.waitFor({ state: "hidden" });
  await m
    .getByRole("button", {
      name: "2026-10-03 13:20 · 🔒 浏览器验收活动",
      exact: true,
    })
    .click();
  assert.equal(await md.getByLabel("日期", { exact: true }).isDisabled(), true);
  assert.equal(
    await md.getByRole("button", { name: "删除", exact: true }).isDisabled(),
    true,
  );
  pass("固定活动的移动与删除禁用");
  await md.getByRole("button", { name: "解除固定", exact: true }).click();
  await md.waitFor({ state: "hidden" });
  await m
    .getByRole("button", {
      name: "2026-10-03 13:20 · 浏览器验收活动",
      exact: true,
    })
    .click();
  m.once("dialog", (dialog) => dialog.accept());
  await md.getByRole("button", { name: "删除", exact: true }).click();
  await md.waitFor({ state: "hidden" });
  await m.reload();
  assert.equal(await m.getByText("浏览器验收活动", { exact: true }).count(), 0);
  pass("手机按钮删除后刷新不恢复");
  const t = (
    await (
      await fetch("http://127.0.0.1:4331/api/travel/trips/" + a.tripId, {
        headers: { Authorization: "Bearer " + a.token },
      })
    ).json()
  ).data;
  const key = JSON.parse(
    readFileSync(".runtime/test-key.json", "utf8"),
  ).travelKey;
  const propResponse = await fetch(
    "http://127.0.0.1:4331/api/travel/trips/" + a.tripId + "/proposals",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Travel-Key": key },
      body: JSON.stringify({
        expectedRevision: t.revision,
        requestId: crypto.randomUUID(),
        reason: "浏览器确认新提案",
        operations: [
          { type: "edit", id: t.activities[0].id, patch: { start: 690 } },
        ],
      }),
    },
  );
  assert.equal(propResponse.status, 201);
  await p.reload();
  await p.getByLabel("选择行程").selectOption(a.tripId);
  await p.locator(`[data-trip-id="${a.tripId}"]`).waitFor();
  await p
    .locator(".travel-proposals article")
    .filter({ hasText: "浏览器确认新提案" })
    .getByRole("button", { name: "确认并保存", exact: true })
    .click();
  await p.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  pass("网页确认MCP提案");
  await p.screenshot({
    path: "verification/frontend-v2-legacy-desktop.png",
    fullPage: true,
  });
  await m.reload();
  await m.screenshot({ path: "verification/mobile-width.png", fullPage: true });
  writeFileSync(
    "verification/frontend-v2-legacy-browser.json",
    JSON.stringify({ date: "2026-10-06", realDevice: false, results }, null, 2),
  );
  console.log(`${results.length} 项浏览器验收通过`);
} finally {
  await b.close();
}
