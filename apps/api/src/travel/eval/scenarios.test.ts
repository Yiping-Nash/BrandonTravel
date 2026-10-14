import { describe, it, expect } from "vitest";
import {
  fixture,
  referenceOperations,
  scenarioIds,
  grade,
  FIXED_NOW,
} from "./scenarios";
import { applyOperations } from "../domain";
import { evaluate } from "@open-sunsama/utils/travel-intelligence";
import { agentProposalSchema } from "@open-sunsama/utils/travel-contract";
import { modelProposalSchema } from "../agent-tools";
import {
  evalTracingAllowed,
  sanitize,
  traced,
  tracedModel,
  tracedTool,
  flushTracing,
} from "../observability";
import { randomUUID } from "node:crypto";
describe("Sprint19 references and negative graders", () => {
  for (const id of scenarioIds)
    it(id + "正确参考、no-op/数据损失/未披露冲突反例", () => {
      const before = fixture(id),
        operations = referenceOperations(id, before),
        after = applyOperations(before, operations, "agent"),
        evaluation = evaluate(after, [], 0, new Date(FIXED_NOW));
      expect(grade(id, before, after, evaluation, true).passed).toBe(true);
      expect(
        grade(
          id,
          before,
          before,
          evaluate(before, [], 0, new Date(FIXED_NOW)),
          true,
        ).passed,
      ).toBe(false);
      const missing = { ...after, activities: after.activities.slice(1) };
      expect(grade(id, before, missing, evaluation, true).passed).toBe(false);
      expect(
        grade(
          id,
          before,
          { ...after, transitionModes: { unexpected: "walking" } },
          evaluation,
          true,
        ).passed,
      ).toBe(false);
      if (id === "S01")
        expect(grade(id, before, after, evaluation, false).passed).toBe(false);
      expect(
        modelProposalSchema.safeParse({ reason: "Fixture", operations })
          .success,
      ).toBe(true);
      expect(
        agentProposalSchema.safeParse({
          reason: "Fixture",
          operations,
          expectedRevision: before.revision,
          requestId: randomUUID(),
        }).success,
      ).toBe(true);
    });
  it("追踪只允许隔离数据库和显式合成标记，真实账号不能用请求参数开启", () => {
    expect(
      evalTracingAllowed({
        TRAVEL_EVAL_TRACE: "true",
        TRAVEL_EVAL_FIXTURES: "synthetic",
        DATABASE_URL: "postgres://a:b@localhost/brandontravel",
      }),
    ).toBe(false);
    expect(
      evalTracingAllowed({
        TRAVEL_EVAL_TRACE: "true",
        TRAVEL_EVAL_FIXTURES: "synthetic",
        DATABASE_URL: "postgres://a:b@localhost/bt_eval_ab12",
      }),
    ).toBe(true);
    expect(
      evalTracingAllowed({
        TRAVEL_EVAL_TRACE: "true",
        DATABASE_URL: "postgres://a:b@localhost/bt_eval_ab12",
      }),
    ).toBe(false);
  });
  it("字段白名单与凭据/身份脱敏，不记录模型思考", () => {
    const text = JSON.stringify(
      sanitize({
        id: "test",
        reason: "sk-secret Bearer xyz someone@example.com",
        apiKey: "SECRET",
        Authorization: "TOKEN",
        reasoning_content: "PRIVATE",
        notes: "USER",
        data: { status: "pending", token: "NESTED" },
      }),
    );
    for (const forbidden of [
      "secret",
      "xyz",
      "someone",
      "SECRET",
      "TOKEN",
      "PRIVATE",
      "USER",
      "NESTED",
    ])
      expect(text).not.toContain(forbidden);
    expect(text).toContain("pending");
  });
  it("追踪关闭不改变值、错误、Tool状态或供应商Response", async () => {
    const result = {
      isError: true,
      structuredContent: { error: { code: "TEST" } },
    };
    expect(await tracedTool("fixture", {}, async () => result)).toBe(result);
    await expect(
      traced("failure", "CHAIN", {}, async () => {
        throw new Error("fixture");
      }),
    ).rejects.toThrow("fixture");
    const response = new Response(
      JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 2 } }),
    );
    expect(await tracedModel("fixture", 1, async () => response)).toBe(
      response,
    );
    expect(await flushTracing()).toBe("disabled");
  });
});
