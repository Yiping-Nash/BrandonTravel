import { describe, it, expect } from "vitest";
import type { TravelTrip, IntelligenceSnapshot } from "@open-sunsama/types";
import {
  attemptAllowed,
  refreshDemand,
  refreshInputKey,
} from "./refresh-policy";
const trip = {
  revision: 1,
  activities: [
    { id: "a", date: "2026-10-13", start: 600, duration: 60, entityId: "p" },
    { id: "b", date: "2026-10-13", start: 690, duration: 60, entityId: "q" },
  ],
  entities: [],
  transitionModes: {},
} as unknown as TravelTrip;
const snap = (
  status: string = "AVAILABLE",
  routeState: string = "VALID",
  canQuery = true,
) =>
  ({
    evaluation: { tripRevision: 1 },
    days: [{ weatherQuery: { canQuery }, regions: [{ status, factRefs: [] }] }],
    connections: [{ fromId: "a", toId: "b", state: routeState }],
    facts: [],
  }) as unknown as IntelligenceSnapshot;
describe("可见行程刷新策略", () => {
  it("有效Snapshot只读，不发刷新；旧计划版本不得用于调度", () => {
    expect(refreshDemand(trip, snap())).toEqual([]);
    const s = snap("STALE");
    s.evaluation.tripRevision = 0;
    expect(refreshDemand(trip, s)).toEqual([]);
  });
  it("缺失/过期/失配来自服务端分类，按需选择资料", () => {
    expect(refreshDemand(trip, snap("STALE"))).toEqual(["weather"]);
    expect(refreshDemand(trip, snap("MISMATCH", "UNKNOWN"))).toEqual([
      "weather",
      "route_estimate",
    ]);
    expect(refreshDemand(trip, snap("NOT_QUERIED"))).toEqual(["weather"]);
  });
  it("范围外和不能查询不自动追查", () => {
    expect(refreshDemand(trip, snap("OUT_OF_RANGE"))).toEqual([]);
    expect(refreshDemand(trip, snap("FAILED", "VALID", false))).toEqual([]);
  });
  it("已取得但未覆盖的天气不在有效期内重复查", () => {
    const s = snap("NOT_PROVIDED");
    s.days![0]!.regions[0]!.factRefs = [{ id: "w", version: 1 }];
    s.facts = [
      { id: "w", freshness: "fresh" },
    ] as IntelligenceSnapshot["facts"];
    expect(refreshDemand(trip, s)).toEqual([]);
    s.facts[0]!.freshness = "stale";
    expect(refreshDemand(trip, s)).toEqual(["weather"]);
  });
  it("未确认两端地点的连接不能触发路线外呼", () => {
    const t = structuredClone(trip);
    t.activities[0]!.entityId = null;
    expect(refreshDemand(t, snap("AVAILABLE", "UNKNOWN"))).toEqual([]);
  });
  it("失败退避和新输入恢复用模拟时钟判定", () => {
    const a = { input: "old", nextAttemptAt: 300000 };
    expect(attemptAllowed(a, "old", 299999)).toBe(false);
    expect(attemptAllowed(a, "old", 300000)).toBe(true);
    expect(attemptAllowed(a, "new", 1)).toBe(true);
  });
  it("路线输入变更可即时补查；文本备注不触发", () => {
    const t = structuredClone(trip);
    t.activities[0]!.start = 615;
    expect(refreshInputKey(t, "route_estimate")).not.toBe(
      refreshInputKey(trip, "route_estimate"),
    );
    t.activities[0]!.start = 600;
    t.activities[0]!.notes = "备注";
    expect(refreshInputKey(t, "route_estimate")).toBe(
      refreshInputKey(trip, "route_estimate"),
    );
  });
});
