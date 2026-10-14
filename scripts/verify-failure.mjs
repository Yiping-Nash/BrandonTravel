import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const db = (action) =>
  execFileSync(
    "pwsh",
    ["-NoProfile", "-File", "scripts/local-db.ps1", action],
    { stdio: "ignore" },
  );
const browser = await chromium.launch({ channel: "msedge", headless: true });
const p = await browser.newPage();
let stopped = false;
async function getTrip() {
  const r = await fetch("http://127.0.0.1:4331/api/travel/trips/" + a.tripId, {
    headers: { Authorization: "Bearer " + a.token },
  });
  return (await r.json()).data;
}
try {
  const before = await getTrip();
  await p.goto("http://127.0.0.1:4331/login");
  await p.locator("input[type=email]").fill(a.email);
  await p.locator("input[type=password]").fill(a.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("**/app");
  await p.getByRole("button", { name: "添加活动", exact: true }).click();
  const d = p.getByRole("dialog");
  await d.getByLabel("标题", { exact: true }).fill("数据库失败不应保存");
  db("stop");
  stopped = true;
  await d.getByRole("button", { name: "保存", exact: true }).click();
  await d.getByRole("alert").waitFor();
  assert.equal(await d.isVisible(), true);
  assert.equal(
    await d.getByLabel("标题", { exact: true }).inputValue(),
    "数据库失败不应保存",
  );
  db("start");
  stopped = false;
  const after = await getTrip();
  assert.deepEqual(after, before);
  writeFileSync(
    "verification/failure-restart.json",
    JSON.stringify(
      {
        date: "2026-10-06",
        databaseStopped: true,
        saveFailureVisible: true,
        draftPreserved: true,
        restoredStateUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log("真实数据库停机：保存失败可见、草稿保留、重启后状态不变");
} finally {
  if (stopped) db("start");
  await browser.close();
}
