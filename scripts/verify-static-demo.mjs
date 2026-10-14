import { chromium, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const checks = [],
  errors = [];
try {
  for (const width of [1440, 390]) {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("http://127.0.0.1:4335/");
    await expect(p.locator("#facts")).toContainText("6594 / 351");
    const video = p.locator("video");
    await video.evaluate((v) => {
      v.load();
    });
    await p.waitForFunction(
      () =>
        document.querySelector("video").readyState >= 1 &&
        Number.isFinite(document.querySelector("video").duration),
    );
    const metadata = await video.evaluate((v) => ({
      width: v.videoWidth,
      height: v.videoHeight,
      duration: v.duration,
    }));
    if (
      metadata.width !== 1440 ||
      metadata.height !== 900 ||
      !Number.isFinite(metadata.duration) ||
      metadata.duration < 110
    )
      throw Error("Recording metadata invalid");
    await p.getByRole("tab", { name: "解释真实冲突" }).click();
    await expect(p.locator("#scene-title")).toHaveText("冲突能解释，也能定位");
    await p.getByRole("tab", { name: "确认后才写入" }).click();
    await expect(p.locator("#scene-description")).toContainText("API构造");
    await p.locator("summary").click();
    await expect(p.locator("#diff")).toContainText("900");
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow) throw Error("Horizontal overflow");
    await p.screenshot({
      path: ".runtime/static-demo-" + width + ".png",
      fullPage: true,
    });
    checks.push({
      width,
      metadata,
      tabs: true,
      evidence: true,
      noOverflow: true,
      models: 0,
      providers: 0,
    });
    await p.close();
  }
  if (errors.length) throw Error("Browser errors");
  writeFileSync(
    "verification/static-demo.json",
    JSON.stringify({ at: new Date().toISOString(), checks, errors }, null, 2),
  );
  console.log(JSON.stringify(checks));
} finally {
  await browser.close();
}
