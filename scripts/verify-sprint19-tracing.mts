import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const invalid = process.argv.includes("--invalid-endpoint");
const dir = path.resolve(".runtime/evals", Date.now() + "-trace-faults");
mkdirSync(dir, { recursive: true });
Object.assign(process.env, {
  TRAVEL_EVAL_TRACE: "true",
  TRAVEL_EVAL_FIXTURES: "synthetic",
  DATABASE_URL: "postgres://synthetic@localhost/bt_eval_ab12",
  TRAVEL_TRACE_DIR: dir,
  TRAVEL_PHOENIX_ENDPOINT: invalid
    ? "https://fixture.invalid/v1/traces"
    : "http://127.0.0.1:6099/v1/traces",
});
const { traced, tracedTool, tracedModel, flushTracing } =
  await import("../apps/api/src/travel/observability.ts");
await traced("eval.faults", "CHAIN", {}, async () => {
  await tracedModel(
    "fixture",
    1,
    async () =>
      new Response(
        JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 2 } }),
      ),
  );
  await tracedModel(
    "fixture",
    2,
    async () => new Response(JSON.stringify({ choices: [] })),
  );
  await tracedModel(
    "fixture",
    3,
    async () => new Response("{}", { status: 429 }),
  );
  await assert.rejects(
    tracedModel("fixture", 4, async () => {
      throw new TypeError("sk-secret Bearer ABC someone@example.com");
    }),
  );
  const bad = {
    isError: true,
    structuredContent: { error: { code: "FIXED", retryable: false } },
  };
  assert.equal(
    await tracedTool(
      "failed-tool",
      {
        id: "fixture",
        apiKey: "SECRET",
        notes: "PRIVATE",
        reasoning_content: "THINK",
      },
      async () => bad,
    ),
    bad,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    traced("cancelled", "CHAIN", {}, async () => {
      controller.signal.throwIfAborted();
    }),
  );
});
const state = await flushTracing();
assert.equal(state, invalid ? "endpoint-rejected" : "upload-failed");
const spans = readdirSync(dir).flatMap((f) =>
  readFileSync(path.join(dir, f), "utf8")
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x)),
);
assert(spans.every((s) => s.traceId === spans[0].traceId));
assert(spans.filter((s) => s.name === "qwen.chat.completions").length === 4);
assert(
  spans.some(
    (s) =>
      s.attributes["llm.token_count.prompt"] === 10 &&
      s.attributes["llm.token_count.completion"] === 2,
  ),
);
assert(
  spans.some(
    (s) =>
      s.attributes["usage.available"] === false &&
      s.attributes["llm.token_count.prompt"] === undefined,
  ),
);
assert.equal(spans.find((s) => s.name === "failed-tool").status.code, 2);
assert.equal(spans.find((s) => s.name === "cancelled").status.code, 2);
for (const key of ["sk-secret", "ABC", "someone", "SECRET", "PRIVATE", "THINK"])
  assert(!JSON.stringify(spans).includes(key));
console.log(
  "PASS: offline export, parent links, LLM tokens/unknown/HTTP/network error, tool failure, cancellation, privacy",
);
