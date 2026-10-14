import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  fixture = JSON.parse(
    readFileSync(".runtime/sprint08-ui-fixture.json", "utf8"),
  );
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
let headers;
async function api(url, method = "GET", body) {
  const r = await fetch("http://127.0.0.1:4332/travel" + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return data.data;
}
async function page(viewport) {
  const p = await browser.newPage({ viewport });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/transitions/refresh", (r) =>
    r.fulfill({ json: { success: true, data: [] } }),
  );
  await p.goto("http://127.0.0.1:4331/login");
  await p.locator("input[type=email]").fill(a.email);
  await p.locator("input[type=password]").fill(a.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("**/app");
  await p.getByLabel("选择行程").selectOption(fixture.tripId);
  await p.locator(`[data-trip-id="${fixture.tripId}"]`).waitFor();
  return p;
}
try {
  const login = await (
    await fetch("http://127.0.0.1:4332/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: a.email, password: a.password }),
    })
  ).json();
  headers = {
    Authorization: "Bearer " + login.data.token,
    "Content-Type": "application/json",
  };
  const p = await page({ width: 1440, height: 1000 });
  const history = p.locator(".travel-proposals-history");
  assert.equal(await history.getAttribute("open"), null);
  assert.equal(await p.locator(".travel-proposals-pending article").count(), 1);
  assert.match(
    await p.locator(".travel-proposals-pending").innerText(),
    /已过期/,
  );
  checks.push("待处理显示过期保护；历史默认折叠");
  await history.locator("summary").click();
  await p.waitForFunction(
    () =>
      document.querySelectorAll(".travel-proposals-history article").length ===
      20,
  );
  assert.match(
    await history.locator("article").first().innerText(),
    /隔离历史22/,
  );
  await history.getByRole("button", { name: "加载更多历史" }).click();
  await p.waitForFunction(
    () =>
      document.querySelectorAll(".travel-proposals-history article").length ===
      24,
  );
  checks.push("历史首次20条，继续加载24条且按最近处理排序");
  await history.locator("summary").click();
  await p.getByRole("button", { name: "打开旅行助手聊天" }).click();
  await p.locator(".travel-chat").waitFor();
  const proposalTool = p
    .locator(".travel-chat details.travel-tool")
    .filter({ hasText: "propose_trip_change" })
    .filter({ hasText: "applied" })
    .first();
  await proposalTool.locator("summary").click();
  assert.match(await proposalTool.innerText(), /已处理/);
  checks.push("聊天实时状态已执行，生成时摘要保留历史含义");
  await p
    .locator(".travel-chat")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const aside = p.getByLabel("待安排拖回区域");
  assert.equal(Math.round((await aside.boundingBox()).height), 640);
  const tripId = fixture.tripId;
  async function reset(count) {
    let t = await api(`/trips/${tripId}`);
    const extra = t.activities.filter((x) => x.title.startsWith("拖回样本"));
    const ops = extra.map((x) => ({ type: "delete", id: x.id }));
    ops.push({
      type: "edit",
      id: fixture.activityIds[0],
      patch: { start: 645 },
    });
    for (let i = 0; i < count; i++)
      ops.push({
        type: "add",
        activity: {
          id: randomUUID(),
          title: "拖回样本" + i,
          notes: "",
          place: "待确认",
          date: "2026-10-01",
          start: null,
          duration: 60,
          locked: false,
          position: 20 + i,
        },
      });
    await api(`/trips/${tripId}/operations`, "POST", {
      expectedRevision: t.revision,
      requestId: randomUUID(),
      operations: ops,
    });
    await p.reload();
    await p.getByLabel("选择行程").selectOption(tripId);
    await p.locator(`[data-trip-id="${tripId}"]`).waitFor();
    await p.waitForFunction(
      (n) => document.querySelectorAll("[data-pending-id]").length === n,
      count,
    );
  }
  async function startDrag() {
    const block = p.getByLabel("华严寺 at 10:45", { exact: true });
    await block.scrollIntoViewIfNeeded();
    const box = await block.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + 16);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2 + 12, box.y + 20, { steps: 4 });
    return box;
  }
  for (const [n, target] of [
    [0, "bottom"],
    [1, "bottom"],
    [3, "bottom"],
    [0, "header"],
    [3, "gap"],
  ]) {
    await reset(n);
    const before = await api(`/trips/${tripId}`);
    await startDrag();
    const box = await aside.boundingBox(),
      visibleBottom = Math.min(box.y + box.height, 990);
    let y = visibleBottom - 25;
    if (target === "header") y = box.y + 18;
    if (target === "gap") {
      const cards = await p
        .locator("[data-pending-id]")
        .evaluateAll((es) =>
          es.map((e) => ({
            top: e.getBoundingClientRect().top,
            bottom: e.getBoundingClientRect().bottom,
          })),
        );
      y = (cards[0].bottom + cards[1].top) / 2;
    }
    await p.mouse.move(box.x + box.width / 2, y, { steps: 15 });
    assert.ok(
      ((await aside.getAttribute("class")) ?? "").includes(
        "travel-drop-active",
      ),
    );
    await p.mouse.up();
    await p.waitForFunction(
      (n) => document.querySelectorAll("[data-pending-id]").length === n,
      n + 1,
    );
    const after = await api(`/trips/${tripId}`),
      activity = after.activities.find((x) => x.id === fixture.activityIds[0]);
    assert.equal(activity.start, null);
    assert.equal(activity.date, "2026-10-01");
    assert.equal(after.activities.length, before.activities.length);
    assert.ok(
      !((await aside.getAttribute("class")) ?? "").includes(
        "travel-drop-active",
      ),
    );
  }
  checks.push(
    "0/1/多卡片：容器标题、卡片间隙及底部空白拖回成功，身份日期保留，高亮结束清除",
  );
  await reset(12);
  assert.ok(await aside.evaluate((e) => e.scrollHeight > e.clientHeight));
  await aside.evaluate((e) => (e.scrollTop = e.scrollHeight));
  assert.ok(await aside.evaluate((e) => e.scrollTop > 0));
  checks.push("固定640px，列表内部滚动");
  await reset(0);
  const beforeCancel = await api(`/trips/${tripId}`);
  await startDrag();
  await p.keyboard.press("Escape");
  await p.mouse.up();
  await p.waitForTimeout(200);
  assert.equal((await api(`/trips/${tripId}`)).revision, beforeCancel.revision);
  assert.ok(
    !((await aside.getAttribute("class")) ?? "").includes("travel-drop-active"),
  );
  checks.push("取消拖动不写状态，清理容器高亮");

  await reset(0);
  const outsideBefore = await api(`/trips/${tripId}`);
  await startDrag();
  let box = await aside.boundingBox();
  await p.mouse.move(box.x + 20, Math.min(box.y + box.height + 12, 995), {
    steps: 12,
  });
  assert.ok(
    !((await aside.getAttribute("class")) ?? "").includes("travel-drop-active"),
  );
  await p.mouse.up();
  assert.equal(
    (await api(`/trips/${tripId}`)).revision,
    outsideBefore.revision,
  );
  checks.push("容器外不命中，拖出清除高亮且不写计划");
  await reset(0);
  let conflictBefore = await api(`/trips/${tripId}`);
  await startDrag();
  await api(`/trips/${tripId}/operations`, "POST", {
    requestId: randomUUID(),
    expectedRevision: conflictBefore.revision,
    operations: [
      {
        type: "edit",
        id: fixture.activityIds[0],
        patch: { notes: "并发审查样本" },
      },
    ],
  });
  box = await aside.boundingBox();
  await p.mouse.move(box.x + 40, Math.min(box.y + box.height - 20, 990), {
    steps: 12,
  });
  await p.mouse.up();
  await p.waitForTimeout(350);
  let conflictAfter = await api(`/trips/${tripId}`);
  assert.equal(
    conflictAfter.activities.find((x) => x.id === fixture.activityIds[0]).start,
    645,
  );
  assert.equal(conflictAfter.revision, conflictBefore.revision + 1);
  checks.push("拖动期间并发修改产生版本冲突，活动不丢且未错误返回待安排");
  await reset(0);
  const failBefore = await api(`/trips/${tripId}`);
  await p.route("**/travel/trips/*/operations", (r) =>
    r.fulfill({
      status: 500,
      json: { success: false, error: { message: "模拟保存失败" } },
    }),
  );
  await startDrag();
  box = await aside.boundingBox();
  await p.mouse.move(box.x + 40, Math.min(box.y + box.height - 20, 990), {
    steps: 12,
  });
  await p.mouse.up();
  await p.getByText("模拟保存失败", { exact: true }).waitFor();
  assert.equal((await api(`/trips/${tripId}`)).revision, failBefore.revision);
  assert.equal(
    (await api(`/trips/${tripId}`)).activities.find(
      (x) => x.id === fixture.activityIds[0],
    ).start,
    645,
  );
  await p.unroute("**/travel/trips/*/operations");
  checks.push("保存失败显式提示，服务端活动与身份不变");
  const m = await page({ width: 390, height: 844 });
  assert.equal(
    Math.round((await m.getByLabel("待安排拖回区域").boundingBox()).height),
    300,
  );
  assert.ok(
    await m
      .getByLabel("待安排拖回区域")
      .evaluate((e) => e.getBoundingClientRect().right <= innerWidth),
  );
  checks.push("390px窄屏待安排容器300px，无横向溢出（非真机）");
  assert.deepEqual(errors, []);
  await p.screenshot({
    path: "verification/sprint08-desktop.png",
    fullPage: false,
  });
  await m.screenshot({
    path: "verification/sprint08-mobile.png",
    fullPage: false,
  });
  writeFileSync(
    "verification/sprint08-browser.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        mode: "real Edge browser, isolated trip, map refresh intercepted, zero external requests",
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(checks.length + "项Sprint08浏览器验收通过");
} finally {
  await browser.close();
}
