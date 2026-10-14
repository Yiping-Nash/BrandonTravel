/** Run with node --import ./apps/api/node_modules/tsx/dist/loader.mjs scripts/eval-sprint19.mts */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import {
  fixture,
  requests,
  referenceOperations,
  scenarioIds,
  grade,
  stateDiff,
  FIXED_NOW,
} from "../apps/api/src/travel/eval/scenarios.ts";
const root = process.cwd(),
  live = process.argv.includes("--live"),
  repeat = Number(process.env.TRAVEL_EVAL_REPEATS ?? 3),
  thinking = process.argv.includes("--thinking"),
  off = process.argv.includes("--trace-off"),
  down = process.argv.includes("--phoenix-down");
assert(Number.isInteger(repeat) && repeat >= 1 && repeat <= 3, "每次运行1–3轮");
const cases = process.env.TRAVEL_EVAL_SCENARIOS
  ? scenarioIds.filter((id) =>
      process.env.TRAVEL_EVAL_SCENARIOS!.split(",").includes(id),
    )
  : scenarioIds;
assert(cases.length > 0, "仅支持S01–S03场景");
const cfg = JSON.parse(
  readFileSync(".runtime/config.json", "utf8").replace(/^\uFEFF/, ""),
);
const output = path.join(
  root,
  ".runtime/evals",
  `${Date.now()}-${live ? "live" : "mock"}${off ? "-off" : ""}${down ? "-down" : ""}${thinking ? "-thinking" : ""}`,
);
mkdirSync(output, { recursive: true });
const { createServer } = await import("node:net");
const portServer = createServer();
await new Promise<void>((resolve) =>
  portServer.listen(0, "127.0.0.1", resolve),
);
const port = (portServer.address() as { port: number }).port;
await new Promise<void>((resolve) => portServer.close(() => resolve()));
const name = "bt_eval_" + randomUUID().replaceAll("-", "").slice(0, 12),
  base = "http://127.0.0.1:" + port,
  database = `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/${name}`;
const postgres = (
    await import("../apps/api/node_modules/postgres/src/index.js")
  ).default,
  admin = postgres(
    `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/postgres`,
    { max: 1 },
  );
const budgetPath = path.join(root, ".runtime/evals/sprint19-budget.json");
let consumed = existsSync(budgetPath)
  ? JSON.parse(readFileSync(budgetPath, "utf8")).actualRequests
  : 0;
if (live && !existsSync(budgetPath)) {
  const { readdirSync } = await import("node:fs");
  for (const dir of readdirSync(path.join(root, ".runtime/evals"))) {
    const f = path.join(root, ".runtime/evals", dir, "usage-counter.json");
    if (existsSync(f))
      consumed += JSON.parse(readFileSync(f, "utf8")).actualRequests;
  }
}
const model = live
  ? JSON.parse(readFileSync(".runtime/model-api.json", "utf8"))
  : {
      apiKey: "fixture-key",
      baseUrl: "https://fixture.invalid/v1",
      model: "fixture-qwen",
    };
const fixtureModel = path.join(output, "model.json");
if (!live) writeFileSync(fixtureModel, JSON.stringify(model));
const env = {
  ...process.env,
  BRANDON_LOCAL: "true",
  DATABASE_URL: database,
  JWT_SECRET: randomBytes(32).toString("hex"),
  PORT: String(port),
  HOST: "127.0.0.1",
  API_URL: base,
  MIGRATE_ON_START: "true",
  MIGRATIONS_DIR: path.join(root, "packages/database/drizzle"),
  TRAVEL_MODEL_CONFIG: live
    ? path.join(root, ".runtime/model-api.json")
    : fixtureModel,
  TRAVEL_EVAL_FIXTURES: "synthetic",
  TRAVEL_EVAL_TRACE: off ? "false" : "true",
  TRAVEL_TRACE_DIR: path.join(output, "traces"),
  TRAVEL_PHOENIX_ENDPOINT: down
    ? "http://127.0.0.1:6099/v1/traces"
    : "http://127.0.0.1:6006/v1/traces",
  TRAVEL_EVAL_THINKING: thinking ? "true" : "false",
  TRAVEL_FACTS_ALLOW_NETWORK: "false",
  TRAVEL_MOCK_PROVIDERS: live ? "false" : "true",
  ROLLOVER_ENABLED: "false",
  EMAIL_WORKERS_ENABLED: "false",
  CALENDAR_SYNC_ENABLED: "false",
  RECURRING_ENABLED: "false",
  REDIS_URL: "",
  RESEND_API_KEY: "",
};
let child: any;
let sql: any;
let headers: Record<string, string> = { "Content-Type": "application/json" };
let budgetLock: number | undefined;
const budgetLockPath = path.join(root, ".runtime/evals/sprint19-live.lock");
let actualRequests = 0;
let mockRequests = 0;
let current: any;
const originalFetch = globalThis.fetch,
  results: any[] = [];
async function api(
  url: string,
  method = "GET",
  body?: unknown,
  expected = 200,
) {
  const r = await originalFetch(base + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return data.data;
}
try {
  if (live) {
    budgetLock = openSync(budgetLockPath, "wx");
    if (existsSync(budgetPath))
      consumed = JSON.parse(readFileSync(budgetPath, "utf8")).actualRequests;
    assert(
      Number.isInteger(consumed) && consumed >= 0 && consumed <= 360,
      "预算记录无效",
    );
  }
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(root, "apps/api"),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, TRAVEL_EVAL_TRACE: "false" },
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (d: Buffer) =>
      appendFileSync(path.join(output, "api.log"), d),
    );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await originalFetch(base + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  assert(ready, "隔离API未启动，详见.runtime日志");
  Object.assign(process.env, env);
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(model.baseUrl + "/chat/completions")) {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.enable_search, false, "MVP4禁止联网");
      assert(
        !request.tools.some(
          (t: any) =>
            t.type !== "function" ||
            /web_search|web_extractor/.test(t.function?.name),
        ),
        "不得挂载联网工具",
      );
      if (live) {
        assert(consumed < 360, "Sprint19累计模型预算用尽");
        actualRequests++;
        consumed++;
        writeFileSync(
          budgetPath,
          JSON.stringify({ actualRequests: consumed, limit: 360 }),
        );
        writeFileSync(
          path.join(output, "usage-counter.json"),
          JSON.stringify({ actualRequests }),
        );
        return originalFetch(input, init);
      }
      mockRequests++;
      const evidence = request.messages
        .filter((m: any) => m.role === "tool")
        .map((m: any) => {
          try {
            return JSON.parse(m.content).data;
          } catch {
            return undefined;
          }
        })
        .find((d: any) => d?.id && d.status === "pending");
      const name = evidence ? "finish_turn" : "propose_trip_change",
        args = evidence
          ? { kind: "proposal", text: "", proposalIds: [evidence.id] }
          : { reason: "合成模型明确操作", operations: current.operations };
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: randomUUID(),
                    type: "function",
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 30 },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    const u = new URL(url);
    if (["127.0.0.1", "localhost"].includes(u.hostname))
      return originalFetch(input, init);
    throw Error("隔离Eval禁止未授权外部请求");
  };
  sql = postgres(database, { max: 2 });
  const email = `fixture-${randomUUID()}@example.invalid`,
    password = "Fixture9!" + randomBytes(24).toString("hex");
  const auth = await api(
    "/auth/register",
    "POST",
    { email, password, name: "虚构Eval用户" },
    201,
  );
  const login = await api("/auth/login", "POST", { email, password });
  headers = {
    Authorization: "Bearer " + login.token,
    "Content-Type": "application/json",
    "X-Travel-Test": "true",
  };
  const { db } = await import("../apps/api/src/travel/store.ts"),
    { runChat } = await import("../apps/api/src/travel/chat-routes.ts"),
    { traced, flushTracing, annotateGrader } =
      await import("../apps/api/src/travel/observability.ts");
  for (let trial = 1; trial <= repeat; trial++)
    for (const scenarioId of cases) {
      const created = await api(
          "/travel/trips",
          "POST",
          {
            title: `${scenarioId}虚构评测${trial}`,
            startDate: "2026-10-13",
            endDate: "2026-10-17",
          },
          201,
        ),
        source = fixture(scenarioId, created.id);
      await api(`/travel/trips/${created.id}/operations`, "POST", {
        expectedRevision: created.revision,
        requestId: randomUUID(),
        operations: source.activities.map((activity) => ({
          type: "add",
          activity,
        })),
      });
      const before = await api(`/travel/trips/${created.id}`);
      if (trial === 1 && scenarioId === "S01") {
        const other = await api(
          "/auth/register",
          "POST",
          {
            email: `other-${randomUUID()}@example.invalid`,
            password: "Fixture9!" + randomBytes(24).toString("hex"),
            name: "虚构跨用户",
          },
          201,
        );
        const denied = await originalFetch(
          base + `/travel/trips/${before.id}`,
          { headers: { Authorization: "Bearer " + other.token } },
        );
        assert.equal(denied.status, 404, "跨用户读取必须拒绝");
        const key = await api("/travel/keys", "POST", {}, 201);
        const blocked = await originalFetch(
          base + `/travel/trips/${before.id}/operations`,
          {
            method: "POST",
            headers: {
              "X-Travel-Key": key.key,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              expectedRevision: before.revision,
              requestId: randomUUID(),
              operations: referenceOperations(scenarioId, before),
            }),
          },
        );
        assert.equal(blocked.status, 403, "Agent不能直接执行");
      }
      current = { operations: referenceOperations(scenarioId, before) };
      const reference = (
        await import("../apps/api/src/travel/domain.ts")
      ).applyOperations(before, current.operations, "agent");
      const evaluate = (
        await import("../packages/utils/src/travel-intelligence.ts")
      ).evaluate;
      assert(
        grade(
          scenarioId,
          before,
          reference,
          evaluate(reference, [], 0, new Date(FIXED_NOW)),
          true,
        ).passed,
        "参考结果未通过grader，停止模型试验",
      );
      const run: any = {
        id: randomUUID(),
        tripId: before.id,
        message: requests[scenarioId],
        status: "running",
        events: [],
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        createdAt: new Date().toISOString(),
      };
      await db()`INSERT INTO travel_chat_runs(id,user_id,trip_id,state) VALUES(${run.id},${auth.user.id},${before.id},${db().json(run)})`;
      let rootSpanId: string | undefined;
      const start = Date.now(),
        record: any = {
          scenarioId,
          trialId: `${scenarioId}-${trial}`,
          agentRunId: run.id,
          provider: live ? "qwen-live" : "fixture",
          thinking,
          graderVersion: "1",
          agentContractVersion: "sprint19-v2",
          fixtureClock: FIXED_NOW,
        };
      await traced(
        "eval." + scenarioId,
        "CHAIN",
        {
          "eval.scenarioId": scenarioId,
          "eval.trialId": record.trialId,
          "eval.agentContractVersion": record.agentContractVersion,
        },
        async (span) => {
          record.traceId = span?.spanContext().traceId ?? null;
          rootSpanId = span?.spanContext().spanId;
          await runChat(
            auth.user.id,
            run,
            AbortSignal.timeout(90000),
            "eval",
            6,
            "golden-eval",
          );
          const unchanged = await api(`/travel/trips/${before.id}`);
          assert.deepEqual(unchanged, before, "确认前CanonicalState变化");
          const proposals = await api(`/travel/trips/${before.id}/proposals`),
            pending = proposals.filter((p: any) => p.status === "pending");
          record.agentOutcome = run.outcome;
          record.agentStatus = run.status;
          let after = before;
          if (pending.length === 1) {
            await traced("human.confirm", "CHAIN", {}, () =>
              api(`/travel/proposals/${pending[0].id}/confirm`, "POST", {}),
            );
            after = await traced("state.readback", "CHAIN", {}, () =>
              api(`/travel/trips/${before.id}`),
            );
            // Exact replay after confirmation remains idempotent.
            await api(
              `/travel/trips/${before.id}/proposals`,
              "POST",
              pending[0].input,
              201,
            );
            assert.deepEqual(await api(`/travel/trips/${before.id}`), after);
          }
          const evaluation = await api(
            `/travel/trips/${before.id}/intelligence`,
          );
          const disclosed = run.events.some(
            (e: any) => e.kind === "answer" && /冲突/.test(e.text),
          );
          record.grader = await traced(
            "deterministic.grader",
            "CHAIN",
            {},
            async () => grade(scenarioId, before, after, evaluation, disclosed),
          );
          if (pending.length !== 1)
            record.grader = {
              passed: false,
              failures: ["没有唯一待确认提案", ...record.grader.failures],
              graderVersion: "1",
            };
          record.diff = stateDiff(before, after);
          record.versions = {
            before: before.revision,
            after: after.revision,
            facts: evaluation.factsVersion,
            engine: evaluation.engineVersion,
            policy: evaluation.policyVersion,
          };
          const usageKnown =
            run.diagnostics?.every(
              (d: { usageAvailable?: boolean }) => d.usageAvailable === true,
            ) ?? false;
          record.tokens = {
            input: usageKnown ? run.inputTokens : null,
            output: usageKnown ? run.outputTokens : null,
            usageAvailable: usageKnown,
          };
          record.modelRequests = run.requests;
          record.elapsedMs = Date.now() - start;
          writeFileSync(
            path.join(output, record.trialId + "-state.json"),
            JSON.stringify(
              {
                before,
                after,
                evaluation,
                events: run.events,
                diagnostics: run.diagnostics,
              },
              null,
              2,
            ),
          );
          span?.setAttribute("eval.passed", record.grader.passed);
          span?.setStatus({
            code: record.grader.passed ? 1 : 2,
            message: record.grader.passed ? undefined : "grader_failed",
          });
        },
      );
      record.exportStatus = await flushTracing();
      record.annotationStatus = rootSpanId
        ? await annotateGrader(rootSpanId, record.grader.passed, scenarioId)
        : "disabled";
      results.push(record);
      writeFileSync(
        path.join(output, "report.json"),
        JSON.stringify(
          {
            results,
            actualRequests,
            mockRequests,
            amapRequests: 0,
            searchRequests: 0,
          },
          null,
          2,
        ),
      );
      console.log(
        `${record.trialId}: ${record.grader.passed ? "PASS" : "FAIL"} ${run.requests} requests ${record.exportStatus} ${record.annotationStatus}`,
      );
    }
  // Every actual request must correspond to a per-login usage row.
  const usage =
    await sql`SELECT provider,status,input_tokens,output_tokens,elapsed_ms FROM travel_api_usage WHERE provider IN ('model','model-mock') ORDER BY created_at`;
  assert.equal(usage.length, actualRequests + mockRequests);
  writeFileSync(
    path.join(output, "usage.json"),
    JSON.stringify(usage, null, 2),
  );
  await db().end();
  console.log(
    "Report: " + path.relative(root, path.join(output, "report.json")),
  );
  if (results.some((r) => !r.grader.passed)) process.exitCode = 1;
} catch (e) {
  writeFileSync(
    path.join(output, "fatal.txt"),
    e instanceof Error ? (e.stack ?? e.message) : String(e),
  );
  console.error(e instanceof Error ? e.message : "Eval failed");
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  if (budgetLock !== undefined) {
    closeSync(budgetLock);
    unlinkSync(budgetLockPath);
  }
  if (child) {
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
  await sql?.end();
  assert(/^bt_eval_[a-f0-9]+$/.test(name));
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
