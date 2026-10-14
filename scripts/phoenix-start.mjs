import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)),
  python = path.join(root, ".runtime/phoenix-venv/Scripts/python.exe");
if (!existsSync(python))
  throw Error("Phoenix未安装；请按Sprint19观测指南建立独立环境");
const dir = path.join(root, ".runtime/phoenix");
mkdirSync(dir, { recursive: true });
const child = spawn(python, ["-m", "phoenix.server.main", "serve"], {
  cwd: root,
  windowsHide: true,
  stdio: "inherit",
  env: {
    ...process.env,
    PHOENIX_WORKING_DIR: dir,
    PHOENIX_HOST: "127.0.0.1",
    PHOENIX_PORT: "6006",
    PHOENIX_TELEMETRY_ENABLED: "false",
    PHOENIX_ENABLE_MCP_SERVER: "false",
    PHOENIX_FULLSTORY_ORG: "",
    PHOENIX_LOG_MIGRATIONS: "false",
    TEMP: path.join(root, ".tools/downloads"),
    TMP: path.join(root, ".tools/downloads"),
  },
});
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
child.on("exit", (code) => process.exit(code ?? 0));
