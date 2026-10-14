import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8")),
  root = process.cwd(),
  postgres = (await import("../apps/api/node_modules/postgres/src/index.js"))
    .default;
const prefix = `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/`,
  admin = postgres(prefix + "postgres", { max: 1 }),
  name = "bt_verify_" + randomUUID().replaceAll("-", "").slice(0, 12);
let test;
try {
  await admin.unsafe('CREATE DATABASE "' + name + '"');
  const script =
    'import {runMigrations} from "./packages/database/src/migrate.ts";await runMigrations(process.env.DATABASE_URL,"./packages/database/drizzle");';
  const result = spawnSync(
    path.join(root, ".tools/bun/bun-windows-x64/bun.exe"),
    ["-e", script],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: prefix + name },
      windowsHide: true,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  test = postgres(prefix + name, { max: 1 });
  const tables =
    await test`SELECT count(*)::int as count FROM information_schema.tables WHERE table_schema='public'`;
  assert.equal(tables[0].count, 36);
  const index =
    await test`SELECT indexname FROM pg_indexes WHERE indexname='travel_api_usage_session_idx'`;
  assert.equal(index.length, 1);
  const live = postgres(prefix + "brandontravel", { max: 1 });
  const trips = await live`SELECT state FROM travel_trips`;
  assert.ok(trips.some((r) => r.state.activities?.length === 12));
  await live.end();
  writeFileSync(
    "verification/migration-next.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        emptyDatabaseMigration: true,
        tables: 36,
        sessionIndex: true,
        legacyDatongTripReadable: true,
      },
      null,
      2,
    ),
  );
  console.log("空库迁移36表、会话索引、旧大同行程兼容通过");
} finally {
  if (test) await test.end();
  await admin.unsafe('DROP DATABASE IF EXISTS "' + name + '"');
  await admin.end();
}
