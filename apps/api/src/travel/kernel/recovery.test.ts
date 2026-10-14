import { it, expect } from "vitest";
import { inverseSchedule } from "./recovery.js";
import { fixture } from "../eval/scenarios.js";
import { applyOperations } from "../domain.js";
it("只恢复指定时间，新增午餐及后来备注不回滚", () => {
  const before = fixture("S01"),
    id = before.activities[1]!.id;
  const moved = applyOperations(
    before,
    [{ type: "edit", id, patch: { date: "2026-10-15", start: 900 } }],
    "agent",
  );
  const current = structuredClone(moved);
  current.activities[1]!.notes = "后来添加的重要备注";
  current.activities.push({
    ...before.activities[0]!,
    id: "00000000-0000-4000-8000-000000000222",
    title: "独立新增午餐",
  });
  const ops = inverseSchedule(before, moved, current, id),
    after = applyOperations(current, ops, "agent");
  expect(after.activities[1]!.date).toBe(before.activities[1]!.date);
  expect(after.activities[1]!.start).toBe(840);
  expect(after.activities[1]!.notes).toBe("后来添加的重要备注");
  expect(after.activities.at(-1)?.title).toBe("独立新增午餐");
});
it("目标时间后来变化/固定/活动删除时拒绝恢复，不静默覆盖", () => {
  const before = fixture("S01"),
    id = before.activities[1]!.id,
    moved = applyOperations(
      before,
      [{ type: "edit", id, patch: { start: 900 } }],
      "agent",
    );
  const later = structuredClone(moved);
  later.activities[1]!.start = 930;
  expect(() => inverseSchedule(before, moved, later, id)).toThrow("后来");
  later.activities[1]!.start = 900;
  later.activities[1]!.locked = true;
  expect(() => inverseSchedule(before, moved, later, id)).toThrow();
  expect(() =>
    inverseSchedule(before, moved, { ...moved, activities: [] }, id),
  ).toThrow();
});
