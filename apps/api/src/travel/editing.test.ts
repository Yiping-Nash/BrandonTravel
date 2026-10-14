import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { applyOperations } from "./domain";
import type { TravelTrip } from "@open-sunsama/types";
const sample = (): TravelTrip => ({
  id: randomUUID(),
  title: "测试",
  startDate: "2026-10-13",
  endDate: "2026-10-17",
  timezone: "Asia/Shanghai",
  revision: 2,
  activities: [0, 1, 2].map((i) => ({
    id: randomUUID(),
    title: "活动" + i,
    date: "2026-10-" + (13 + i),
    start: 600 + i * 60,
    duration: 60,
    position: i,
    notes: "保留",
    place: "待定位",
    locked: false,
  })),
});
describe("Sprint14日期及原日期待安排", () => {
  it("缩短保留身份内容、移除越界日期并记录来源", () => {
    const t = sample(),
      r = applyOperations(
        t,
        [
          {
            type: "set_trip_range",
            startDate: "2026-10-13",
            endDate: "2026-10-13",
          },
        ],
        "user",
      );
    expect(r.revision).toBe(3);
    expect(r.activities[1]).toMatchObject({
      id: t.activities[1]!.id,
      date: null,
      start: null,
      backlogOriginDate: "2026-10-14",
      notes: "保留",
    });
    expect(t.activities[1]!.start).toBe(660);
  });
  it("扩大不自动恢复，整体替换全部退回", () => {
    const t = sample(),
      r = applyOperations(
        t,
        [
          {
            type: "set_trip_range",
            startDate: "2026-10-16",
            endDate: "2026-10-17",
          },
        ],
        "user",
      );
    const expanded = applyOperations(
      r,
      [
        {
          type: "set_trip_range",
          startDate: "2026-10-13",
          endDate: "2026-10-17",
        },
      ],
      "user",
    );
    expect(expanded.activities.every((a) => a.start === null)).toBe(true);
  });
  it("越界固定项整批拒绝，原对象不变", () => {
    const t = sample();
    t.activities[1]!.locked = true;
    const prior = structuredClone(t);
    expect(() =>
      applyOperations(
        t,
        [
          {
            type: "set_trip_range",
            startDate: "2026-10-13",
            endDate: "2026-10-13",
          },
        ],
        "user",
      ),
    ).toThrow("请先解除固定");
    expect(t).toEqual(prior);
  });
  it("待安排日期越界也清除，单批退回及再次安排记录最近日期", () => {
    const t = sample();
    t.activities[2]!.start = null;
    const r = applyOperations(
      t,
      [
        {
          type: "return_to_pending",
          ids: [t.activities[0]!.id, t.activities[1]!.id],
        },
      ],
      "agent",
    );
    expect(r.activities[0]!.backlogOriginDate).toBe("2026-10-13");
    const id = r.activities[0]!.id;
    const next = applyOperations(
      r,
      [
        { type: "edit", id, patch: { date: "2026-10-15", start: 600 } },
        { type: "return_to_pending", ids: [id] },
      ],
      "user",
    );
    expect(next.activities[0]!.backlogOriginDate).toBe("2026-10-15");
    expect(next.activities[0]!.date).toBe("2026-10-15");
  });
  it("重复、不存在、非法范围拒绝", () => {
    const t = sample();
    expect(() =>
      applyOperations(
        t,
        [
          {
            type: "return_to_pending",
            ids: [t.activities[0]!.id, t.activities[0]!.id],
          },
        ],
        "user",
      ),
    ).toThrow();
    expect(() =>
      applyOperations(
        t,
        [{ type: "return_to_pending", ids: [randomUUID()] }],
        "user",
      ),
    ).toThrow();
    expect(() =>
      applyOperations(
        t,
        [
          {
            type: "set_trip_range",
            startDate: "2026-10-17",
            endDate: "2026-10-13",
          },
        ],
        "user",
      ),
    ).toThrow();
  });
});
describe("Sprint15原子批量编辑", () => {
  it("整体平移保留间距，分钟进位与Agent共用", () => {
    const t = sample(),
      ids = t.activities.map((a) => a.id),
      r = applyOperations(
        t,
        [{ type: "shift_activities", ids, days: 1, minutes: 30 }],
        "agent",
      );
    expect(r.activities[0]).toMatchObject({
      date: "2026-10-14",
      start: 630,
      duration: 60,
    });
    expect(r.activities[1]!.start! - r.activities[0]!.start!).toBe(60);
    t.startDate = "2026-10-12";
    const carry = applyOperations(
      t,
      [{ type: "shift_activities", ids: [ids[0]!], days: 0, minutes: -660 }],
      "user",
    );
    expect(carry.activities[0]).toMatchObject({
      date: "2026-10-12",
      start: 1380,
    });
  });
  it("删除和退回遇固定整批拒绝", () => {
    const t = sample();
    t.activities[1]!.locked = true;
    for (const type of ["delete_activities", "return_to_pending"] as const)
      expect(() =>
        applyOperations(
          t,
          [{ type, ids: t.activities.map((a) => a.id) }],
          "user",
        ),
      ).toThrow();
    expect(t.activities).toHaveLength(3);
  });
  it("越界、跨午夜、未安排、重复ID平移拒绝", () => {
    const t = sample(),
      id = t.activities[0]!.id;
    expect(() =>
      applyOperations(
        t,
        [{ type: "shift_activities", ids: [id], days: 10, minutes: 0 }],
        "user",
      ),
    ).toThrow();
    expect(() =>
      applyOperations(
        t,
        [{ type: "shift_activities", ids: [id], days: 0, minutes: 810 }],
        "user",
      ),
    ).toThrow();
    expect(() =>
      applyOperations(
        t,
        [{ type: "shift_activities", ids: [id, id], days: 0, minutes: 30 }],
        "user",
      ),
    ).toThrow();
    t.activities[0]!.start = null;
    expect(() =>
      applyOperations(
        t,
        [{ type: "shift_activities", ids: [id], days: 0, minutes: 30 }],
        "user",
      ),
    ).toThrow();
  });
});
