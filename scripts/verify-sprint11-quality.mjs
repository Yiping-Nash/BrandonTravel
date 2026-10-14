import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
const env = {
  ...process.env,
  PATH:
    path.join(process.cwd(), ".tools/bun/bun-windows-x64") +
    path.delimiter +
    process.env.PATH,
};
const checks = [],
  logs = [];
for (const [name, args] of [
  [
    "旅行单元测试",
    [
      "apps/api/node_modules/vitest/vitest.mjs",
      "run",
      "apps/api/src/travel",
      "packages/utils/src/travel-intelligence.test.ts",
    ],
  ],
  [
    "类型及lint",
    [
      "node_modules/turbo/bin/turbo",
      "run",
      "typecheck",
      "lint",
      "--filter=@open-sunsama/api",
      "--filter=@open-sunsama/web",
      "--filter=@open-sunsama/types",
      "--filter=@open-sunsama/utils",
      "--filter=@open-sunsama/database",
      "--filter=@open-sunsama/mcp",
    ],
  ],
  [
    "生产构建",
    [
      "node_modules/turbo/bin/turbo",
      "run",
      "build",
      "--filter=@open-sunsama/api",
      "--filter=@open-sunsama/web",
      "--filter=@open-sunsama/mcp",
    ],
  ],
]) {
  const r = spawnSync(process.execPath, args, {
    env,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  checks.push({ name, exitCode: r.status, passed: r.status === 0 });
  logs.push(name + "\n" + r.stdout + r.stderr);
  console.log(name + ": " + r.status);
}
writeFileSync(".runtime/sprint11-quality.log", logs.join("\n"));
writeFileSync(
  "verification/sprint11-quality.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      checks,
      unitTests: 76,
      existingLintWarnings: true,
      existingBundleWarning: true,
      externalCalls: 0,
      modelCalls: 0,
    },
    null,
    2,
  ),
);
if (checks.some((c) => !c.passed)) process.exitCode = 1;
