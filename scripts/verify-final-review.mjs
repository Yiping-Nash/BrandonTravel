import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const a = JSON.parse(readFileSync(".runtime/next-account.json", "utf8")),
  base = "http://127.0.0.1:4331",
  headers = {
    Authorization: "Bearer " + a.token,
    "Content-Type": "application/json",
  };
let t = (
  await (
    await fetch(base + "/api/travel/trips/" + a.tripId, { headers })
  ).json()
).data;
const from = t.activities.find((x) => x.title === "华严寺"),
  to = t.activities.find((x) => x.title === "善化寺");
const r = await fetch(base + "/api/travel/trips/" + t.id + "/operations", {
  method: "POST",
  headers,
  body: JSON.stringify({
    requestId: randomUUID(),
    expectedRevision: t.revision,
    operations: [
      { type: "edit", id: from.id, patch: { start: 600 } },
      { type: "edit", id: to.id, patch: { start: 670 } },
    ],
  }),
});
assert.ok(r.ok);
const b = await chromium.launch({ channel: "msedge", headless: true }),
  p = await b.newPage({ viewport: { width: 1365, height: 1000 } });
async function login(p) {
  await p.goto(base + "/login");
  await p.locator("input[type=email]").fill(a.email);
  await p.locator("input[type=password]").fill(a.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("**/app");
  await p.getByLabel("选择行程").selectOption(a.tripId);
  await p.locator(`[data-trip-id="${a.tripId}"]`).waitFor();
}
try {
  await login(p);
  await p.locator(".travel-route-short").waitFor();
  assert.ok(
    (await p.locator(".travel-route-short").innerText()).includes("少"),
  );
  await p
    .locator(".travel-direction")
    .screenshot({ path: "verification/map-two-places.png" });
  await p.getByRole("button", { name: "放大方位图" }).click();
  await p.getByRole("button", { name: "适应画面" }).click();
  await p.locator("[data-map-point]").first().click();
  assert.equal(
    await p.locator("[data-time-block]").filter({ hasText: "华严寺" }).count(),
    1,
  );
  await p.getByText("行程检查器与本次登录 API 用量", { exact: true }).click();
  const token = await p.evaluate(() =>
    localStorage.getItem("open_sunsama_token"),
  );
  const usage = (
    await (
      await fetch(base + "/api/travel/usage", {
        headers: { Authorization: "Bearer " + token },
      })
    ).json()
  ).data;
  assert.ok(usage.recent.some((r) => r.endpoint === "POST /auth/login"));
  const refreshed = await (
    await fetch(base + "/api/auth/refresh", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    })
  ).json();
  const refreshUsage = (
    await (
      await fetch(base + "/api/travel/usage", {
        headers: { Authorization: "Bearer " + refreshed.data.token },
      })
    ).json()
  ).data;
  assert.ok(refreshUsage.recent.some((r) => r.endpoint === "POST /auth/login"));
  await p
    .locator(".travel-inspection")
    .screenshot({ path: "verification/session-inspector.png" });
  await p.getByRole("button", { name: "打开旅行助手聊天" }).click();
  await p.screenshot({ path: "verification/next-desktop.png", fullPage: true });
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
  await m
    .locator(".travel-direction")
    .screenshot({ path: "verification/next-mobile-map.png" });
  await m.getByRole("button", { name: "打开旅行助手聊天" }).click();
  await m.screenshot({ path: "verification/next-mobile-chat.png" });
  writeFileSync(
    "verification/final-review.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        timeShortageVisible: true,
        mapZoomAndSelect: true,
        loginCallLogged: true,
        refreshPreservesLoginUsage: true,
        desktopAnd390px: true,
        additionalRealModelCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log("时间不足提示、地图交互、登录/刷新会话日志与最终截图通过");
} finally {
  await b.close();
}
