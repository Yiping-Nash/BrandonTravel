import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const account = JSON.parse(
  readFileSync(".runtime/portfolio-account.json", "utf8"),
);
const demo = JSON.parse(readFileSync(".runtime/portfolio-demo.json", "utf8"));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.addInitScript(({ token }) => {
    localStorage.setItem("open_sunsama_token", token);
    localStorage.setItem("bt-auto-facts:v2", "false");
  }, account);
  await page.route("**/api/travel/exchange-rates**", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: { message: "展示截图未查询外部汇率" },
      }),
    }),
  );
  await page.goto("http://localhost:4331/");
  await page
    .getByText("山西七日 · 公开演示副本（虚构）", { exact: true })
    .first()
    .waitFor();
  await page.screenshot({ path: "assets/dashboard.png", fullPage: true });
  await page.goto("http://localhost:4331/trips/" + demo.tripId);
  await page
    .getByText("山西七日 · 公开演示副本（虚构）", { exact: true })
    .first()
    .waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "assets/planner.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "assets/planner-mobile.png", fullPage: true });
  console.log(
    "Captured actual V2 from persisted synthetic fixture; no agent interaction fabricated.",
  );
} finally {
  await browser.close();
}
