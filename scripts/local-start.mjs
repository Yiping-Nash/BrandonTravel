import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(
  readFileSync(path.join(root, ".runtime/config.json"), "utf8").replace(
    /^\uFEFF/,
    "",
  ),
);
const bun = path.join(root, ".tools/bun/bun-windows-x64/bun.exe");
const common = {
  ...process.env,
  BRANDON_LOCAL: "true",
  TRAVEL_PROJECT_ROOT: root,
  TRAVEL_FACTS_ALLOW_NETWORK: process.env.TRAVEL_FACTS_ALLOW_NETWORK ?? "true",
  TRAVEL_AMAP_CONFIG: path.join(root, ".runtime/amap.json"),
  TRAVEL_MODEL_CONFIG: path.join(root, ".runtime/model-api.json"),
  DATABASE_URL: `postgresql://brandon:${config.databasePassword}@127.0.0.1:54329/brandontravel`,
  JWT_SECRET: config.jwtSecret,
  REDIS_URL: "",
  RESEND_API_KEY: "",
  ROLLOVER_ENABLED: "false",
  EMAIL_WORKERS_ENABLED: "false",
  CALENDAR_SYNC_ENABLED: "false",
  RECURRING_ENABLED: "false",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_ENDPOINT_URL: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  MICROSOFT_CLIENT_ID: "",
  MICROSOFT_CLIENT_SECRET: "",
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  TEMP: path.join(root, ".tools/downloads"),
  TMP: path.join(root, ".tools/downloads"),
};
execFileSync(bun, ["run", "--cwd", "mcp", "build"], {
  cwd: root,
  env: common,
  stdio: "inherit",
  windowsHide: true,
});
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  process.exit(code);
}
function run(dir, args, env, exe = bun) {
  const child = spawn(exe, args, {
    cwd: path.join(root, dir),
    env: { ...common, ...env },
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (err) => {
    console.error(err.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 1));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
run(
  "apps/api",
  ["--import", "tsx", "src/index.ts"],
  {
    PORT: "4332",
    HOST: "127.0.0.1",
    API_URL: "http://127.0.0.1:4332",
    WEB_APP_URL: "http://localhost:4331",
    CORS_ORIGIN: "http://localhost:4331,http://127.0.0.1:4331",
    MIGRATE_ON_START: "true",
    MIGRATIONS_DIR: path.join(root, "packages/database/drizzle"),
  },
  process.execPath,
);
run(
  "apps/web",
  [
    path.join(root, "apps/web/node_modules/vite/bin/vite.js"),
    "--host",
    "0.0.0.0",
    "--port",
    "4331",
    "--strictPort",
  ],
  { VITE_API_URL: "", VITE_WS_URL: "" },
  process.execPath,
);
