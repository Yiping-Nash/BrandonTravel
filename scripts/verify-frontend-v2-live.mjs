import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
const account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  base = "http://127.0.0.1:4331/api";
let token;
async function api(path, method = "GET", body, expected = 200) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Travel-Test": "true",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json();
  assert.equal(
    r.status,
    expected,
    `${method} ${path}: ${JSON.stringify(json)}`,
  );
  return json.data;
}
token = (await api("/auth/login", "POST", account)).token;
const trip = await api(
  "/travel/trips",
  "POST",
  {
    title: "Frontend V2隔离持久化验收",
    startDate: "2026-10-13",
    endDate: "2026-10-20",
  },
  201,
);
const a = {
  id: randomUUID(),
  title: "隔离古建参观",
  notes: "虚构验收，不涉及用户原行程",
  place: "待确认",
  date: trip.startDate,
  start: 600,
  duration: 60,
  locked: false,
  position: 0,
};
await api(`/travel/trips/${trip.id}/operations`, "POST", {
  requestId: randomUUID(),
  expectedRevision: 0,
  operations: [{ type: "add", activity: a }],
});
const client = new Client({ name: "frontend-v2-acceptance", version: "1.0" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
let proposalId;
let trialTrace = [];
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [process.cwd() + "/mcp/build/travel-index.js"],
      env: {
        ...process.env,
        TRAVEL_KEY_FILE: process.cwd() + "/.runtime/test-key.json",
        TRAVEL_API_URL: "http://127.0.0.1:4332",
      },
    }),
  );
  const tools = await client.listTools();
  assert.ok(tools.tools.some((t) => t.name === "propose_trip_change"));
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  let runs = [];
  await page.route("**/api/travel/exchange-rates*", (r) =>
    r.fulfill({
      status: 503,
      json: { success: false, error: { message: "验收禁止隐式外部调用" } },
    }),
  );
  await page.route(`**/api/travel/trips/${trip.id}/chat`, async (r) => {
    if (r.request().method() === "POST") {
      const message = r.request().postDataJSON().message;
      if (message === "模拟失败" || message === "模拟停止") {
        const run = {
          id: randomUUID(),
          tripId: trip.id,
          message,
          status: message === "模拟失败" ? "failed" : "running",
          outcome: message === "模拟失败" ? "incomplete" : undefined,
          events:
            message === "模拟失败"
              ? [{ kind: "error", text: "模拟工具失败，行程没有修改" }]
              : [],
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          createdAt: new Date().toISOString(),
        };
        runs.push(run);
        return r.fulfill({ json: { success: true, data: run } });
      }

      const state = await api(`/travel/trips/${trip.id}`);
      const read = await client.callTool({
        name: "get_trip",
        arguments: { tripId: trip.id, view: "day", date: trip.startDate },
      });
      assert.ok(!read.isError);
      trialTrace.push("真实MCP get_trip");
      const result = await client.callTool({
        name: "propose_trip_change",
        arguments: {
          tripId: trip.id,
          requestId: randomUUID(),
          expectedRevision: state.revision,
          reason: "新版隔离协议验收（模拟模型，真实MCP）",
          operations: [{ type: "edit", id: a.id, patch: { start: 660 } }],
        },
      });
      assert.ok(!result.isError);
      const receipt = JSON.parse(result.content[0].text);
      proposalId = receipt.id;
      assert.ok(proposalId);
      trialTrace.push("真实MCP propose_trip_change");
      const run = {
        id: randomUUID(),
        tripId: trip.id,
        message: r.request().postDataJSON().message,
        status: "done",
        outcome: "proposal_created",
        events: [
          {
            kind: "tool",
            name: "get_trip",
            status: "done",
            text: "真实MCP读取完成",
          },
          {
            kind: "tool",
            name: "propose_trip_change",
            status: "done",
            text: "真实MCP提案完成",
            proposalId,
          },
          {
            kind: "answer",
            text: "模拟模型摘要：将隔离古建参观改为11:00，请确认。",
          },
        ],
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        createdAt: new Date().toISOString(),
      };
      runs.push(run);
      return r.fulfill({ json: { success: true, data: run } });
    }
    for (const run of runs)
      for (const event of run.events)
        if (event.proposalId)
          event.proposalStatus = (
            await api(`/travel/proposals/${event.proposalId}`)
          ).status;
    return r.fulfill({ json: { success: true, data: runs } });
  });
  await page.route(`**/api/travel/trips/${trip.id}/chat/*/stop`, async (r) => {
    const run = runs.find((x) => x.status === "running");
    run.status = "cancelled";
    run.outcome = "incomplete";
    run.events = [{ kind: "error", text: "模拟用户已停止" }];
    return r.fulfill({ json: { success: true, data: run } });
  });
  await page.goto("http://127.0.0.1:4331/login");
  await page.locator("input[type=email]").fill(account.email);
  await page.locator("input[type=password]").fill(account.password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL("http://127.0.0.1:4331/");
  await page.goto(`http://127.0.0.1:4331/trips/${trip.id}`);
  await page.getByRole("heading", { name: trip.title, level: 1 }).waitFor();
  await page.getByRole("button", { name: "✦ 问 Brandon" }).click();
  await page.getByLabel("对旅行助手说").fill("把隔离古建参观改到十一点");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "确认并保存", exact: true }).waitFor();
  assert.equal(
    (await api(`/travel/trips/${trip.id}`)).activities[0].start,
    600,
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "确认并保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  const after = await api(`/travel/trips/${trip.id}`);
  assert.equal(after.activities[0].start, 660);
  assert.equal(after.activities[0].id, a.id);
  assert.equal(
    (await api(`/travel/proposals/${proposalId}`)).status,
    "applied",
  );
  trialTrace.push("用户UI确认/数据库读回");
  await page.getByRole("button", { name: "✦ 问 Brandon" }).click();
  await page
    .locator(".travel-tool")
    .filter({ hasText: "propose_trip_change" })
    .locator("summary")
    .click();
  await page
    .locator(".travel-tool")
    .filter({ hasText: "propose_trip_change" })
    .getByText(/applied/)
    .waitFor();
  await page.getByLabel("对旅行助手说").fill("模拟失败");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("模拟工具失败，行程没有修改", { exact: true }).waitFor();
  assert.equal(
    (await api(`/travel/trips/${trip.id}`)).revision,
    after.revision,
  );
  await page.getByLabel("对旅行助手说").fill("模拟停止");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "停止本条", exact: true }).click();
  await page.getByText("模拟用户已停止", { exact: true }).waitFor();
  assert.equal(
    (await api(`/travel/trips/${trip.id}`)).revision,
    after.revision,
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  trialTrace.push("聊天已执行状态/失败/停止均不伪报修改");

  await page.getByRole("link", { name: "切换旧版" }).click();
  await page.locator(`.travel-app[data-trip-id="${trip.id}"]`).waitFor();
  assert.equal(
    await page.locator(".travel-app").getAttribute("data-trip-id"),
    trip.id,
  );
  assert.equal(
    (await api(`/travel/trips/${trip.id}`)).revision,
    after.revision,
  );
  // A stale proposal remains pending and cannot be confirmed after another edit.
  const p = await api(
    `/travel/trips/${trip.id}/proposals`,
    "POST",
    {
      requestId: randomUUID(),
      expectedRevision: after.revision,
      reason: "过期保护验收",
      operations: [{ type: "edit", id: a.id, patch: { start: 720 } }],
    },
    201,
  );
  await api(`/travel/trips/${trip.id}/operations`, "POST", {
    requestId: randomUUID(),
    expectedRevision: after.revision,
    operations: [
      { type: "edit", id: a.id, patch: { notes: "用户已另行编辑" } },
    ],
  });
  await api(`/travel/proposals/${p.id}/confirm`, "POST", {}, 409);
  assert.equal(
    (await api(`/travel/trips/${trip.id}`)).activities[0].start,
    660,
  );
  trialTrace.push("过期确认拒绝，状态不变");
  await page.goto(`http://127.0.0.1:4331/trips/${trip.id}`);
  await page.getByRole("heading", { name: trip.title, level: 1 }).waitFor();
  await page.getByRole("button", { name: "确认并保存", exact: true }).waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "确认并保存", exact: true })
      .isDisabled(),
  );
  const usageBefore = await api("/travel/usage");
  const rate = await api("/travel/exchange-rates?base=CNY");
  assert.ok(rate.rates.USD > 0);
  const cached = await api("/travel/exchange-rates?base=CNY");
  assert.ok(cached.cache);
  const usageAfter = await api("/travel/usage");
  const total = (u) =>
    u.totals
      .filter(
        (t) =>
          t.provider === "frankfurter" &&
          ["success", "failed"].includes(t.status),
      )
      .reduce((n, t) => n + t.count, 0);
  await api("/travel/exchange-rates?base=INVALID", "GET", undefined, 422);
  const r = await fetch(base + "/travel/exchange-rates?base=CNY");
  assert.equal(r.status, 401);
  writeFileSync(
    "verification/frontend-v2-live.json",
    JSON.stringify(
      {
        tripId: trip.id,
        trialTrace,
        canonicalIdentityPreserved: true,
        beforeStart: 600,
        afterStart: 660,
        revision: after.revision,
        realMCP: true,
        modelSimulated: true,
        modelRequests: 0,
        amapRequests: 0,
        weatherRequests: 0,
        exchangeActualRequests: total(usageAfter) - total(usageBefore),
        exchange: { date: rate.date, source: rate.source, cache: cached.cache },
        staleProposalUIBlocked: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      trialTrace,
      exchangeActualRequests: total(usageAfter) - total(usageBefore),
    }),
  );
} finally {
  await client.close();
  await browser.close();
}
