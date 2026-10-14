import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const a = {
  ...JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  ...JSON.parse(readFileSync(".runtime/baseline-ui-fixture.json", "utf8")),
};
const headers = { Authorization: "Bearer " + a.token };
async function read() {
  return (
    await (
      await fetch("http://127.0.0.1:4331/api/travel/trips/" + a.tripId, {
        headers,
      })
    ).json()
  ).data;
}
const initial = await read();
const activity = initial.activities.find((x) => x.title === "华严寺");
await fetch(
  "http://127.0.0.1:4331/api/travel/trips/" + a.tripId + "/operations",
  {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedRevision: initial.revision,
      requestId: crypto.randomUUID(),
      operations: [{ type: "edit", id: activity.id, patch: { start: 690 } }],
    }),
  },
);
const before = await read();
const target = before.activities.find((x) => x.title === "华严寺");
const clock = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const b = await chromium.launch({ channel: "msedge", headless: true }),
  p = await b.newPage({ viewport: { width: 1365, height: 900 } });
try {
  await p.goto("http://127.0.0.1:4331/login");
  await p.locator("input[type=email]").fill(a.email);
  await p.locator("input[type=password]").fill(a.password);
  await p.locator("button[type=submit]").click();
  await p.waitForURL("**/app");
  await p.getByLabel("选择行程").selectOption(a.tripId);
  const block = p.getByLabel(`华严寺 at ${clock(target.start)}`, {
    exact: true,
  });
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  assert.ok(box);
  await p.mouse.move(box.x + box.width / 2, box.y + 20);
  await p.mouse.down();
  await p.waitForTimeout(100);
  await p.mouse.move(box.x + box.width / 2, box.y + 52, { steps: 12 });
  await p.mouse.up();
  await p.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  assert.equal(await p.getByRole("dialog").count(), 0);
  const after = await read(),
    updated = after.activities.find((x) => x.id === target.id);
  assert.equal(updated.start, target.start + 30);
  assert.equal(updated.duration, target.duration);
  assert.equal(after.activities.filter((x) => x.id === target.id).length, 1);
  writeFileSync(
    "verification/drag.json",
    JSON.stringify(
      {
        date: "2026-10-06",
        desktopMouseDrag: true,
        minutesMoved: 30,
        durationPreserved: true,
        identityPreserved: true,
      },
      null,
      2,
    ),
  );
  console.log("上游真实拖动：15分钟吸附、移动30分钟、时长与身份保留");
} finally {
  await b.close();
}
