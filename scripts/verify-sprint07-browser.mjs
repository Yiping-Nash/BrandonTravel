import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const a = {
  ...JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  ...JSON.parse(readFileSync(".runtime/sprint07-ui-fixture.json", "utf8")),
};
const base = "http://127.0.0.1:4331";
const b = await chromium.launch({ channel: "msedge", headless: true });
const checks = [],
  errors = [];
let searches = 0,
  refreshes = 0;
async function setup(viewport) {
  const p = await b.newPage({ viewport });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/api/travel/trips/*/transitions/refresh", async (route) => {
    refreshes++;
    await route.fulfill({ json: { success: true, data: [] } });
  });
  await p.route("**/api/travel/places/search?*", async (route) => {
    searches++;
    const url = new URL(route.request().url()),
      q = url.searchParams.get("query"),
      city = url.searchParams.get("city");
    if (q === "旧查询") await new Promise((r) => setTimeout(r, 1200));
    await route
      .fulfill({
        json: {
          success: true,
          data: Array.from({ length: 15 }, (_, i) => ({
            id: randomUUID(),
            poiId: q + i,
            provider: "amap",
            name: q + "候选" + i,
            city,
            address: "用于滚动验收的长地址".repeat(5),
            longitude: 113,
            latitude: 40,
            coordinateSystem: "GCJ-02",
            selectedAt: new Date().toISOString(),
          })),
        },
      })
      .catch(() => {});
  });
  await p.goto(base + "/login");
  await p.locator("input[type=email]").fill(a.email);
  await p.locator("input[type=password]").fill(a.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("**/app");
  await p.getByLabel("选择行程").selectOption(a.tripId);
  await p.locator(`[data-trip-id="${a.tripId}"]`).waitFor();
  return p;
}
async function openMiddle(p) {
  await p
    .locator(".travel-activity-row")
    .filter({ hasText: "中间待定位" })
    .locator("button")
    .first()
    .click();
  return p.getByRole("dialog");
}
try {
  const p = await setup({ width: 1365, height: 900 });
  assert.equal(await p.locator(".travel-direction").count(), 0);
  await p.waitForTimeout(1000);
  const oldRefresh = refreshes;
  await p.getByRole("button", { name: "展开方位与路程" }).click();
  await p.getByLabel("旅行地点方位示意图，北向上").waitFor();
  const map = await p.getByLabel("旅行地点方位示意图，北向上").boundingBox();
  assert.ok(map.height <= 221);
  await p.getByRole("button", { name: "收起", exact: true }).click();
  await p.waitForTimeout(200);
  assert.equal(refreshes, oldRefresh);
  checks.push("地图默认折叠、桌面220px、开合不重复刷新");
  const order = await p.evaluate(() =>
    [".travel-grid", ".travel-proposals", ".travel-day-list"].map(
      (sel) => document.querySelector(sel).getBoundingClientRect().top,
    ),
  );
  assert.ok(order[0] < order[1] && order[1] < order[2]);
  const launcher = await p
    .getByRole("button", { name: "打开旅行助手聊天" })
    .boundingBox();
  assert.ok(launcher.x > 1250 && launcher.y > 800);
  assert.equal(launcher.width, 48);
  await p.getByRole("button", { name: "打开旅行助手聊天" }).click();
  await p.locator(".travel-chat").waitFor();
  await p
    .locator(".travel-chat")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  checks.push("提案在时间表与活动清单之间，聊天48px右下悬浮入口");
  let dialog = await openMiddle(p);
  assert.equal(await dialog.getByLabel("地点搜索城市").inputValue(), "");
  assert.equal(
    await dialog.getByRole("button", { name: "大同", exact: true }).count(),
    1,
  );
  assert.equal(
    await dialog.getByRole("button", { name: "太原", exact: true }).count(),
    1,
  );
  const before = searches;
  await dialog.getByLabel("地点", { exact: true }).fill("华严寺");
  await p.waitForTimeout(700);
  assert.equal(searches, before);
  await dialog.getByRole("button", { name: "大同", exact: true }).click();
  await dialog.locator(".travel-place-result").first().waitFor();
  assert.equal(await dialog.locator(".travel-place-result").count(), 15);
  const dimensions = await dialog
    .locator(".travel-place-results")
    .evaluate((e) => ({ h: e.clientHeight, scroll: e.scrollHeight }));
  assert.ok(dimensions.h <= 240 && dimensions.scroll > dimensions.h);
  const save = await dialog
    .getByRole("button", { name: "保存", exact: true })
    .boundingBox();
  assert.ok(save.y + save.height < 900 && save.y > 0);
  await dialog.locator(".travel-place-results").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await dialog.locator(".travel-place-result").last().click();
  await dialog.getByText("高德地点 · 待保存").waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  checks.push("城市冲突选择后才搜索、候选独立滚动、保存可见、地点标签与取消");
  dialog = await openMiddle(p);
  assert.equal(
    await dialog.getByLabel("地点", { exact: true }).inputValue(),
    "旧地点文本",
  );
  await dialog.getByRole("button", { name: "大同", exact: true }).click();
  await dialog.getByLabel("地点", { exact: true }).fill("旧查询");
  await p.waitForTimeout(720);
  await dialog.getByLabel("地点", { exact: true }).fill("新查询");
  await dialog
    .locator(".travel-place-result")
    .filter({ hasText: "新查询候选0" })
    .waitFor();
  await p.waitForTimeout(1400);
  assert.equal(
    await dialog
      .locator(".travel-place-result")
      .filter({ hasText: "旧查询" })
      .count(),
    0,
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  checks.push("晚返回旧搜索不能覆盖新关键词结果");
  await p.screenshot({
    path: "verification/sprint07-desktop.png",
    fullPage: true,
  });
  const m = await setup({ width: 390, height: 844 });
  dialog = await openMiddle(m);
  await dialog.getByRole("button", { name: "太原", exact: true }).click();
  await dialog.getByLabel("地点", { exact: true }).fill("小院");
  await dialog.locator(".travel-place-result").first().waitFor();
  const md = await dialog.boundingBox(),
    ms = await dialog
      .getByRole("button", { name: "保存", exact: true })
      .boundingBox(),
    mh = await dialog.locator(".travel-place-results").boundingBox();
  assert.ok(md.height <= 844 * 0.9 + 1);
  assert.ok(ms.y >= 0 && ms.y + ms.height <= 844);
  assert.ok(mh.height <= 181);
  await m.screenshot({ path: "verification/sprint07-mobile-dialog.png" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await m.getByRole("button", { name: "展开方位与路程" }).click();
  const mm = await m.getByLabel("旅行地点方位示意图，北向上").boundingBox();
  assert.ok(mm.height <= 181);
  checks.push("390px窄屏：90dvh弹窗、按钮可见、180px候选/地图");
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint07-browser.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        mode: "real browser + isolated trip + mocked map search/refresh; not physical phone",
        checks,
        errors,
        searches,
      },
      null,
      2,
    ),
  );
  console.log(checks.length + "项Sprint07浏览器验收通过");
} finally {
  await b.close();
}
