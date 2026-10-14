import type {
  TravelTrip,
  TravelOperation,
  FactView,
  Evaluation,
} from "@open-sunsama/types";
import { stableId, FIXED_NOW, stateDiff } from "./planning-scenarios.js";
export { FIXED_NOW, stateDiff };
export const scenarioIds = ["S13", "S14", "S15"] as const;
export type ScenarioId = (typeof scenarioIds)[number];
export const requests: Record<ScenarioId, string> = {
  S13: "把晋祠调整到十一点，时长不变。",
  S14: "把晋祠调整到十一点，保留刚刚完成的其他安排。",
  S15: "还是算了，恢复刚才晋祠的安排，但保留新增的午餐。",
};
export function fixture(id: ScenarioId, tripId = stableId(100)): TravelTrip {
  return {
    id: tripId,
    title: id + " 虚构可靠性评测",
    startDate: "2026-10-13",
    endDate: "2026-10-17",
    timezone: "Asia/Shanghai",
    revision: 0,
    activities: [
      {
        id: stableId(1),
        title: "晋祠",
        date: "2026-10-13",
        start: 600,
        duration: 60,
        locked: false,
        position: 1,
        notes: "虚构原始备注",
        place: "地点待确认",
      },
      {
        id: stableId(2),
        title: "无关活动",
        date: "2026-10-14",
        start: 600,
        duration: 60,
        locked: false,
        position: 2,
        notes: "不应修改",
        place: "地点待确认",
      },
    ],
  };
}
export const fixtureFacts = (
  _id: ScenarioId,
  _trip: TravelTrip,
): FactView[] => [];
export function referenceOperations(
  id: ScenarioId,
  t: TravelTrip,
): TravelOperation[] {
  return [
    {
      type: "edit",
      id: t.activities[0]!.id,
      patch: id === "S15" ? { date: "2026-10-13", start: 600 } : { start: 660 },
    },
  ];
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function grade(
  id: ScenarioId,
  b: TravelTrip,
  a: TravelTrip,
  e: Evaluation,
  _answer: string,
  tools: string[],
) {
  const failures: string[] = [],
    check = (v: boolean, r: string) => {
      if (!v) failures.push(r);
    };
  check(
    a.id === b.id &&
      a.title === b.title &&
      a.startDate === b.startDate &&
      a.endDate === b.endDate &&
      eq(a.entities, b.entities) &&
      eq(a.transitionModes, b.transitionModes),
    "无关Trip字段变化",
  );
  check(
    eq(
      [...a.activities.map((a) => a.id)].sort(),
      [...b.activities.map((a) => a.id)].sort(),
    ),
    "活动重复/丢失/新增",
  );
  check(
    a.revision === b.revision + (id === "S13" ? 2 : 1),
    "事务版本不符合实际提交数",
  );
  check(e.tripRevision === a.revision, "未读回当前版本评估");
  const target = a.activities.find((a) => a.id === stableId(1));
  check(
    !!target &&
      eq(target, {
        ...b.activities[0],
        ...(id === "S15" ? { date: "2026-10-13", start: 600 } : { start: 660 }),
      }),
    "目标身份/时间/备注不正确",
  );
  for (const original of b.activities.filter((a) => a.id !== stableId(1)))
    check(
      eq(
        a.activities.find((a) => a.id === original.id),
        id === "S13" && original.id === stableId(2)
          ? { ...original, start: 540 }
          : original,
      ),
      "较新人类修改/独立新增午餐被覆盖",
    );
  if (id === "S13")
    check(
      tools.filter((t) => t === "get_trip").length >= 2,
      "并发后未重新读取计划",
    );
  if (id === "S14")
    check(tools.includes("find_proposal"), "工具失败未先查询持久化结果");
  if (id === "S15")
    check(
      tools.includes("get_recent_changes") && tools.includes("preview_restore"),
      "恢复未依据真实历史及共享逆操作",
    );
  return { passed: !failures.length, failures, graderVersion: "D1" };
}
