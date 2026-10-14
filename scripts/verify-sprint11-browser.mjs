import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  fixture = JSON.parse(
    readFileSync("verification/sprint11-ui-fixture.json", "utf8"),
  );
fixture.evaluation.evaluatedAt = new Date().toISOString();
fixture.evaluation.expiresAt = new Date(Date.now() + 60000).toISOString();
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("browser-error:", e.message);
    });
    let requests = 0,
      showStale = false;
    await page.route("**/api/travel/**", async (r) => {
      const path = new URL(r.request().url()).pathname.replace(
        "/api/travel",
        "",
      );
      let data;
      if (path === "/trips") data = [fixture.trip];
      else if (path === `/trips/${fixture.trip.id}`) data = fixture.trip;
      else if (path.includes("/intelligence")) {
        requests++;
        if (showStale) {
          data = structuredClone(fixture.evaluation);
          const rule = data.results.find((r) => r.rule === "TRANSITION_GAP");
          rule.state = "UNKNOWN";
          rule.severity = "info";
          rule.reasonCode = "FACT_STALE";
          rule.details.durationSeconds = null;
          rule.details.shortageMinutes = null;
          data.counts.CONFLICT--;
          data.counts.UNKNOWN++;
          return r.fulfill({ json: { success: true, data } });
        }
        if (requests === 1) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          data = {
            ...fixture.evaluation,
            tripRevision: fixture.trip.revision - 1,
          };
        } else if (requests === 3)
          data = { ...fixture.evaluation, factsVersion: 0 };
        else data = fixture.evaluation;
      } else if (path.includes("transitions"))
        data = showStale
          ? fixture.transitions.map((t) => ({
              ...t,
              freshness: "stale",
              shortageMinutes: null,
            }))
          : fixture.transitions;
      else if (path.includes("operational-facts"))
        data = {
          tripRevision: fixture.trip.revision,
          factsVersion: fixture.evaluation.factsVersion,
          facts: [],
          sources: [],
          gaps: [],
        };
      else if (path.includes("proposals"))
        data = { items: [], total: 0, historyTotal: 0, nextCursor: null };
      else return r.continue();
      return r.fulfill({ json: { success: true, data } });
    });
    await page.goto("http://127.0.0.1:4331/login");
    await page.locator("input[type=email]").fill(account.email);
    await page.locator("input[type=password]").fill(account.password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL("**/app");
    await page.getByLabel("选择行程").selectOption(fixture.trip.id);
    await page.waitForTimeout(100);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("travel-facts-updated")),
    );
    const panel = page.locator(".travel-intelligence");
    await panel.locator('[data-reason="OPENING_NOT_COVERED"]').waitFor();
    assert.match(await panel.innerText(), /不在营业区间/);
    assert.equal(
      await panel.locator('[data-reason="ACTIVITY_OVERLAP"]').count(),
      1,
    );
    const route = fixture.evaluation.results.find(
      (x) => x.rule === "TRANSITION_GAP",
    );
    assert.match(
      await panel.innerText(),
      new RegExp("不足" + route.details.shortageMinutes + "分钟"),
    );
    await page.waitForTimeout(700);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("travel-facts-updated")),
    );
    await page.waitForTimeout(250);
    await panel.locator("article details summary").first().click();
    assert.match(
      await panel.innerText(),
      new RegExp("事实版本" + fixture.evaluation.factsVersion),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    showStale = true;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("travel-facts-updated")),
    );
    await panel.locator('[data-reason="FACT_STALE"]').waitFor();
    assert.equal(
      await panel.locator('[data-reason="TRANSITION_TIME_SHORTAGE"]').count(),
      0,
    );
    await page.getByRole("button", { name: "展开方位与路程" }).click();
    await page.getByRole("button", { name: "刷新高德路程" }).click();
    await page
      .getByText("路程未知（估计已过期）", { exact: true })
      .first()
      .waitFor();
    await page.screenshot({
      path: `verification/sprint11-${viewport.width}.png`,
      fullPage: true,
    });
    checks.push(
      `${viewport.width}px冲突/营业解释/旧响应保护/版本/过期未知/无横向溢出`,
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "verification/sprint11-browser.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        checks,
        errors,
        fixtureSource: "隔离REST实际返回",
        realExternalCalls: 0,
        modelCalls: 0,
        realMobileDevice: "unverified",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(checks));
} finally {
  await browser.close();
}
