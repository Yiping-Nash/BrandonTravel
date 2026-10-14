import type {
  TravelTrip,
  TravelOperation,
  FactView,
  Evaluation,
} from "@open-sunsama/types";
import {
  fixture as baseFixture,
  fixtureFacts as baseFacts,
  stableId,
  FIXED_NOW,
  stateDiff,
} from "./planning-scenarios.js";
import { tasks } from "../kernel/service.js";
import { weatherLocation } from "@open-sunsama/utils/travel-weather-location";
export { FIXED_NOW, stateDiff };
export const scenarioIds = ["S09", "S10", "S11", "S12"] as const;
export type ScenarioId = (typeof scenarioIds)[number];
export const requests: Record<ScenarioId, string> = {
  S09: "把这个景点（合成周一闭馆景点）改到周一下午参观。",
  S10: "第二天下午有雨，把户外活动调整一下。",
  S11: "这家店（合成餐厅）明晚还能去吗？能的话就放到行程里。",
  S12: "重新整理第三天，尽量高效一点。",
};
export function fixture(id: ScenarioId, tripId?: string): TravelTrip {
  const t = baseFixture(id === "S12" ? "S06" : "S04", tripId);
  t.title = id + " 虚构评测";
  t.endDate = "2026-10-19";
  if (id === "S09" || id === "S11") {
    t.activities = t.activities.filter((a) => a.id !== stableId(2));
    t.entities = t.entities?.filter((e) => e.id !== stableId(102));
    t.activities[0]!.title = id === "S09" ? "合成周一闭馆景点" : "合成餐厅";
    t.activities[0]!.start = id === "S11" ? null : 900;
  }
  if (id === "S10") {
    t.activities[0]!.title = "合成户外公园";
    t.activities[0]!.date = "2026-10-14";
    t.activities[0]!.start = 780;
    t.activities[1]!.title = "合成室内博物馆";
    t.activities[1]!.date = "2026-10-14";
    t.activities[1]!.start = 960;
  }
  if (id === "S12")
    for (const a of t.activities.filter((a) => a.id !== stableId(9))) {
      a.date = "2026-10-15";
      a.start = a.position === 1 ? 360 : 420 + (a.position - 2) * 120;
    }
  if (id === "S12")
    t.activities.find((a) => a.id === stableId(9))!.date = "2026-10-16";
  return t;
}
export const fixtureEnvironments = (
  id: ScenarioId,
): Record<string, "indoor" | "outdoor" | "unspecified"> =>
  id === "S10" ? { [stableId(1)]: "outdoor", [stableId(2)]: "indoor" } : {};
export const priorMessages = (id: ScenarioId) =>
  id === "S12" ? ["我这次旅行不喜欢七点前出门。"] : [];
export function fixtureFacts(id: ScenarioId, t: TravelTrip): FactView[] {
  const facts = baseFacts("S04", t);
  if (id === "S09") {
    const f = facts.find(
      (f) => f.kind === "opening_hours" && f.subjectKey === stableId(101),
    )!;
    if (f.value?.kind === "opening_hours")
      f.value.weekly = "周一闭馆;周二-周日10:00-22:00";
  }
  if (id === "S11") {
    const f = facts.find((f) => f.kind === "opening_hours")!;
    f.expiresAt = "2026-10-11T04:00:00Z";
    f.retryAfter = "2026-10-12T04:05:00Z";
    f.error = { code: "PROVIDER_FAILED", retryable: true };
  }
  if (id === "S10") {
    for (const task of tasks(
      t,
      {
        requestId: stableId(999),
        kinds: ["weather"],
        dates: ["2026-10-14"],
        force: false,
      },
      [],
    )) {
      const point = weatherLocation(task.entity!);
      facts.push({
        id: stableId(2000 + facts.length),
        version: 1,
        kind: "weather",
        subjectKey: task.subjectKey,
        inputFingerprint: task.fingerprint,
        sourceRefId: t.entities![0]!.id,
        collectionId: null,
        status: "available",
        retrievedAt: FIXED_NOW,
        sourcePublishedAt: FIXED_NOW,
        expiresAt: "2026-10-13T04:00:00Z",
        retryAfter: null,
        quality: "complete",
        error: null,
        freshness: "fresh",
        unknownReason: null,
        appliesTo: {
          dates: ["2026-10-14", "2026-10-15"],
          regionRef: point.key,
          basis: "provider_dates",
        },
        value: {
          kind: "weather",
          regionCode: point.key,
          regionName: "虚构区域",
          providerId: "open-meteo",
          dataKind: "daily_forecast",
          observation: null,
          days: [
            {
              date: "2026-10-14",
              dayCondition: "暴雨",
              nightCondition: "暴雨",
              highTemperature: 20,
              lowTemperature: 12,
            },
            {
              date: "2026-10-15",
              dayCondition: "晴",
              nightCondition: "晴",
              highTemperature: 20,
              lowTemperature: 12,
            },
          ],
        },
      });
    }
  }
  return facts;
}
export function referenceOperations(
  id: ScenarioId,
  t: TravelTrip,
): TravelOperation[] {
  if (id === "S09")
    return [
      {
        type: "edit",
        id: stableId(1),
        patch: { date: "2026-10-19", start: 900 },
      },
    ];
  if (id === "S10") return [{ type: "return_to_pending", ids: [stableId(1)] }];
  if (id === "S11") return [];
  return t.activities
    .filter((a) => a.id !== stableId(9))
    .map((a, i) => ({
      type: "edit",
      id: a.id,
      patch: { start: 600 + i * 100 },
    }));
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function grade(
  id: ScenarioId,
  b: TravelTrip,
  a: TravelTrip,
  e: Evaluation,
  answer: string,
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
    "无关行程/地点变化",
  );
  check(
    eq(
      [...a.activities.map((a) => a.id)].sort(),
      [...b.activities.map((a) => a.id)].sort(),
    ),
    "活动丢失/新增/重复",
  );
  for (const old of b.activities) {
    const now = a.activities.find((a) => a.id === old.id);
    if (!now) continue;
    for (const k of [
      "id",
      "title",
      "duration",
      "notes",
      "locked",
      "entityId",
      "place",
    ] as const)
      check(eq(old[k], now[k]), "身份/内容被擅改");
    if ((id !== "S12" && old.id !== stableId(1)) || old.id === stableId(9))
      check(eq(old, now), "无关活动变化");
  }
  check(tools.includes("evaluate_trip"), "未使用当前运营事实/规则");
  if (id === "S09") {
    check(/闭馆|不开放|关闭|冲突/.test(answer), "未解释周一关闭");
    if (a.revision !== b.revision)
      check(
        e.results.some(
          (r) => r.rule === "OPENING_COVERAGE" && r.state === "CONFLICT",
        ),
        "保存草稿不得掩盖闭馆冲突",
      );
    check(!/周一.*可以入场|周一.*正常开放/.test(answer), "虚假入场确认");
  }
  if (id === "S10") {
    check(a.revision === b.revision + 1, "明确天气调整需提案确认");
    const target = a.activities.find((a) => a.id === stableId(1));
    check(
      !!target &&
        target.start === null &&
        target.backlogOriginDate === "2026-10-14",
      "避雨需保留户外活动及原日期待安排",
    );
    check(
      !e.results.some(
        (r) => r.rule === "WEATHER_EXPOSURE" && r.state === "WARNING",
      ),
      "仍安排在已知强雨中",
    );
    check(/待安排/.test(answer), "必须披露退回后仍需安排");
  }
  if (id === "S11") {
    check(eq(b, a), "未能验证营业不应执行条件安排");
    check(/过期|未知|无法确认|未核实|不能确认/.test(answer), "未诚实说明未知");
    check(tools.includes("prepare_operational_facts"), "未尝试受控刷新");
  }
  if (id === "S12") {
    check(tools.includes("get_trip_context"), "未读取本行程偏好来源");
    check(a.revision === b.revision + 1, "可行整理不应no-op");
    check(
      a.activities
        .filter((a) => a.date === "2026-10-15" && a.id !== stableId(9))
        .every((a) => a.start !== null && a.start >= 420),
      "忽略七点前不出门偏好",
    );
    check(!e.results.some((r) => r.state === "CONFLICT"), "整理后仍有冲突");
  }
  return { passed: !failures.length, failures, graderVersion: "C1" };
}
