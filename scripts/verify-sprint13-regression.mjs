import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const checks = [];
for (const [name, script] of [
  ["领域API与真实MCP协议", "verify-travel.mjs"],
  ["基础网页创建与刷新", "verify-browser.mjs"],
  ["时间轴拖动与改变时长", "verify-drag.mjs"],
  ["键盘/模拟触控排序", "verify-pending-accessibility.mjs"],
  ["聊天模拟收据/权限", "verify-sprint07-chat.mjs"],
  ["日期可靠性/精简上下文模拟", "verify-sprint08.mjs"],
]) {
  const r = spawnSync(process.execPath, ["scripts/" + script], {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  writeFileSync(".runtime/sprint13-" + script + ".log", r.stdout + r.stderr);
  checks.push({ name, exitCode: r.status, passed: r.status === 0 });
  console.log(name + ": " + r.status);
  if (r.status !== 0) {
    console.log((r.stdout + r.stderr).slice(-2500));
    break;
  }
}
writeFileSync(
  "verification/sprint13-regression.json",
  JSON.stringify({ date: new Date().toISOString(), checks }, null, 2),
);
if (checks.some((c) => !c.passed)) process.exitCode = 1;
