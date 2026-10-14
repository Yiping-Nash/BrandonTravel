import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fixture,
  fixtureFacts,
  referenceOperations,
  grade,
  scenarioIds,
  FIXED_NOW,
} from "./planning-scenarios.js";
import { applyOperations } from "../domain.js";
import { evaluate } from "@open-sunsama/utils/travel-intelligence";
import { candidateFacts } from "../kernel/planning.js";
import { resolveDate, dateIntent } from "../agent-state.js";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FIXED_NOW));
});
afterEach(() => vi.useRealTimers());
describe("Sprint B fixture and strict graders", () => {
  for (const id of scenarioIds)
    it(id + " reference and no-op/loss negative", () => {
      const before = fixture(id),
        facts = fixtureFacts(id, before),
        ops = referenceOperations(id, before);
      const after = ops.length ? applyOperations(before, ops, "agent") : before;
      const evaluation = evaluate(
        after,
        candidateFacts(after, facts),
        facts.length,
        new Date(FIXED_NOW),
      );
      const text =
        "可以安排。无法完成：两个各90分钟，加60分钟路线，需要240分钟。";
      expect(
        grade(
          id,
          before,
          id === "S05" ? before : after,
          evaluation,
          text,
          ["evaluate_trip"],
          { activities: after.activities, evaluation },
        ).passed,
      ).toBe(true);
      expect(
        grade(
          id,
          before,
          { ...after, activities: after.activities.slice(1) },
          evaluation,
          text,
          ["evaluate_trip"],
        ).passed,
      ).toBe(false);
      if (!["S05", "S08"].includes(id))
        expect(
          grade(id, before, before, evaluation, text, ["evaluate_trip"]).passed,
        ).toBe(false);
      else
        expect(grade(id, before, before, evaluation, "没问题", []).passed).toBe(
          false,
        );
    });
  it("relative date uses trusted timezone clock, out-of-trip clarifies", () => {
    const t = fixture("S04");
    expect(resolveDate(t, "明天", new Date(FIXED_NOW)).matches[0]?.date).toBe(
      "2026-10-13",
    );
    expect(
      resolveDate(t, "明天", new Date("2026-10-12T17:00:00Z")).matches[0]?.date,
    ).toBe("2026-10-14");
    expect(resolveDate(t, "今天", new Date(FIXED_NOW)).needsClarification).toBe(
      true,
    );
    expect(dateIntent(t, "下周去博物馆").error).toBeDefined();
  });
});
