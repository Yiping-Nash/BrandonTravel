import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { TravelTrip, TravelOperation } from "@open-sunsama/types";
import {
  calendar,
  resolveDate,
  dateIntent,
  constrainDates,
  assertDateConstraints,
  agentView,
  proposalReceipt,
} from "./agent-state";
import { normalizeOperations } from "./agent-tools";
const sample = (): TravelTrip => ({
  id: randomUUID(),
  title: "大同",
  timezone: "Asia/Shanghai",
  revision: 1,
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  activities: ["华严寺", "小院"].map((title, i) => ({
    id: randomUUID(),
    title,
    date: "2026-10-0" + (i + 1),
    start: 600,
    duration: 60,
    notes: "x".repeat(10000),
    place: "未定位",
    locked: false,
    position: i,
  })),
});
describe("Agent日期与精简状态", () => {
  it("行程日期表确定周六是10月3日", () => {
    const t = sample();
    expect(calendar(t)[2]).toEqual({
      date: "2026-10-03",
      weekday: "周六",
      day: 3,
    });
    for (const e of ["周六", "星期六", "第三天", "10月3日", "2026-10-03"])
      expect(resolveDate(t, e).matches[0]?.date).toBe("2026-10-03");
  });
  it("多星期、越界、日期星期冲突必须澄清", () => {
    const t = sample();
    t.endDate = "2026-10-10";
    expect(resolveDate(t, "周六").needsClarification).toBe(true);
    expect(dateIntent(sample(), "周六10月2日午餐").error).toBeTruthy();
    expect(dateIntent(sample(), "周一午餐").error).toBeTruthy();
    expect(dateIntent(sample(), "下周六午餐").error).toBeTruthy();
    expect(
      dateIntent(sample(), "第一天（10月1日）华严寺").error,
    ).toBeUndefined();
  });
  it("错星期日期不能进入提案，正确周六可以", () => {
    const t = sample();
    const op: TravelOperation = {
      type: "add",
      activity: {
        ...t.activities[0]!,
        id: randomUUID(),
        title: "午餐",
        date: "2026-10-02",
        start: 780,
      },
    };
    expect(() => constrainDates(t, "周六13:00午餐", [op])).toThrow(
      "日期不一致",
    );
    op.activity.date = "2026-10-03";
    expect(constrainDates(t, "周六13:00午餐", [op])[0]?.date).toBe(
      "2026-10-03",
    );
  });
  it("多日期命令逐活动绑定，交换或不明对应拒绝", () => {
    const t = sample();
    const ops: TravelOperation[] = [
      {
        type: "edit",
        id: t.activities[0]!.id,
        patch: { date: "2026-10-02", start: 600 },
      },
      {
        type: "edit",
        id: t.activities[1]!.id,
        patch: { date: "2026-10-03", start: 720 },
      },
    ];
    expect(
      constrainDates(t, "周五华严寺十点，周六小院十二点", ops),
    ).toHaveLength(2);
    ops[0] = {
      type: "edit",
      id: t.activities[0]!.id,
      patch: { date: "2026-10-03", start: 600 },
    };
    expect(() =>
      constrainDates(t, "周五华严寺十点，周六小院十二点", ops),
    ).toThrow();
  });
  it("事务日期约束验证表达与真实活动，不信任伪造约束", () => {
    const t = sample();
    const id = t.activities[0]!.id;
    expect(() =>
      assertDateConstraints(t, [
        { activityId: id, date: "2026-10-01", expression: "周六" },
      ]),
    ).toThrow("表达");
    expect(() =>
      assertDateConstraints(t, [
        { activityId: id, date: "2026-10-03", expression: "周六" },
      ]),
    ).toThrow("约束");
  });
  it("概览和按天不带备注，详情按需读取且分页有效JSON", () => {
    const t = sample();
    const overview = agentView(t, { view: "overview", query: "华严寺" });
    expect(JSON.stringify(overview)).not.toContain("x".repeat(50));
    expect(JSON.parse(JSON.stringify(overview)).activities).toHaveLength(1);
    expect(
      agentView(t, { view: "activity", activityId: t.activities[0]!.id })
        .activities[0],
    ).toHaveProperty("notes");
  });
  it("地点详情不向模型传候选确认凭据", () => {
    const t = sample();
    const id = randomUUID();
    t.activities[0]!.entityId = id;
    t.entities = [
      {
        id,
        poiId: "fixture",
        provider: "amap",
        name: "华严寺",
        address: "",
        city: "大同",
        longitude: 113,
        latitude: 40,
        coordinateSystem: "GCJ-02",
        selectedAt: new Date().toISOString(),
        selectionProof: "private-proof",
      },
    ];
    expect(
      JSON.stringify(
        agentView(t, { view: "activity", activityId: t.activities[0]!.id }),
      ),
    ).not.toContain("private-proof");
  });
  it("宿主生成新增身份，重试复用且模型不决定固定", () => {
    const t = sample(),
      ids = new Map<number, string>();
    const input = {
      reason: "午餐",
      operations: [
        {
          type: "add",
          activity: {
            title: "午餐",
            date: "2026-10-03",
            start: 780,
            duration: 60,
            id: "wrong",
            locked: true,
          },
        },
      ],
    };
    const one = normalizeOperations(input, t, ids, []),
      two = normalizeOperations(input, t, ids, []);
    expect(one).toEqual(two);
    expect(one[0]).toHaveProperty("activity.locked", false);
  });
  it("精简提案含差异但无前后整份快照", () => {
    const t = sample();
    const p = {
      id: randomUUID(),
      tripId: t.id,
      revision: 1,
      status: "pending" as const,
      reason: "调整",
      before: t,
      after: t,
      result: null,
      operations: [
        {
          type: "edit" as const,
          id: t.activities[0]!.id,
          patch: { start: 700 },
        },
      ],
    };
    const r = proposalReceipt(p);
    expect(r).toHaveProperty("changes");
    expect(r).not.toHaveProperty("before");
    expect(JSON.stringify(r).length).toBeLessThan(1000);
  });
});
