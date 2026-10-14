import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { applyOperations, validateTrip, conflicts } from "./domain";
import type { TravelTrip } from "@open-sunsama/types";
function trip(): TravelTrip {
  return {
    id: randomUUID(),
    title: "大同",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    timezone: "Asia/Shanghai",
    revision: 0,
    activities: [
      {
        id: randomUUID(),
        title: "固定返程",
        date: "2026-10-03",
        start: 1050,
        duration: 30,
        locked: true,
        place: "大同南站",
        notes: "示例",
        position: 0,
      },
    ],
  };
}
describe("旅行领域保护", () => {
  it("AI不能通过先解除固定再移动绕过保护", () => {
    const t = trip(),
      id = t.activities[0]!.id;
    expect(() =>
      applyOperations(
        t,
        [
          { type: "edit", id, patch: { locked: false } },
          { type: "edit", id, patch: { start: 600 } },
        ],
        "agent",
      ),
    ).toThrow("固定");
    expect(t.revision).toBe(0);
    expect(t.activities[0]!.locked).toBe(true);
  });
  it("固定活动只改标题时允许相同时间字段", () => {
    const t = trip(),
      a = t.activities[0]!;
    const next = applyOperations(
      t,
      [
        {
          type: "edit",
          id: a.id,
          patch: {
            title: "返程备注",
            date: a.date,
            start: a.start,
            duration: a.duration,
          },
        },
      ],
      "user",
    );
    expect(next.activities[0]!.title).toBe("返程备注");
    expect(next.activities[0]!.locked).toBe(true);
  });
  it("同一次修改解锁并改时间仍要求先独立解锁", () => {
    const t = trip();
    expect(() =>
      applyOperations(
        t,
        [
          {
            type: "edit",
            id: t.activities[0]!.id,
            patch: { locked: false, start: 600 },
          },
        ],
        "user",
      ),
    ).toThrow("先解除固定");
  });
  it("缩短行程不静默遗失固定活动", () => {
    const t = trip();
    expect(() =>
      applyOperations(
        t,
        [{ type: "trip", patch: { endDate: "2026-10-02" } }],
        "user",
      ),
    ).toThrow("超出");
    expect(t.endDate).toBe("2026-10-03");
  });
  it("跨午夜与重复身份被拒绝", () => {
    const t = trip();
    t.activities[0]!.start = 1430;
    expect(() => validateTrip(t)).toThrow("跨午夜");
    t.activities[0]!.start = 1050;
    t.activities.push(structuredClone(t.activities[0]!));
    expect(() => validateTrip(t)).toThrow("身份重复");
  });
  it("重叠允许保存且可以查询冲突", () => {
    const t = trip(),
      a = t.activities[0]!;
    const next = applyOperations(
      t,
      [
        {
          type: "add",
          activity: {
            ...a,
            id: randomUUID(),
            title: "另一安排",
            locked: false,
          },
        },
      ],
      "user",
    );
    expect(next.revision).toBe(1);
    expect(conflicts(next)).toHaveLength(1);
  });
});
