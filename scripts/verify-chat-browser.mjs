import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const a = JSON.parse(readFileSync(".runtime/live-chat-case.json", "utf8"));
const evidence = JSON.parse(
  readFileSync("verification/chat-live.json", "utf8"),
);
assert.ok(evidence.calls <= 4, "第二条预留6轮，不得超过累计10轮");
const b = await chromium.launch({ channel: "msedge", headless: true }),
  p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await p.goto("http://127.0.0.1:4331/login");
  await p.locator("input[type=email]").fill(a.email);
  await p.locator("input[type=password]").fill(a.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("**/app");
  await p.getByLabel("选择行程").selectOption(a.tripId);
  await p
    .getByRole("heading", { name: "地图与聊天验收", exact: true })
    .waitFor();
  const token = await p.evaluate(() =>
    localStorage.getItem("open_sunsama_token"),
  );
  const headers = { Authorization: "Bearer " + token };
  const read = async (path) =>
    (
      await (
        await fetch("http://127.0.0.1:4331/api/travel" + path, { headers })
      ).json()
    ).data;
  const proposal = await read("/proposals/" + a.proposalId);
  const card = p
    .locator(".travel-proposals article")
    .filter({ hasText: proposal.reason });
  await card.getByRole("button", { name: "确认并保存", exact: true }).click();
  await p.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  const updated = await read("/trips/" + a.tripId);
  assert.equal(updated.activities.find((x) => x.title === "华严寺").start, 840);
  assert.equal((await read("/proposals/" + a.proposalId)).status, "applied");
  await p.getByRole("button", { name: "打开旅行助手聊天" }).click();
  await p
    .getByLabel("对旅行助手说")
    .fill(
      "检查第一天的路程是否来得及。先读取最新行程和当前transition信息，未知就说明未知，不要改计划。",
    );
  await p.getByRole("button", { name: "发送", exact: true }).click();
  let latest;
  const stopAt = Date.now() + 95000;
  while (Date.now() < stopAt) {
    const runs = await read(`/trips/${a.tripId}/chat`);
    latest = runs.at(-1);
    if (latest.message.startsWith("检查第一天") && latest.status !== "running")
      break;
    await new Promise((r) => setTimeout(r, 700));
  }
  assert.equal(latest.status, "done", JSON.stringify(latest.events));
  assert.ok(
    latest.events.some((e) => e.name === "get_trip" && e.status === "done"),
  );
  assert.ok(
    latest.events.some(
      (e) =>
        ["get_transitions", "refresh_transitions"].includes(e.name) &&
        e.status === "done",
    ),
  );
  assert.equal((await read("/trips/" + a.tripId)).revision, updated.revision);
  assert.ok(evidence.calls + latest.requests <= 10);
  await p
    .locator(".travel-chat")
    .screenshot({ path: "verification/chat-live-browser.png" });
  await p.getByRole("button", { name: "关闭", exact: true }).click();
  await p
    .locator(".travel-direction")
    .screenshot({ path: "verification/map-two-places.png" });
  await p.getByText("行程检查器与本次登录 API 用量", { exact: true }).click();
  await p.getByRole("button", { name: "刷新检查记录", exact: true }).click();
  const usage = await read("/usage");
  assert.ok(usage.totals.some((x) => x.provider === "model"));
  writeFileSync(
    "verification/chat-browser.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        confirmedInBrowser: true,
        proposalApplied: true,
        updatedStateRead: true,
        secondTurn: {
          status: latest.status,
          requests: latest.requests,
          inputTokens: latest.inputTokens,
          outputTokens: latest.outputTokens,
          tools: latest.events
            .filter((e) => e.kind === "tool")
            .map((e) => ({ name: e.name, status: e.status })),
        },
        totalRequests: evidence.calls + latest.requests,
        currentLoginModelCallsVisible: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "真实网页确认/读回/第二轮路程判断通过，累计模型请求",
    evidence.calls + latest.requests,
  );
} finally {
  await b.close();
}
