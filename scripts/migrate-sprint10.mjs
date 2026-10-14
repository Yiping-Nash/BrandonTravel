import { readFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
const cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8")),
  root = process.cwd();
mkdirSync(".runtime/backups", { recursive: true });
const env = {
  ...process.env,
  PGPASSWORD: cfg.databasePassword,
  DATABASE_URL: `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
};
const dump = spawnSync(
  path.join(root, ".tools/postgresql/pgsql/bin/pg_dump.exe"),
  [
    "-h",
    "127.0.0.1",
    "-p",
    "54329",
    "-U",
    "brandon",
    "-d",
    "brandontravel",
    "-Fc",
    "-f",
    path.join(root, ".runtime/backups/sprint10-live-before.dump"),
  ],
  { env, windowsHide: true, encoding: "utf8" },
);
assert.equal(dump.status, 0, dump.stderr);
const r = spawnSync(
  path.join(root, ".tools/bun/bun-windows-x64/bun.exe"),
  [
    "-e",
    'import {runMigrations} from "./packages/database/src/migrate.ts";await runMigrations(process.env.DATABASE_URL,"./packages/database/drizzle");',
  ],
  { env, windowsHide: true, encoding: "utf8" },
);
assert.equal(r.status, 0, r.stderr);
console.log("本地库已备份并完成0008迁移");
