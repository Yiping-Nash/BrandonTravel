import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { grade } from "../apps/api/src/travel/eval/scenarios.ts";
const base = path.resolve(".runtime/evals");
Object.assign(process.env, {
  TRAVEL_EVAL_TRACE: "true",
  TRAVEL_EVAL_FIXTURES: "synthetic",
  DATABASE_URL: "postgres://synthetic@localhost/bt_eval_ab12",
  TRAVEL_PHOENIX_ENDPOINT: "http://127.0.0.1:6006/v1/traces",
});
const { annotateGrader } =
  await import("../apps/api/src/travel/observability.ts");
let count = 0;
for (const dir of readdirSync(base).filter((n) => n.endsWith("-live"))) {
  const file = path.join(base, dir, "report.json");
  if (!existsSync(file)) continue;
  const report = JSON.parse(readFileSync(file, "utf8"));
  for (const r of report.results) {
    if (!["S01","S02","S03"].includes(r.scenarioId)) continue;
    const d = JSON.parse(
      readFileSync(path.join(base, dir, r.trialId + "-state.json"), "utf8"),
    );
    const result = grade(
      r.scenarioId,
      d.before,
      d.after,
      d.evaluation,
      d.events.some(
        (e: { kind: string; text: string }) =>
          e.kind === "answer" && /冲突/.test(e.text),
      ),
    );
    if (r.grader.failures.includes("没有唯一待确认提案")) {
      result.passed = false;
      result.failures.unshift("没有唯一待确认提案");
    }
    assert.deepEqual(result, r.grader);
    const spans = readFileSync(
      path.join(base, dir, "traces", r.traceId + ".jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    const llm = spans.filter((s) => s.name === "qwen.chat.completions");
    assert.equal(llm.length, r.modelRequests);
    assert.equal(
      llm.reduce(
        (n, s) => n + (s.attributes["llm.token_count.prompt"] ?? 0),
        0,
      ),
      r.tokens.input,
    );
    assert.equal(
      llm.reduce(
        (n, s) => n + (s.attributes["llm.token_count.completion"] ?? 0),
        0,
      ),
      r.tokens.output,
    );
    const root = spans.find((s) => s.name === "eval." + r.scenarioId);
    assert(root);
    if (r.annotationStatus !== "uploaded") {
      const uploaded = await annotateGrader(
        root.spanId,
        r.grader.passed,
        r.scenarioId,
      );
      r.initialAnnotationStatus = r.annotationStatus;
      r.annotationStatus = uploaded;
      r.annotationRepairAt = new Date().toISOString();
      assert.equal(uploaded, "uploaded");
    }
    count++;
  }
  writeFileSync(file, JSON.stringify(report, null, 2));
}
console.log(
  `PASS: ${count} actual recorded readbacks regraded; trace tokens match; missing annotations repaired without model calls`,
);
