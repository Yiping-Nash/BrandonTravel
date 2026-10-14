import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const a = JSON.parse(readFileSync(".runtime/portfolio-account.json", "utf8"));
const fixture = JSON.parse(
  readFileSync("fixtures/portfolio-trip.json", "utf8"),
);
const api = async (method, path, body) => {
  const r = await fetch("http://127.0.0.1:4331/api/travel" + path, {
    method,
    headers: {
      Authorization: "Bearer " + a.token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw Error("Demo API " + r.status);
  return j.data;
};
let t = await api("POST", "/trips", {
  title: "山西七日 · 录屏演示（虚构）",
  startDate: fixture.startDate,
  endDate: fixture.endDate,
});
await api("POST", "/trips/" + t.id + "/operations", {
  expectedRevision: 0,
  requestId: randomUUID(),
  operations: fixture.activities.map((x) => ({
    type: "add",
    activity: { ...x, id: randomUUID() },
  })),
});
t = await api("GET", "/trips/" + t.id);
const initial = structuredClone(t);
mkdirSync("demo/screens", { recursive: true });
const b = await chromium.launch({ channel: "msedge", headless: true });
const context = await b.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(({ token }) => {
  localStorage.setItem("open_sunsama_token", token);
  localStorage.setItem("bt-auto-facts:v2", "false");
}, a);
await context.route("**/api/travel/exchange-rates**", (r) =>
  r.fulfill({
    status: 503,
    json: { success: false, error: { message: "演示未查询外部汇率" } },
  }),
);
const p = await context.newPage(),
  encoder = await context.newPage();
await encoder.setContent('<canvas width="1440" height="900"></canvas>');
const recording = await encoder.evaluate(() => {
  const canvas = document.querySelector("canvas");
  const type = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((x) => MediaRecorder.isTypeSupported(x));
  if (!type) throw Error("No WebM encoder");
  window.parts = [];
  window.recorder = new MediaRecorder(canvas.captureStream(5), {
    mimeType: type,
    videoBitsPerSecond: 1400000,
  });
  window.recorder.ondataavailable = (e) => {
    if (e.data.size) window.parts.push(e.data);
  };
  window.recorder.start(1000);
  return type;
});
const checks = [];
async function scene(text, seconds, image) {
  await p.evaluate((text) => {
    let e = document.getElementById("portfolio-caption");
    if (!e) {
      e = document.createElement("div");
      e.id = "portfolio-caption";
      e.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;padding:14px 24px;background:#202a31;color:white;font:18px sans-serif;z-index:999999;pointer-events:none";
      document.body.append(e);
    }
    e.textContent = text;
  }, text);
  if (image) await p.screenshot({ path: "demo/screens/" + image + ".png" });
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const frame = (await p.screenshot({ type: "jpeg", quality: 85 })).toString(
      "base64",
    );
    await encoder.evaluate(async (data) => {
      const img = new Image();
      img.src = "data:image/jpeg;base64," + data;
      await img.decode();
      document
        .querySelector("canvas")
        .getContext("2d")
        .drawImage(img, 0, 0, 1440, 900);
    }, frame);
    await new Promise((r) => setTimeout(r, 400));
  }
}
try {
  await p.goto("http://localhost:4331/");
  await p.getByRole("heading", { name: "我的旅行", exact: true }).waitFor();
  await scene(
    "BrandonTravel｜人和 AI 共用同一份行程。虚构账号、真实页面；本轮无模型和供应商调用。",
    14,
    "dashboard",
  );
  await p.goto("http://localhost:4331/trips/" + t.id);
  await p.locator("[data-block-id]").first().waitFor();
  await scene(
    "无需 AI 也能编辑：七天时间表、待安排、确定性重叠检查。缺资料不伪装成通过。",
    16,
    "planner",
  );
  await p.getByRole("button", { name: "编辑日期", exact: true }).click();
  await p.getByLabel("行程结束日期").fill("2026-10-17");
  await scene(
    "缩短行程至五天：先查看退回数量，活动不会删除。",
    12,
    "range-preview",
  );
  await p.getByRole("button", { name: "确认修改日期", exact: true }).click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  t = await api("GET", "/trips/" + t.id);
  assert.equal(t.activities.length, 22);
  assert.equal(t.revision, 2);
  assert.equal(t.activities.filter((x) => x.backlogOriginDate).length, 6);
  checks.push("range preserves 22 activities and six origin groups entries");
  await scene(
    "已保存：10月18–19日活动退回，原日期分组保留。扩大日期不会自动恢复。",
    16,
    "range-saved",
  );
  await p.getByRole("button", { name: /查看提醒/ }).click();
  await p
    .getByRole("button", { name: "定位到活动 →", exact: true })
    .first()
    .click();
  await scene(
    "问题可定位：第一天午餐与博物馆重叠 30 分钟。判断由 Domain Kernel 完成。",
    14,
    "issue",
  );
  const beforeProposal = structuredClone(t);
  const target = t.activities.find(
    (x) => x.date === "2026-10-13" && x.title.endsWith("博物馆"),
  );
  const proposal = await api("POST", "/trips/" + t.id + "/proposals", {
    expectedRevision: t.revision,
    requestId: randomUUID(),
    reason: "演示：博物馆改到13:30（API构造，非实时模型）",
    operations: [{ type: "edit", id: target.id, patch: { start: 810 } }],
  });
  assert.deepEqual(await api("GET", "/trips/" + t.id), t);
  checks.push("pending proposal leaves canonical state unchanged");
  await p.reload();
  await p.locator('[data-proposal-id="' + proposal.id + '"]').waitFor();
  await p
    .locator('[data-proposal-id="' + proposal.id + '"]')
    .scrollIntoViewIfNeeded();
  await scene(
    "确认边界演示：此提案由测试 API 构造，不是本轮 LLM 生成。确认前行程完全不变。",
    18,
    "proposal",
  );
  await p.getByRole("button", { name: "确认并保存", exact: true }).click();
  await p.waitForTimeout(1000);
  t = await api("GET", "/trips/" + t.id);
  assert.equal(t.revision, 3);
  assert.equal(t.activities.find((x) => x.id === target.id).start, 810);
  for (const old of beforeProposal.activities) {
    assert.deepEqual(
      t.activities.find((x) => x.id === old.id),
      old.id === target.id ? { ...old, start: 810 } : old,
    );
  }
  checks.push("UI confirmation commits proposal and reads back revision 3");
  await p
    .locator('[data-block-id="' + target.id + '"]')
    .scrollIntoViewIfNeeded();
  await scene(
    "用户确认后读回：博物馆 13:30–15:30，重叠消失。只改授权活动。",
    16,
    "confirmed",
  );
  await p.goto("http://localhost:4331/legacy?tripId=" + t.id);
  await p
    .getByRole("heading", { name: t.title, exact: true, level: 1 })
    .waitFor();
  await scene(
    "切换旧版：同一 Trip ID、revision 和活动内容。不是第二份行程。",
    12,
    "legacy",
  );
  writeFileSync(
    "verification/portfolio-recording.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        tripId: t.id,
        synthetic: true,
        encoding: recording,
        checks,
        realModelRequests: 0,
        providerRequests: 0,
        proposalOrigin: "deterministic API, explicitly labelled",
        recording:
          "live UI screenshot frames captured at approximately 2 fps; encoded by existing Edge MediaRecorder; no audio",
      },
      null,
      2,
    ),
  );
  const video = await encoder.evaluate(async () => {
    await new Promise((r) => {
      window.recorder.onstop = r;
      window.recorder.stop();
    });
    const bytes = new Uint8Array(await new Blob(window.parts).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(binary);
  });
  writeFileSync("demo/portfolio-demo.webm", Buffer.from(video, "base64"));
  console.log(
    "Actual UI demo recorded; no new SDK, model calls or provider calls.",
  );
} finally {
  await b.close();
}
