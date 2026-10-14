/** Run with node --import ./apps/api/node_modules/tsx/dist/loader.mjs scripts/eval-mvp4.mts */
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
const sprint = process.argv.includes("--sprint-d")
  ? "D"
  : process.argv.includes("--sprint-c")
    ? "C"
    : "B";
const scenarioModule = await import(
  sprint === "D"
    ? "../apps/api/src/travel/eval/reliability-scenarios.ts"
    : sprint === "C"
      ? "../apps/api/src/travel/eval/fact-scenarios.ts"
      : "../apps/api/src/travel/eval/planning-scenarios.ts"
);
const {
  fixture,
  requests,
  referenceOperations,
  scenarioIds,
  grade,
  stateDiff,
  FIXED_NOW,
  fixtureFacts,
} = scenarioModule;
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
assert(cases.length > 0, "仅支持已实现场景");
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
const budgetPath = path.join(root, ".runtime/evals/mvp4-bcd-budget.json");
let consumed = existsSync(budgetPath)
  ? JSON.parse(readFileSync(budgetPath, "utf8")).actualRequests
  : 0;
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
  TRAVEL_EVAL_CLOCK: FIXED_NOW,
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
const budgetLockPath = path.join(root, ".runtime/evals/mvp4-bcd-live.lock");
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
  const r = await (
    current?.armed && url.endsWith("/confirm")
      ? globalThis.fetch
      : originalFetch
  )(base + url, {
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
      Number.isInteger(consumed) && consumed >= 0 && consumed <= 299,
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
        assert(consumed < 299, "B/C/D累计模型预算用尽");
        actualRequests++;
        consumed++;
        writeFileSync(
          budgetPath,
          JSON.stringify({ actualRequests: consumed, limit: 299 }),
        );
        writeFileSync(
          path.join(output, "usage-counter.json"),
          JSON.stringify({ actualRequests }),
        );
        return originalFetch(input, init);
      }
      mockRequests++;
      const toolResults = request.messages
        .filter((m: any) => m.role === "tool")
        .map((m: any) => {
          try {
            return { name: m.tool_call_id, data: JSON.parse(m.content).data };
          } catch {
            return {};
          }
        });
      const hasEval = toolResults.some((r: any) => r.data?.clock),
        hasPreview = toolResults.some((r: any) => r.data?.persisted === false);
      const pending = toolResults.find(
        (r: any) => r.data?.id && r.data.status === "pending",
      );
      let name: string, args: any;
      if (
        current.scenarioId === "S13" &&
        current.humanInjected &&
        !toolResults.some(
          (r: any) => r.data?.view && r.data?.revision > current.revision,
        )
      ) {
        name = "get_trip";
        args = { view: "overview" };
      } else if (!hasEval) {
        name = "evaluate_trip";
        args = {
          date: current.scenarioId === "S04" ? "2026-10-13" : "2026-10-14",
        };
      } else if (
        current.scenarioId === "S12" &&
        !toolResults.some((r: any) => r.data?.permanentMemory === false)
      ) {
        name = "get_trip_context";
        args = {};
      } else if (
        current.scenarioId === "S11" &&
        !toolResults.some((r: any) => r.data?.cooldown !== undefined)
      ) {
        name = "prepare_operational_facts";
        args = { date: "2026-10-13", kinds: ["opening_hours"] };
      } else if (current.scenarioId === "S11") {
        name = "finish_turn";
        args = {
          kind: "answer",
          text: "营业资料已过期且刷新在失败冷却中，无法确认明晚营业，请人工核实。",
          proposalIds: [],
        };
      } else if (
        current.scenarioId === "S15" &&
        !toolResults.some((r: any) => r.data?.changes)
      ) {
        name = "get_recent_changes";
        args = {};
      } else if (
        current.scenarioId === "S15" &&
        !toolResults.some((r: any) => r.data?.eventId && r.data?.operations)
      ) {
        const changes = toolResults.find((r: any) => r.data?.changes).data
          .changes;
        const change = changes.find((c: any) =>
          c.activities.some(
            (a: any) => a.title === "晋祠" && a.kind === "schedule",
          ),
        );
        name = "preview_restore";
        args = {
          eventId: change.eventId,
          activityId: current.operations[0].id,
          expectedRevision: current.revision,
        };
      } else if (current.scenarioId === "S08") {
        name = "finish_turn";
        args = {
          kind: "answer",
          text: "无法在两小时内完成：两个景点各90分钟，路线60分钟，需要240分钟。请扩大时段或改日期。",
          proposalIds: [],
        };
      } else if (current.scenarioId === "S05" && !hasPreview) {
        name = "preview_trip_change";
        args = { reason: "评估候选", operations: current.operations };
      } else if (current.scenarioId === "S05") {
        name = "finish_turn";
        args = {
          kind: "answer",
          text: "可以安排14:00–15:30，路线20分钟且营业覆盖。尚未执行。",
          proposalIds: [],
        };
      } else if (pending) {
        name = "finish_turn";
        args = { kind: "proposal", text: "", proposalIds: [pending.data.id] };
      } else {
        name = "propose_trip_change";
        args = { reason: "合成模型明确操作", operations: current.operations };
      }
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
    if (
      current?.armed &&
      current.scenarioId === "S13" &&
      !current.humanInjected &&
      url.includes(`/travel/trips/${current.tripId}/agent?`)
    ) {
      const response = await originalFetch(input, init);
      current.humanInjected = true;
      const { traced } =
        await import("../apps/api/src/travel/observability.ts");
      await traced("human.concurrent-edit", "CHAIN", {}, () =>
        api(`/travel/trips/${current.tripId}/operations`, "POST", {
          expectedRevision: current.revision,
          requestId: randomUUID(),
          operations: [
            { type: "edit", id: current.otherId, patch: { start: 540 } },
          ],
        }),
      );
      current.faults.push("human-edit-after-agent-read");
      return response;
    }
    if (
      current?.armed &&
      current.scenarioId === "S14" &&
      !current.proposalFault &&
      url.endsWith(`/travel/trips/${current.tripId}/proposals`) &&
      init?.method === "POST"
    ) {
      current.proposalFault = true;
      const after = process.argv.includes("--fault-after");
      if (after) await originalFetch(input, init);
      current.faults.push(
        after
          ? "proposal-committed-response-lost"
          : "proposal-failed-before-commit",
      );
      throw new TypeError("Synthetic transport response loss");
    }
    if (
      current?.armed &&
      current.scenarioId === "S14" &&
      !current.confirmFault &&
      /\/travel\/proposals\/[^/]+\/confirm$/.test(url) &&
      init?.method === "POST"
    ) {
      current.confirmFault = true;
      const after = process.argv.includes("--fault-after");
      if (after) await originalFetch(input, init);
      current.faults.push(
        after
          ? "confirm-committed-response-lost"
          : "confirm-failed-before-commit",
      );
      throw new TypeError("Synthetic confirm response loss");
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
          activity: { ...activity, entityId: undefined },
        })),
      });
      const { persist } =
        await import("../apps/api/src/travel/kernel/repository.ts");
      const loaded = await api(`/travel/trips/${created.id}`);
      // Fixture-only database seed. Never exposed by an HTTP endpoint.
      source.revision = loaded.revision;
      await persist(sql, auth.user.id, source);
      if (sprint === "C") {
        const environments = (scenarioModule as any).fixtureEnvironments(
          scenarioId,
        );
        const rows =
          await sql`SELECT state FROM travel_trips WHERE id=${source.id}`;
        const canonical = rows[0].state;
        for (const a of canonical.activities)
          a.environment = environments[a.id] ?? "unspecified";
        await sql`UPDATE travel_trips SET state=${sql.json(canonical)} WHERE id=${source.id}`;
        for (const message of (scenarioModule as any).priorMessages(
          scenarioId,
        )) {
          const prior = {
            id: randomUUID(),
            tripId: source.id,
            message,
            status: "done",
            outcome: "answered",
            events: [],
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            createdAt: FIXED_NOW,
          };
          await sql`INSERT INTO travel_chat_runs(id,user_id,trip_id,state) VALUES(${prior.id},${auth.user.id},${source.id},${sql.json(prior)})`;
        }
      }
      if (sprint === "D" && ["S14", "S15"].includes(scenarioId)) {
        let state = await api(`/travel/trips/${source.id}`);
        const operations =
          scenarioId === "S15"
            ? [
                {
                  type: "edit",
                  id: state.activities[0].id,
                  patch: { date: "2026-10-14", start: 660 },
                },
              ]
            : [
                {
                  type: "edit",
                  id: state.activities[1].id,
                  patch: { start: 900 },
                },
              ];
        const proposal = await api(
          `/travel/trips/${source.id}/proposals`,
          "POST",
          {
            reason: "参考前一回合已授权操作",
            expectedRevision: state.revision,
            requestId: randomUUID(),
            operations,
          },
          201,
        );
        await api(`/travel/proposals/${proposal.id}/confirm`, "POST", {});
        state = await api(`/travel/trips/${source.id}`);
        if (scenarioId === "S15") {
          const lunch = {
            id: randomUUID(),
            title: "独立新增午餐",
            date: "2026-10-14",
            start: 720,
            duration: 60,
            notes: "必须保留",
            place: "地点待确认",
            locked: false,
            position: 3,
          };
          await api(`/travel/trips/${source.id}/operations`, "POST", {
            requestId: randomUUID(),
            expectedRevision: state.revision,
            operations: [
              { type: "add", activity: lunch },
              {
                type: "edit",
                id: state.activities[0].id,
                patch: { notes: "后来新增备注，也必须保留" },
              },
            ],
          });
          const prior = {
            id: randomUUID(),
            tripId: source.id,
            message: "把晋祠调到周三。",
            status: "done",
            outcome: "proposal_created",
            events: [
              {
                kind: "tool",
                name: "propose_trip_change",
                status: "done",
                proposalId: proposal.id,
                text: "前一回合已确认",
              },
            ],
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            createdAt: FIXED_NOW,
          };
          await sql`INSERT INTO travel_chat_runs(id,user_id,trip_id,state) VALUES(${prior.id},${auth.user.id},${source.id},${sql.json(prior)})`;
        }
      }
      const facts = fixtureFacts(scenarioId, source);
      for (const view of facts) {
        const { freshness: _freshness, unknownReason: _reason, ...fact } = view;
        await sql`INSERT INTO travel_operational_facts(trip_id,user_id,kind,subject_key,fact) VALUES(${source.id},${auth.user.id},${fact.kind},${fact.subjectKey},${sql.json(fact)})`;
      }
      await sql`UPDATE travel_trips SET facts_version=${facts.length} WHERE id=${source.id}`;
      const before = await api(`/travel/trips/${created.id}`);
      if (trial === 1 && scenarioId === "S04") {
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
      current = {
        scenarioId,
        operations: referenceOperations(scenarioId, before),
        tripId: before.id,
        revision: before.revision,
        otherId: before.activities[1]?.id,
        faults: [],
        armed: false,
      };
      const referenceOps = referenceOperations(scenarioId, before);
      const apply = (await import("../apps/api/src/travel/domain.ts"))
        .applyOperations;
      const { candidateFacts } =
        await import("../apps/api/src/travel/kernel/planning.ts");
      const evaluate = (
        await import("../packages/utils/src/travel-intelligence.ts")
      ).evaluate;
      let reference = referenceOps.length
        ? apply(before, referenceOps, "agent")
        : before;
      if (scenarioId === "S13")
        reference = apply(
          reference,
          [
            {
              type: "edit",
              id: before.activities[1].id,
              patch: { start: 540 },
            },
          ],
          "user",
        );
      const referenceEval = evaluate(
        reference,
        candidateFacts(reference, facts),
        facts.length,
        new Date(FIXED_NOW),
        undefined,
        sprint === "C"
          ? (scenarioModule as any).fixtureEnvironments(scenarioId)
          : {},
      );
      assert(
        grade(
          scenarioId,
          before,
          ["S05", "S11"].includes(scenarioId) ? before : reference,
          referenceEval,
          "可以安排；不可能：90分钟+90分钟+60分钟超过两小时；周一闭馆，过期资料不能确认营业，户外返回待安排。",
          [
            "evaluate_trip",
            "get_trip_context",
            "prepare_operational_facts",
            "get_trip",
            "get_trip",
            "find_proposal",
            "get_recent_changes",
            "preview_restore",
          ],
          { activities: reference.activities, evaluation: referenceEval },
        ).passed,
        "参考结果未通过Grader",
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
          graderVersion: sprint+"1",
          agentContractVersion:
            sprint === "D"
              ? "sprint22-v1"
              : sprint === "C"
                ? "sprint21-v1"
                : "sprint20-v1",
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
          current.armed = true;
          await runChat(
            auth.user.id,
            run,
            AbortSignal.timeout(90000),
            "eval",
            6,
            "golden-eval",
          );
          const unchanged = await api(`/travel/trips/${before.id}`);
          const expectedBefore =
            scenarioId === "S13"
              ? apply(
                  before,
                  [
                    {
                      type: "edit",
                      id: before.activities[1].id,
                      patch: { start: 540 },
                    },
                  ],
                  "user",
                )
              : before;
          assert.deepEqual(
            unchanged,
            expectedBefore,
            "确认前CanonicalState被Agent修改",
          );
          const proposals = await api(`/travel/trips/${before.id}/proposals`),
            pending = proposals.filter((p: any) => p.status === "pending");
          record.agentOutcome = run.outcome;
          record.agentStatus = run.status;
          let after = await api(`/travel/trips/${before.id}`);
          if (
            pending.length === 1 &&
            !["S05", "S08", "S11"].includes(scenarioId)
          ) {
            try {
              await traced("human.confirm", "CHAIN", {}, () =>
                api(`/travel/proposals/${pending[0].id}/confirm`, "POST", {}),
              );
            } catch (error) {
              record.confirmError = "Synthetic transport failure";
              const read = await traced(
                "human.confirm.readback",
                "CHAIN",
                {},
                () => api(`/travel/proposals/${pending[0].id}`),
              );
              record.confirmReadback = read.status;
              if (read.status === "pending")
                await traced("human.confirm.retry", "CHAIN", {}, () =>
                  api(`/travel/proposals/${pending[0].id}/confirm`, "POST", {}),
                );
              else assert.equal(read.status, "applied");
            }
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
          const answer = run.events
            .filter((e: any) => e.kind === "answer")
            .map((e: any) => e.text)
            .join("\n");
          const tools = run.events
            .filter((e: any) => e.kind === "tool" && e.status === "done")
            .map((e: any) => e.name);
          const previews = run.events
            .filter(
              (e: any) =>
                e.name === "preview_trip_change" && e.status === "done",
            )
            .map((e: any) => JSON.parse(e.text).data);
          const proposalCandidate = pending[0]
            ? {
                activities: pending[0].after.activities,
                evaluation: pending[0].evaluation,
              }
            : undefined;
          record.grader = await traced(
            "deterministic.grader",
            "CHAIN",
            {},
            async () =>
              grade(
                scenarioId,
                before,
                after,
                evaluation,
                answer,
                tools,
                previews.at(-1) ?? proposalCandidate,
              ),
          );
          if (
            !["S05", "S08", "S09", "S11"].includes(scenarioId) &&
            pending.length !== 1
          )
            record.grader = {
              passed: false,
              failures: ["没有唯一待确认提案", ...record.grader.failures],
              graderVersion: "B1",
            };
          if (scenarioId === "S08" && pending.length)
            record.grader = {
              passed: false,
              failures: [
                "不可行请求不应生成修改提案",
                ...record.grader.failures,
              ],
              graderVersion: "B1",
            };
          record.answer = answer;
          record.faults = current.faults;
          if (sprint === "D" && scenarioId === "S14" && !record.confirmReadback)
            record.grader = {
              passed: false,
              failures: ["确认失败未读回", ...record.grader.failures],
              graderVersion: "D1",
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
                facts,
                proposals,
                faults: current.faults,
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
