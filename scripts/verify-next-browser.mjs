import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const a = JSON.parse(readFileSync(".runtime/next-account.json", "utf8"));
const headers = { Authorization: "Bearer " + a.token };
const base = "http://127.0.0.1:4331";
async function trip() {
  return (
    await (
      await fetch(base + "/api/travel/trips/" + a.tripId, { headers })
    ).json()
  ).data;
}
const b = await chromium.launch({ channel: "msedge", headless: true });
const results = [],
  errors = [];
async function login(p) {
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/login");
  await p.locator("input[type=email]").fill(a.email);
  await p.locator("input[type=password]").fill(a.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("**/app");
  await p.getByLabel("选择行程").selectOption(a.tripId);
  await p.locator(`[data-trip-id="${a.tripId}"]`).waitFor();
  await p
    .getByRole("heading", { name: "地图与聊天验收", exact: true })
    .waitFor();
}
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await login(p);
  await p.waitForFunction(
    () => document.querySelectorAll(".travel-direction svg").length === 1,
  );
  await p.getByLabel("旅行地点方位示意图，北向上").waitFor();
  assert.equal(await p.locator("[data-map-point]").count(), 2);
  results.push("确认地点显示真实坐标方位图");
  await p.locator("[data-map-point]").first().click();
  await p.getByText("在高德查看地点 ↗").waitFor();
  results.push("选中地点与路线详情联动");
  const before = await trip();
  const pending = before.activities
    .filter((x) => x.start === null)
    .sort((a, b) => a.position - b.position);
  const one = p.getByRole("button", {
    name: "排序 " + pending[0].title,
    exact: true,
  });
  const two = p.getByRole("button", {
    name: "排序 " + pending[1].title,
    exact: true,
  });
  await one.scrollIntoViewIfNeeded();
  const r1 = await one.boundingBox(),
    r2 = await two.boundingBox();
  await p.mouse.move(r1.x + 15, r1.y + 15);
  await p.mouse.down();
  await p.mouse.move(r2.x + 15, r2.y + 20, { steps: 12 });
  await p.mouse.up();
  await p.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  const sorted = await trip();
  assert.equal(
    sorted.activities.find((x) => x.id === pending[0].id).position,
    1,
  );
  results.push("待安排真实鼠标排序保存");
  const row = p.locator(".travel-activity-row").filter({ hasText: "善化寺" });
  await row.getByRole("button", { name: "返回待安排" }).click();
  await p.locator("[data-pending-id]").filter({ hasText: "善化寺" }).waitFor();
  const returned = await trip();
  const temple = returned.activities.find((x) => x.title === "善化寺");
  assert.equal(temple.start, null);
  assert.equal(temple.date, "2026-10-01");
  results.push("清单按钮返回且日期保留");
  await p
    .locator("[data-pending-id]")
    .filter({ hasText: "善化寺" })
    .getByRole("button", { name: "安排时间" })
    .click();
  const dialog = p.getByRole("dialog");
  await dialog.getByLabel("开始时间（留空待安排）").fill("12:00");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const block = p.getByLabel("善化寺 at 12:00", { exact: true });
  await block.scrollIntoViewIfNeeded();
  const rect = await block.boundingBox(),
    drop = await p.locator("[data-pending-drop]").boundingBox();
  await p.mouse.move(rect.x + rect.width / 2, rect.y + 20);
  await p.mouse.down();
  await p.mouse.move(drop.x + drop.width / 2, Math.max(180, drop.y + 90), {
    steps: 15,
  });
  await p.mouse.up();
  await p.locator("[data-pending-id]").filter({ hasText: "善化寺" }).waitFor();
  assert.equal(
    (await trip()).activities.find((x) => x.title === "善化寺").start,
    null,
  );
  results.push("时间轴真实拖回待安排");
  assert.equal(await p.getByRole("dialog").count(), 0);
  await p.getByText("行程检查器与本次登录 API 用量", { exact: true }).click();
  await p.getByText("按本次登录凭据区分", { exact: false }).waitFor();
  await p
    .locator(".travel-inspection")
    .screenshot({ path: "verification/session-inspector.png" });
  results.push("检查器与当前登录API日志可见");
  await p.getByRole("button", { name: "打开旅行助手聊天" }).click();
  await p.getByLabel("对旅行助手说").waitFor();
  await p.screenshot({ path: "verification/next-desktop.png", fullPage: true });
  await p.getByRole("button", { name: "关闭", exact: true }).click();
  const m = await b.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await login(m);
  assert.equal(
    await m.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await m.getByRole("button", { name: "打开旅行助手聊天" }).click();
  assert.equal(
    await m.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await m.screenshot({ path: "verification/next-mobile-chat.png" });
  await m.getByRole("button", { name: "关闭", exact: true }).click();
  await m
    .locator(".travel-direction")
    .screenshot({ path: "verification/next-mobile-map.png" });
  results.push("390px方位图与聊天面板无横向溢出");
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/next-browser.json",
    JSON.stringify(
      { date: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  );
  console.log(results.length + "项浏览器检查通过");
} finally {
  await b.close();
}
