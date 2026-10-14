import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const a = JSON.parse(readFileSync(".runtime/next-account.json", "utf8")),
  base = "http://127.0.0.1:4331",
  headers = { Authorization: "Bearer " + a.token };
async function pending() {
  const t = (
    await (
      await fetch(base + "/api/travel/trips/" + a.tripId, { headers })
    ).json()
  ).data;
  return t.activities
    .filter((x) => x.start === null)
    .sort((a, b) => a.position - b.position);
}
const b = await chromium.launch({ channel: "msedge", headless: true });
async function login(p) {
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
  const p = await b.newPage({ viewport: { width: 1365, height: 900 } });
  await login(p);
  const before = await pending();
  assert.ok(before.length >= 2);
  const handle = p.getByRole("button", {
    name: "排序 " + before[0].title,
    exact: true,
  });
  await handle.focus();
  await p.keyboard.press("Space");
  await p.waitForTimeout(150);
  await p.keyboard.press("ArrowDown");
  await p.waitForTimeout(150);
  await p.keyboard.press("Space");
  await p.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  assert.equal((await pending())[1].id, before[0].id);
  const m = await b.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await login(m);
  const prior = await pending();
  const start = m.getByRole("button", {
      name: "排序 " + prior[0].title,
      exact: true,
    }),
    end = m.getByRole("button", {
      name: "排序 " + prior[1].title,
      exact: true,
    });
  await start.scrollIntoViewIfNeeded();
  await m.locator(".travel-workspace aside").evaluate((el) => {
    const handles = el.querySelectorAll(".travel-sort");
    const overflow =
      handles[1].getBoundingClientRect().bottom +
      16 -
      el.getBoundingClientRect().bottom;
    if (overflow > 0) el.scrollTop += overflow;
  });
  const box1 = await start.boundingBox(),
    box2 = await end.boundingBox();
  const cdp = await m.context().newCDPSession(m);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box1.x + 15, y: box1.y + 15 }],
  });
  await m.waitForTimeout(250);
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: box1.x + 15, y: box1.y + 15 + ((box2.y - box1.y + 5) * i) / 10 },
      ],
    });
    await m.waitForTimeout(30);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await m.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  assert.equal((await pending())[1].id, prior[0].id);
  writeFileSync(
    "verification/pending-accessibility.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        keyboardSort: true,
        emulatedTouchSort: true,
        physicalPhone: "未验证",
      },
      null,
      2,
    ),
  );
  console.log("键盘排序与模拟触屏长按排序通过");
} finally {
  await b.close();
}
