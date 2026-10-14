import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { grade as aGrade } from "../apps/api/src/travel/eval/scenarios.ts";
import { grade as bGrade } from "../apps/api/src/travel/eval/planning-scenarios.ts";
import { grade as cGrade } from "../apps/api/src/travel/eval/fact-scenarios.ts";
import { grade as dGrade } from "../apps/api/src/travel/eval/reliability-scenarios.ts";
const dir = path.resolve(".runtime/evals"),
  results: any[] = [];
for (const folder of readdirSync(dir).filter((f) => f.endsWith("-live"))) {
  const file = path.join(dir, folder, "report.json");
  if (!existsSync(file)) continue;
  const report = JSON.parse(readFileSync(file, "utf8"));
  for (const r of report.results) {
    const state = JSON.parse(
      readFileSync(path.join(dir, folder, r.trialId + "-state.json"), "utf8"),
    );
    const n = Number(r.scenarioId.slice(1));
    const tools = state.events
      .filter((e: any) => e.kind === "tool" && e.status === "done")
      .map((e: any) => e.name);
    const answer = state.events
      .filter((e: any) => e.kind === "answer")
      .map((e: any) => e.text)
      .join("\n");
    const previews = state.events
      .filter(
        (e: any) => e.name === "preview_trip_change" && e.status === "done",
      )
      .map((e: any) => JSON.parse(e.text).data);
    const candidate = state.proposals?.find((p: any) => p.status === "pending");
    let graded: any;
    if (n <= 3)
      graded = aGrade(
        r.scenarioId,
        state.before,
        state.after,
        state.evaluation,
        /冲突/.test(answer),
      );
    else if (n <= 8)
      graded = bGrade(
        r.scenarioId,
        state.before,
        state.after,
        state.evaluation,
        answer,
        tools,
        previews.at(-1) ??
          (candidate
            ? {
                activities: candidate.after.activities,
                evaluation: candidate.evaluation,
              }
            : undefined),
      );
    else if (n <= 12)
      graded = cGrade(
        r.scenarioId,
        state.before,
        state.after,
        state.evaluation,
        answer,
        tools,
      );
    else
      graded = dGrade(
        r.scenarioId,
        state.before,
        state.after,
        state.evaluation,
        answer,
        tools,
      );
    if (r.grader.failures.includes("没有唯一待确认提案")) {
      graded.passed = false;
      graded.failures.unshift("没有唯一待确认提案");
    }
    if (n === 8 && state.proposals?.some((p: any) => p.status === "pending")) {
      graded.passed = false;
      graded.failures.unshift("不可行请求不应生成修改提案");
    }
    if (n === 14 && !r.confirmReadback) {
      graded.passed = false;
      graded.failures.unshift("确认失败未读回");
    }
    assert.equal(
      graded.passed,
      r.grader.passed,
      `${folder}/${r.trialId}: classification changed`,
    );
    const lines = readFileSync(
      path.join(dir, folder, "traces", r.traceId + ".jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const llm = lines.filter((s: any) => s.name === "qwen.chat.completions");
    assert.equal(llm.length, r.modelRequests);
    if (r.tokens.usageAvailable) {
      assert.equal(
        llm.reduce(
          (n: number, s: any) =>
            n + (s.attributes["llm.token_count.prompt"] ?? 0),
          0,
        ),
        r.tokens.input,
      );
      assert.equal(
        llm.reduce(
          (n: number, s: any) =>
            n + (s.attributes["llm.token_count.completion"] ?? 0),
          0,
        ),
        r.tokens.output,
      );
    }
    results.push({
      folder,
      scenarioId: r.scenarioId,
      trialId: r.trialId,
      traceId: r.traceId,
      passed: graded.passed,
      failures: graded.failures,
    });
  }
}
writeFileSync(
  "verification/mvp4-recorded-regrade.json",
  JSON.stringify(
    {
      results,
      classificationStable: true,
      traceTokensMatch: true,
      modelRequests: 0,
    },
    null,
    2,
  ),
);
console.log(
  `PASS: ${results.length} recorded trials regraded with strict code; failures retained; trace tokens match; no model calls`,
);
