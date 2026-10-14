import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Client } from "../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
const model = JSON.parse(readFileSync("verification/model-api.json", "utf8"));
const account = JSON.parse(readFileSync(".runtime/demo-account.json", "utf8"));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const p = await browser.newPage({ viewport: { width: 1365, height: 900 } });
try {
  await p.goto("http://127.0.0.1:4331/login");
  await p.locator("input[type=email]").fill(account.email);
  await p.locator("input[type=password]").fill(account.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("**/app");
  await p
    .getByRole("heading", { name: "大同 · 慢慢走（示例）", exact: true })
    .waitFor();
  await p.screenshot({
    path: "verification/model-proposal-desktop.png",
    fullPage: true,
  });
  await p.getByRole("button", { name: "确认并保存", exact: true }).click();
  await p.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  const client = new Client({ name: "travel-result-readback", version: "1.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [process.cwd() + "/mcp/build/travel-index.js"],
      env: {
        ...process.env,
        TRAVEL_KEY_FILE: process.cwd() + "/.runtime/mcp-key.json",
        TRAVEL_API_URL: "http://127.0.0.1:4332",
      },
    }),
  );
  try {
    const read = await client.callTool({
      name: "get_proposal",
      arguments: { proposalId: model.proposalId },
    });
    assert.equal(read.isError, undefined);
    const prop = JSON.parse(read.content[0].text);
    assert.equal(prop.status, "applied");
    const activity = prop.result.activities.find(
      (x) =>
        x.id ===
        model.calls.find((x) => x.name === "propose_trip_change").input
          .operations[0].id,
    );
    assert.equal(activity.date, "2026-10-03");
    assert.equal(activity.start, 660);
    assert.equal(activity.duration, 90);
    assert.equal(prop.result.activities.length, 12);
    writeFileSync(
      "verification/model-confirmation.json",
      JSON.stringify(
        {
          date: "2026-10-06",
          proposalId: model.proposalId,
          webConfirmation: true,
          mcpReadback: true,
          status: prop.status,
          activityDate: activity.date,
          start: 660,
          duration: 90,
          activityCount: 12,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
  await p.screenshot({
    path: "verification/datong-desktop.png",
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: "verification/datong-mobile-width.png",
    fullPage: true,
  });
  console.log("真实千问提案→网页确认→MCP读回通过（示例数据）");
} finally {
  await browser.close();
}
