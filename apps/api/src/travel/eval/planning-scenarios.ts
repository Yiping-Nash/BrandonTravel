import type {
  TravelTrip,
  TravelActivity,
  TravelOperation,
  FactView,
  FactValue,
  Evaluation,
} from "@open-sunsama/types";
import { tasks } from "../kernel/service.js";
import { dayPressure } from "../kernel/planning.js";
import { stateDiff } from "./scenarios.js";
export const FIXED_NOW = "2026-10-12T04:00:00.000Z";
export const scenarioIds = ["S04", "S05", "S06", "S07", "S08"] as const;
export type ScenarioId = (typeof scenarioIds)[number];
export const stableId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const requests: Record<ScenarioId, string> = {
  S04: "明天早上想睡懒觉，十点之后再开始活动，帮我调整一下。",
  S05: "第二天下午想去双塔寺，帮我看看能不能塞进去。",
  S06: "第二天安排得太赶了，帮我轻松一点。",
  S07: "第二天的日程随便调整，但晚上七点的演出绝对不能动。",
  S08: "第二天下午两点到四点既要参观两个相距很远的景点，又不能缩短参观时间。",
};
export function fixture(id: ScenarioId, tripId = stableId(100)): TravelTrip {
  const a = (
    n: number,
    title: string,
    start: number | null,
    duration: number,
    date = "2026-10-14",
    locked = false,
  ): TravelActivity => ({
    id: stableId(n),
    title,
    date,
    start,
    duration,
    locked,
    position: n,
    notes: "虚构评测资料，不是预订",
    place: title,
    entityId: stableId(n + 100),
  });
  let activities: TravelActivity[] = [];
  if (id === "S04")
    activities = [
      a(1, "合成博物馆", 480, 90, "2026-10-13"),
      a(2, "合成下午景点", 720, 60, "2026-10-13"),
    ];
  if (id === "S05")
    activities = [
      a(1, "合成上午景点", 600, 60),
      a(2, "合成下午景点", 960, 60),
      a(3, "双塔寺", null, 90),
    ];
  if (id === "S06")
    activities = [
      a(1, "合成景点甲", 600, 60),
      a(2, "合成景点乙", 670, 60),
      a(3, "合成景点丙", 740, 60),
    ];
  if (id === "S07")
    activities = [
      a(1, "合成下午景点", 1050, 90),
      a(2, "合成演出", 1140, 60, "2026-10-14", true),
    ];
  if (id === "S08")
    activities = [a(1, "合成远景点甲", 840, 90), a(2, "合成远景点乙", 990, 90)];
  activities.push({
    ...a(9, "无关第三天", 600, 60, "2026-10-15"),
    entityId: undefined,
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
    entities: activities
      .filter((a) => a.entityId)
      .map((a, i) => ({
        id: a.entityId!,
        poiId: `SYNTHETIC-${i}`,
        name: a.title,
        address: "虚构地址",
        city: "太原市",
        longitude: 112.5 + i * 0.01,
        latitude: 37.8,
        provider: "amap",
        coordinateSystem: "GCJ-02",
        selectedAt: FIXED_NOW,
      })),
  };
}
export function fixtureFacts(id: ScenarioId, trip: TravelTrip): FactView[] {
  const result: FactView[] = [],
    fresh = (
      kind: FactView["kind"],
      subjectKey: string,
      value: FactValue,
      fingerprint: string,
    ): FactView => ({
      id: stableId(1000 + result.length),
      version: 1,
      kind,
      subjectKey,
      inputFingerprint: fingerprint,
      sourceRefId: trip.entities![0]!.id,
      collectionId: null,
      status: "available",
      retrievedAt: FIXED_NOW,
      sourcePublishedAt: FIXED_NOW,
      expiresAt: "2026-10-13T04:00:00.000Z",
      retryAfter: null,
      appliesTo: {
        dates: [],
        regionRef: null,
        basis:
          kind === "route_estimate" ? "current_estimate" : "described_hours",
      },
      quality: "complete",
      value,
      error: null,
      freshness: "fresh",
      unknownReason: null,
    });
  for (const t of tasks(
    trip,
    { requestId: stableId(999), kinds: ["opening_hours"], force: false },
    [],
  ))
    result.push(
      fresh(
        "opening_hours",
        t.subjectKey,
        {
          kind: "opening_hours",
          today: null,
          weekly:
            id === "S05" && t.subjectKey === stableId(103)
              ? "每天13:00-18:00"
              : "每天10:00-22:00",
          timezone: "Asia/Shanghai",
          parseStatus: "pending",
        },
        t.fingerprint,
      ),
    );
  const bound = trip.activities.filter((a) => a.entityId);
  for (const from of bound)
    for (const to of bound) {
      if (from.id === to.id) continue;
      const pair = {
        ...trip,
        activities: [
          { ...from, date: "2026-10-14", start: 600 },
          { ...to, date: "2026-10-14", start: 900 },
        ],
      };
      const t = tasks(
        pair,
        { requestId: stableId(999), kinds: ["route_estimate"], force: false },
        [],
      )[0]!;
      result.push(
        fresh(
          "route_estimate",
          t.subjectKey,
          {
            kind: "route_estimate",
            mode: "driving",
            fromEntityId: from.entityId!,
            toEntityId: to.entityId!,
            distanceMeters: id === "S08" ? 50000 : 1000,
            durationSeconds: (id === "S08" ? 60 : id === "S07" ? 30 : 20) * 60,
          },
          t.fingerprint,
        ),
      );
    }
  return result;
}
export function referenceOperations(
  id: ScenarioId,
  t: TravelTrip,
): TravelOperation[] {
  if (id === "S04")
    return [{ type: "edit", id: t.activities[0]!.id, patch: { start: 600 } }];
  if (id === "S05")
    return [{ type: "edit", id: t.activities[2]!.id, patch: { start: 840 } }];
  if (id === "S06")
    return [
      { type: "edit", id: t.activities[1]!.id, patch: { start: 700 } },
      { type: "edit", id: t.activities[2]!.id, patch: { start: 810 } },
    ];
  if (id === "S07")
    return [{ type: "edit", id: t.activities[0]!.id, patch: { start: 990 } }];
  return [];
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function grade(
  id: ScenarioId,
  before: TravelTrip,
  after: TravelTrip,
  evaluation: Evaluation,
  answer: string,
  tools: string[],
  candidate?: { activities: TravelActivity[]; evaluation: Evaluation },
) {
  const failures: string[] = [],
    check = (v: boolean, r: string) => {
      if (!v) failures.push(r);
    };
  check(
    after.id === before.id &&
      after.title === before.title &&
      after.startDate === before.startDate &&
      after.endDate === before.endDate,
    "无关Trip字段变化",
  );
  check(
    eq(after.entities, before.entities) &&
      eq(after.transitionModes, before.transitionModes),
    "无关地点/方式变化",
  );
  check(
    eq(
      [...after.activities.map((a) => a.id)].sort(),
      [...before.activities.map((a) => a.id)].sort(),
    ),
    "活动丢失/新增/重复",
  );
  for (const a of before.activities) {
    const b = after.activities.find((b) => a.id === b.id);
    check(!!b, "活动丢失");
    if (!b) continue;
    for (const k of [
      "id",
      "title",
      "duration",
      "notes",
      "entityId",
      "locked",
      "place",
    ] as const)
      check(eq(a[k], b[k]), `活动${k}被无授权改变`);
    if (a.id === stableId(9) || a.locked) check(eq(a, b), "固定/无关活动变化");
  }
  check(tools.includes("evaluate_trip"), "未读取真实领域评估");
  if (id === "S05" || id === "S08")
    check(eq(before, after), "询问/不可行场景不得提交修改");
  else {
    check(
      after.revision === before.revision + 1,
      "可行修改必须恰好提交一个事务",
    );
    check(
      !evaluation.results.some((r) => r.state === "CONFLICT"),
      "重排后仍有确定冲突",
    );
    check(
      evaluation.results
        .filter(
          (r) =>
            r.rule === "OPENING_COVERAGE" && r.activityIds[0] !== stableId(9),
        )
        .every((r) => r.state === "VALID"),
      "营业资料未验证",
    );
    check(
      evaluation.results
        .filter((r) => r.rule === "TRANSITION_GAP")
        .every((r) => r.state === "VALID"),
      "路程资料未验证",
    );
  }
  if (id === "S04")
    check(
      after.activities
        .filter((a) => a.date === "2026-10-13" && a.start !== null)
        .every((a) => a.start! >= 600) &&
        after.activities.filter(
          (a) => a.date === "2026-10-13" && a.start !== null,
        ).length >= 2,
      "明天活动应完整保留且10点后开始",
    );
  if (id === "S05") {
    check(!!candidate, "缺候选预览证据");
    if (candidate) {
      const target = candidate.activities.find((a) => a.id === stableId(3));
      check(
        !!target &&
          target.date === "2026-10-14" &&
          target.start !== null &&
          target.start >= 780 &&
          target.start + target.duration <= 1080,
        "候选应在第二天下午",
      );
      check(
        candidate.evaluation.results
          .filter(
            (r) =>
              r.activityIds.includes(stableId(3)) &&
              (r.rule === "OPENING_COVERAGE" ||
                r.rule === "TRANSITION_GAP" ||
                r.rule === "OVERLAP"),
          )
          .every((r) => r.state === "VALID"),
        "候选不可行或未知",
      );
    }
    check(/可以|可行|能安排|可安排/.test(answer), "未明确可行性判断");
  }
  if (id === "S06") {
    const b = dayPressure(before, "2026-10-14"),
      a = dayPressure(after, "2026-10-14");
    check(a.scheduledCount === b.scheduledCount, "不能靠移走所有活动伪装轻松");
    check(
      Math.min(...a.gaps.map((g) => g.gapMinutes)) >=
        Math.min(...b.gaps.map((g) => g.gapMinutes)) + 15,
      "最小空档未实质改善15分钟",
    );
  }
  if (id === "S08") {
    check(/无法|不能|不可行|不可能/.test(answer), "未解释不可行");
    check(
      /60|六十|1小时|一小时/.test(answer) && /90|九十|一个半/.test(answer),
      "未使用路线和停留数值解释",
    );
    check(!/已安排|已经安排/.test(answer), "虚假声称完成");
  }
  return { passed: !failures.length, failures, graderVersion: "B1" };
}
export { stateDiff };
