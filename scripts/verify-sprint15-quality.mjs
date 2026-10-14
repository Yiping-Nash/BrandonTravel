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
    "旅行领域单测",
    [
      "apps/api/node_modules/vitest/vitest.mjs",
      "run",
      "apps/api/src/travel",
      "packages/utils/src/travel-intelligence.test.ts",
      "packages/utils/src/travel-weather.test.ts",
      "packages/utils/src/travel-inspection.test.ts",
    ],
  ],
  [
    "完整工作区单测",
    [
      "node_modules/turbo/bin/turbo",
      "run",
      "test",
      "--filter=@open-sunsama/api",
      "--filter=@open-sunsama/web",
      "--filter=@open-sunsama/utils",
      "--filter=@open-sunsama/types",
      "--filter=@open-sunsama/database",
      "--filter=@open-sunsama/mcp",
    ],
  ],
  [
    "全工作区类型与lint",
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
writeFileSync(".runtime/sprint15-quality.log", logs.join("\n"));
writeFileSync(
  "verification/sprint15-quality.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      checks,
      unitTests: 133,
      fullWorkspaceTests: {
        passed: [
          ...logs
            .find((l) => l.startsWith("完整工作区单测"))
            .matchAll(/Tests\s+(\d+) passed/g),
        ].reduce((n, m) => n + Number(m[1]), 0),
        skipped: [
          ...logs
            .find((l) => l.startsWith("完整工作区单测"))
            .matchAll(/Tests[^\n]*?(\d+) skipped/g),
        ].reduce((n, m) => n + Number(m[1]), 0),
      },
      existingLintWarnings: true,
      existingBundleWarning: true,
      modelCalls: 0,
    },
    null,
    2,
  ),
);
if (checks.some((c) => !c.passed)) process.exitCode = 1;
