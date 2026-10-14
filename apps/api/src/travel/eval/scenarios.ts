import type {
  TravelTrip,
  TravelOperation,
  Evaluation,
} from "@open-sunsama/types";
export const FIXED_NOW = "2026-10-11T04:00:00.000Z";
export const scenarioIds = ["S01", "S02", "S03"] as const;
export type ScenarioId = (typeof scenarioIds)[number];
const stableId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function fixture(id: ScenarioId, tripId = stableId(100)): TravelTrip {
  const titles = ["合成抵达", "山西博物院", "晋祠", "合成第四天", "合成第五天"];
  const activities = titles.map((title, i) => ({
    id: stableId(i + 1),
    title,
    date: `2026-10-${13 + i}`,
    start: i === 1 ? 840 : 600,
    duration: i === 1 ? 120 : 60,
    locked: false,
    position: i,
    notes: `虚构Fixture备注${i}`,
    place: "地点待确认",
  }));
  if (id === "S02") activities[2]!.date = "2026-10-14";
  if (id === "S01")
    activities.push({
      id: stableId(6),
      title: "合成晚餐",
      date: "2026-10-14",
      start: 990,
      duration: 60,
      locked: false,
      position: 5,
      notes: "验证新增重叠，不是预订",
      place: "地点待确认",
    });
  return {
    id: tripId,
    title: `${id} 虚构评测`,
    startDate: "2026-10-13",
    endDate: "2026-10-17",
    timezone: "Asia/Shanghai",
    revision: 0,
    activities,
  };
}
export const requests: Record<ScenarioId, string> = {
  S01: "把第二天下午两点的山西博物院推迟到三点，参观时间仍然保持两小时。",
  S02: "周三不去晋祠了，先放回待安排区，之后再决定。",
  S03: "原本玩五天，现在只玩三天。后两天的安排不要删除，帮我保留下来。",
};
export function referenceOperations(
  id: ScenarioId,
  t: TravelTrip,
): TravelOperation[] {
  if (id === "S01")
    return [
      {
        type: "edit",
        id: t.activities.find((a) => a.title === "山西博物院")!.id,
        patch: { start: 900 },
      },
    ];
  if (id === "S02") {
    const target = t.activities.find((a) => a.title === "晋祠")!;
    return [{ type: "return_to_pending", ids: [target.id] }];
  }
  return [
    { type: "set_trip_range", startDate: t.startDate, endDate: "2026-10-15" },
  ];
}
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
}
const eq = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function stateDiff(before: TravelTrip, after: TravelTrip) {
  return {
    range: {
      before: [before.startDate, before.endDate],
      after: [after.startDate, after.endDate],
    },
    activities: before.activities
      .filter(
        (a) =>
          !eq(
            a,
            after.activities.find((b) => b.id === a.id),
          ),
      )
      .map((a) => ({
        id: a.id,
        before: a,
        after: after.activities.find((b) => b.id === a.id) ?? null,
      })),
    added: after.activities.filter(
      (a) => !before.activities.some((b) => b.id === a.id),
    ),
  };
}
export function grade(
  id: ScenarioId,
  before: TravelTrip,
  after: TravelTrip,
  evaluation: Evaluation,
  conflictDisclosed: boolean,
) {
  const failures: string[] = [];
  const check = (condition: boolean, reason: string) => {
    if (!condition) failures.push(reason);
  };
  check(
    after.id === before.id &&
      after.title === before.title &&
      after.timezone === before.timezone,
    "Trip身份/无关元数据变化",
  );
  check(after.revision === before.revision + 1, "计划应恰好一个事务版本");
  check(
    eq(
      [...after.activities.map((a) => a.id)].sort(),
      [...before.activities.map((a) => a.id)].sort(),
    ),
    "活动丢失/新增/重复",
  );
  check(
    eq(after.entities, before.entities) &&
      eq(after.transitionModes, before.transitionModes),
    "无关地点/交通方式变化",
  );
  check(evaluation.tripRevision === after.revision, "缺少当前计划评估");
  if (id === "S01" || id === "S02") {
    check(
      after.startDate === before.startDate && after.endDate === before.endDate,
      "无关日期范围改变",
    );
    const title = id === "S01" ? "山西博物院" : "晋祠",
      a = before.activities.find((a) => a.title === title)!,
      b = after.activities.find((b) => b.id === a.id);
    if (id === "S01")
      check(
        eq(b, { ...a, start: 900 }),
        "目标应15:00–17:00，ID/时长/其他内容不变",
      );
    else if (b) {
      check(
        b.start === null && b.date === a.date && b.backlogOriginDate === a.date,
        "退回须保留当前日期意向和原日期来源",
      );
      const { position: _p, ...rest } = b;
      const { position: _q, ...original } = a;
      check(
        eq(rest, { ...original, start: null, backlogOriginDate: a.date }),
        "退回内容变化",
      );
    }
    for (const a0 of before.activities.filter((a0) => a0.id !== a.id))
      check(
        eq(
          a0,
          after.activities.find((b) => b.id === a0.id),
        ),
        "无关活动变化",
      );
  } else {
    check(
      after.startDate === before.startDate && after.endDate === "2026-10-15",
      "应缩为前三天",
    );
    for (const a of before.activities) {
      const b = after.activities.find((b) => b.id === a.id);
      if (a.date! <= "2026-10-15") check(eq(a, b), "前三天不应变化");
      else if (b) {
        check(
          b.start === null && b.date === null && b.backlogOriginDate === a.date,
          "越界活动须按原日期保留待安排",
        );
        const { position: _p, ...rest } = b;
        const { position: _q, ...original } = a;
        check(
          eq(rest, {
            ...original,
            date: null,
            start: null,
            backlogOriginDate: a.date,
          }),
          "越界活动内容变化",
        );
      }
    }
  }
  if (evaluation.results.some((r) => r.state === "CONFLICT"))
    check(conflictDisclosed, "实际冲突没有披露");
  return { passed: failures.length === 0, failures, graderVersion: "1" };
}
