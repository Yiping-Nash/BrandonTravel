import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fixture,
  fixtureFacts,
  fixtureEnvironments,
  referenceOperations,
  grade,
  scenarioIds,
  FIXED_NOW,
} from "./fact-scenarios.js";
import { applyOperations } from "../domain.js";
import { evaluate } from "@open-sunsama/utils/travel-intelligence";
import { candidateFacts } from "../kernel/planning.js";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FIXED_NOW));
});
afterEach(() => vi.useRealTimers());
for (const id of scenarioIds)
  it(id + " strict reference / dishonest or destructive negative", () => {
    const before = fixture(id),
      facts = fixtureFacts(id, before),
      ops = referenceOperations(id, before),
      after = ops.length ? applyOperations(before, ops, "agent") : before;
    const e = evaluate(
      after,
      candidateFacts(after, facts),
      facts.length,
      new Date(FIXED_NOW),
      undefined,
      fixtureEnvironments(id),
    );
    const answer = "周一闭馆冲突；过期资料无法确认；户外活动退回待安排。";
    const tools = [
      "evaluate_trip",
      "prepare_operational_facts",
      "get_trip_context",
    ];
    expect(grade(id, before, after, e, answer, tools).passed).toBe(true);
    expect(
      grade(
        id,
        before,
        { ...after, activities: after.activities.slice(1) },
        e,
        answer,
        tools,
      ).passed,
    ).toBe(false);
    expect(grade(id, before, before, e, "确认开放，已经安排", []).passed).toBe(
      false,
    );
  });

it("S10必须实际触发暴雨提醒，过期或趋势不能冒充当前证据", () => {
  const t = fixture("S10"),
    facts = fixtureFacts("S10", t),
    env = fixtureEnvironments("S10");
  const e = evaluate(
    t,
    candidateFacts(t, facts),
    facts.length,
    new Date(FIXED_NOW),
    undefined,
    env,
  );
  expect(
    e.results.some(
      (r) =>
        r.rule === "WEATHER_EXPOSURE" && r.reasonCode === "OUTDOOR_HEAVY_RAIN",
    ),
  ).toBe(true);
});
