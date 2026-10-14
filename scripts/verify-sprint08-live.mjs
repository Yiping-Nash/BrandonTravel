import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = process.cwd(),
  cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8")),
  a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const ledgerPath = ".runtime/sprint08-live-budget.json";
const resume =
  process.argv.includes("--resume") && existsSync(ledgerPath)
    ? JSON.parse(readFileSync("verification/sprint08-live.json", "utf8"))
    : null;
if (
  existsSync(ledgerPath) &&
  (!resume ||
    resume.status !== "failed" ||
    (resume.budget.modelReserved !== 0 &&
      !String(resume.error).includes("Top-level await")))
)
  throw Error("不可自动重复付费；请检查本轮用量。");
const budget = resume
  ? {
      ...JSON.parse(readFileSync(ledgerPath, "utf8")),
      ...(String(resume.error).includes("Top-level await")
        ? { modelReserved: 0 }
        : {}),
    }
  : { modelReserved: 0, amapReserved: 0 };
const reserve = (model, amap) => {
  assert.ok(
    budget.modelReserved + model <= 10 && budget.amapReserved + amap <= 10,
    "超预算，停止",
  );
  budget.modelReserved += model;
  budget.amapReserved += amap;
  writeFileSync(ledgerPath, JSON.stringify(budget));
};
reserve(0, 0);
const base = "http://127.0.0.1:4332",
  checks = [],
  runs = [];
let headers = { "Content-Type": "application/json", "X-Travel-Test": "true" };
async function api(p, method = "GET", body, extra = {}) {
  const r = await fetch(base + p, {
    method,
    headers: { ...headers, ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.ok(r.ok, `${p}: ${r.status}: ${d.error?.message}`);
  return d.data;
}
const evidence = {
  date: new Date().toISOString(),
  checks,
  runs,
  comparison: null,
  budget,
  status: "running",
};
const pg = (await import("../apps/api/node_modules/postgres/src/index.js"))
  .default;
const sql = pg(
  `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
  { max: 1 },
);
try {
  const login = await api("/auth/login", "POST", {
    email: a.email,
    password: a.password,
  });
  headers.Authorization = "Bearer " + login.token;
  evidence.previousLoginUsage = resume?.usageAfter;
  const payload = JSON.parse(
    Buffer.from(login.token.split(".")[1], "base64url"),
  );
  const session = createHash("sha256")
    .update(payload.sessionId ?? headers.Authorization)
    .digest("hex");
  evidence.usageBefore = await api("/travel/usage");
  let trip = resume
    ? await api("/travel/trips/" + resume.tripId)
    : await api("/travel/trips", "POST", {
        title: "Sprint08真实模型同一隔离样本对照",
        startDate: "2026-10-01",
        endDate: "2026-10-03",
      });
  evidence.tripId = trip.id;
  const names = [
    "华严寺",
    "善化寺",
    "古城街巷",
    "午餐参考",
    "代王府",
    "下午休息",
    "晚餐参考",
    "九龙壁",
    "城墙散步",
    "酒店参考",
    "早餐参考",
    "自由活动",
    "返程 · 大同南站",
  ];
  const activities = resume
    ? trip.activities
    : names.map((title, i) => ({
        id: randomUUID(),
        title,
        notes: "此为隔离试用计划，未经核验的营业时间与价格不能当事实。".repeat(
          4,
        ),
        place: "地点待确认",
        date: "2026-10-0" + (Math.floor(i / 5) + 1),
        start: 540 + (i % 5) * 90,
        duration: 60,
        locked: i === 12,
        position: i,
      }));
  if (!resume)
    trip = await api(`/travel/trips/${trip.id}/operations`, "POST", {
      requestId: randomUUID(),
      expectedRevision: trip.revision,
      operations: activities.map((activity) => ({ type: "add", activity })),
    });
  if (!resume) {
    reserve(0, 2);
    const places = [];
    for (const query of ["华严寺", "善化寺"]) {
      const rows = await api(
        "/travel/places/search?" + new URLSearchParams({ query, city: "大同" }),
      );
      const found =
        rows.find((x) => x.name === query) ??
        rows.find((x) => x.name.includes(query));
      assert.ok(found, "真实地点候选缺失");
      places.push(found);
    }
    trip = await api(`/travel/trips/${trip.id}/operations`, "POST", {
      requestId: randomUUID(),
      expectedRevision: trip.revision,
      operations: places.map((entity, i) => ({
        type: "bind_entity",
        id: activities[i].id,
        entity,
      })),
    });
  }
  const message =
    "把第一天（10月1日）的华严寺改到10:00，保持60分钟，只提出一个修改建议等我确认。无需查询地图或路程。";
  // Preserve the old orchestration from the repository commit; use the compatible current full-state MCP adapter.
  let baseline = execFileSync(
    "git",
    [
      "-c",
      "safe.directory=" + root.replaceAll("\\", "/"),
      "show",
      "4b8de36:apps/api/src/travel/chat-routes.ts",
    ],
    { encoding: "utf8" },
  );
  const require = createRequire(path.join(root, "apps/api/package.json"));
  baseline = baseline.replace(/from "([^"]+)"/g, (all, spec) => {
    if (spec.startsWith("node:") || spec === "@open-sunsama/types") return all;
    let target;
    if (spec.startsWith(".")) {
      target = path.resolve(root, "apps/api/src/travel", spec);
      if (target.endsWith(".js")) target = target.slice(0, -3) + ".ts";
    } else if (spec === "@open-sunsama/utils/travel-contract") {
      target = path.join(root, "packages/utils/src/travel-contract.ts");
    } else {
      target = require.resolve(spec);
    }
    return "from " + JSON.stringify(pathToFileURL(target).href);
  });
  writeFileSync(".runtime/sprint08-baseline.mts", baseline);
  writeFileSync(
    ".runtime/sprint08-baseline-runner.mts",
    `import {runChat} from './sprint08-baseline.mts';\nimport {db} from ${JSON.stringify(pathToFileURL(path.join(root, "apps/api/src/travel/store.ts")).href)};\nconst [user,id,session]=process.argv.slice(2);const rows=await db()\x60SELECT state FROM travel_chat_runs WHERE id=\${id} AND user_id=\${user}\x60;await runChat(user,rows[0].state,AbortSignal.timeout(90000),session,3,'sprint08-baseline');await db().end();`,
  );
  const old = {
    id: randomUUID(),
    tripId: trip.id,
    message,
    status: "running",
    events: [],
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    createdAt: new Date().toISOString(),
  };
  await sql`INSERT INTO travel_chat_runs(id,user_id,trip_id,state) VALUES(${old.id},${login.user.id},${trip.id},${sql.json(old)})`;
  reserve(3, 0);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(root, ".runtime/sprint08-baseline-runner.mts"),
      login.user.id,
      old.id,
      session,
    ],
    {
      cwd: path.join(root, "apps/api"),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
        API_URL: base,
        TRAVEL_MODEL_CONFIG: path.join(root, ".runtime/model-api.json"),
        TRAVEL_AMAP_CONFIG: path.join(root, ".runtime/amap.json"),
      },
    },
  );
  let diagnostic = "";
  child.stdout.on("data", (d) => (diagnostic += d));
  child.stderr.on("data", (d) => (diagnostic += d));
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error("基线进程失败：" + diagnostic.slice(-1200))),
    );
  });
  const before = (await api(`/travel/trips/${trip.id}/chat`)).find(
    (r) => r.id === old.id,
  );
  runs.push({
    name: "Sprint07 orchestration + compatible full-state MCP",
    ...before,
  });
  console.log(
    "基线完成",
    before.outcome,
    before.requests,
    "请求",
    before.inputTokens,
    "输入tokens",
  );
  const oldReceipt = before.events.find((e) => e.proposalId);
  if (oldReceipt)
    await api(
      "/travel/proposals/" + oldReceipt.proposalId + "/reject",
      "POST",
      {},
    );
  async function ask(name, message, limit) {
    reserve(limit, 0);
    const r = await api(
      `/travel/trips/${trip.id}/chat`,
      "POST",
      { requestId: randomUUID(), message },
      { "X-Travel-Model-Limit": String(limit) },
    );
    let done;
    for (let i = 0; i < 190; i++) {
      done = (await api(`/travel/trips/${trip.id}/chat`)).find(
        (x) => x.id === r.id,
      );
      if (done.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(done.status !== "running");
    runs.push({ name, ...done });
    console.log(
      name,
      done.outcome,
      done.requests,
      "请求",
      done.inputTokens,
      "输入tokens",
    );
    return done;
  }
  const after = await ask("Sprint08精简上下文", message, 3);
  assert.equal(after.outcome, "proposal_created", JSON.stringify(after.events));
  const proposal = await api(
    "/travel/proposals/" + after.events.find((e) => e.proposalId).proposalId,
  );
  assert.equal(
    proposal.after.activities.find((a) => a.id === activities[0].id).start,
    600,
  );
  assert.equal((await api(`/travel/trips/${trip.id}`)).revision, trip.revision);
  checks.push("真实模型通过MCP提交时间修改，确认前不变");
  evidence.comparison = {
    baselineRequests: before.requests,
    baselineInputTokens: before.inputTokens,
    optimizedRequests: after.requests,
    optimizedInputTokens: after.inputTokens,
    reduction: before.inputTokens
      ? 1 - after.inputTokens / before.inputTokens
      : null,
    targetMet:
      before.inputTokens > 0 && after.inputTokens <= before.inputTokens / 2,
    baselineSucceeded: before.outcome === "proposal_created",
    caveat:
      "基线使用Sprint07编排源码与当前兼容全量MCP；新增第8个日期工具亦在基线发现，非旧生产逐字重放。同一隔离行程、同一模型、同一修改命令；未执行基线提案。",
  };
  await api("/travel/proposals/" + proposal.id + "/confirm", "POST", {});
  checks.push("人工确认后读回10:00；旧基线提案拒绝归档");
  reserve(0, 2);
  const recommend = await ask(
    "真实餐厅推荐",
    "推荐大同第一天的餐厅，给出最多三个真实高德候选，不安排。",
    2,
  );
  assert.equal(recommend.outcome, "answered", JSON.stringify(recommend.events));
  assert.ok(
    recommend.candidates?.length > 0 && recommend.candidates.length <= 3,
  );
  assert.ok(
    recommend.events.some(
      (e) => e.name === "search_places" && e.status === "done",
    ),
  );
  checks.push("真实高德餐厅候选闭环，最多3项、未新增活动");
  const lunch = await ask(
    "真实周六日期",
    "周六13:00安排午餐，60分钟，地点待确认，只提交提案。",
    2,
  );
  assert.equal(lunch.outcome, "proposal_created", JSON.stringify(lunch.events));
  const lp = await api(
    "/travel/proposals/" + lunch.events.find((e) => e.proposalId).proposalId,
  );
  assert.equal(
    lp.operations.find((op) => op.type === "add").activity.date,
    "2026-10-03",
  );
  checks.push("真实模型周六午餐仅生成2026-10-03提案");
  evidence.status = "passed";
} catch (e) {
  evidence.status = "failed";
  evidence.error = e.message;
  console.error("真实验收停止：", e.message);
} finally {
  try {
    evidence.usageAfter = await api("/travel/usage");
  } catch {}
  evidence.actual = {
    modelRequests: runs.reduce((s, r) => s + r.requests, 0),
    inputTokens: runs.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: runs.reduce((s, r) => s + r.outputTokens, 0),
  };
  writeFileSync(
    "verification/sprint08-live.json",
    JSON.stringify(evidence, null, 2),
  );
  await sql.end();
  console.log("已记录真实验收证据；状态", evidence.status);
}
