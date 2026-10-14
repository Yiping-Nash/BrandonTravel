import { it, expect } from "vitest";
import {
  fixture,
  referenceOperations,
  grade,
  scenarioIds,
} from "./reliability-scenarios.js";
import { applyOperations } from "../domain.js";
import { evaluate } from "@open-sunsama/utils/travel-intelligence";
for (const id of scenarioIds)
  it(id + " reference and lost/overwritten state negative", () => {
    let before = fixture(id);
    if (id === "S15")
      before = applyOperations(
        before,
        [
          {
            type: "edit",
            id: before.activities[0]!.id,
            patch: { date: "2026-10-14", start: 660 },
          },
        ],
        "agent",
      );
    let after = applyOperations(
      before,
      referenceOperations(id, before),
      "agent",
    );
    if (id === "S13")
      after = applyOperations(
        after,
        [{ type: "edit", id: before.activities[1]!.id, patch: { start: 540 } }],
        "user",
      );
    const evaluation = evaluate(after, [], 0),
      tools = [
        "get_trip",
        "get_trip",
        "find_proposal",
        "get_recent_changes",
        "preview_restore",
      ];
    expect(grade(id, before, after, evaluation, "", tools).passed).toBe(true);
    expect(
      grade(
        id,
        before,
        { ...after, activities: after.activities.slice(1) },
        evaluation,
        "",
        tools,
      ).passed,
    ).toBe(false);
    expect(grade(id, before, before, evaluation, "", []).passed).toBe(false);
  });
