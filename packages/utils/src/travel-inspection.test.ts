import { describe, it, expect } from "vitest";
import {
  buildIntelligenceSnapshot,
  diagnoseFact,
  intelligenceSnapshotSchema,
} from "./travel-inspection";
import type { TravelTrip, FactView } from "@open-sunsama/types";
const now = new Date("2026-10-13T01:00:00Z");
const trip: TravelTrip = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "测试",
  startDate: "2026-10-13",
  endDate: "2026-10-20",
  timezone: "Asia/Shanghai",
  revision: 3,
  activities: [0, 1, 2].map((i) => ({
    id: "00000000-0000-4000-8000-" + String(i + 2).padStart(12, "0"),
    title: "活动" + i,
    date: "2026-10-13",
    start: 600 + i * 120,
    duration: 60,
    position: i,
    locked: false,
    notes: "",
    place: "未定位",
  })),
};
const build = (t = trip, env = {}) =>
  buildIntelligenceSnapshot(t, [], [], 0, env, now);
describe("Sprint13共享读模型", () => {
  it("重叠对象为无序比较对，合成VALID不能充当覆盖", () => {
    const s = build();
    expect(s.capabilities[0]?.objects).toBe(3);
    expect(s.capabilities[0]?.evaluated).toBe(3);
    expect(s.traces.filter((t) => t.rule === "TRANSITION_GAP")).toHaveLength(2);
  });
  it("同一活动缺地点跨规则只一个根因，保留轨迹", () => {
    const s = build();
    const roots = s.roots.filter((r) => r.reason === "PLACE_UNCONFIRMED");
    expect(roots).toHaveLength(3);
    expect(roots[1]!.traceIds.length).toBeGreaterThan(1);
  });
  it("多前置缺口保留，未知下游等待前置", () => {
    const s = build(),
      t = s.traces.find((t) => t.rule === "WEATHER_EXPOSURE")!;
    expect(t.inputs.some((i) => i.reason === "PLACE_UNCONFIRMED")).toBe(true);
    expect(t.inputs.some((i) => i.reason === "ENVIRONMENT_UNSPECIFIED")).toBe(
      true,
    );
    expect(t.inputs.find((i) => i.key === "weather")?.status).toBe(
      "WAITING_PREREQUISITE",
    );
  });
  it("室内不适用，待安排未进入检查，不制造通过", () => {
    const t = structuredClone(trip);
    t.activities[1]!.start = null;
    const s = build(t, { [t.activities[0]!.id]: "indoor" });
    const w = s.capabilities.find((c) => c.rule === "WEATHER_EXPOSURE")!;
    expect(w.notApplicable).toBe(1);
    expect(w.deferred).toBe(1);
    expect(w.evaluated).toBe(0);
  });
  it("空行程零检查对象", () => {
    const s = build({ ...trip, activities: [] });
    expect(
      s.capabilities.every((c) => c.objects === 0 && c.evaluated === 0),
    ).toBe(true);
  });
  it("活动过滤保留前后连接", () => {
    const s = buildIntelligenceSnapshot(trip, [], [], 0, {}, now, {
      activityId: trip.activities[1]!.id,
    });
    expect(s.traces.filter((t) => t.rule === "TRANSITION_GAP")).toHaveLength(2);
    expect(s.activities).toHaveLength(3);
  });
  it("日期过滤先完整评估，版本与详情一致", () => {
    const full = build(),
      s = buildIntelligenceSnapshot(trip, [], [], 0, {}, now, {
        date: "2026-10-13",
      });
    expect(s.evaluation.results).toEqual(
      full.evaluation.results.filter((r) => r.activityIds.length),
    );
    expect(s.capabilities).toEqual(full.capabilities);
    expect(intelligenceSnapshotSchema.safeParse(s).success).toBe(true);
  });
  it("不合并不同冲突连接", () => {
    const t = structuredClone(trip);
    for (const a of t.activities) a.start = 600;
    const s = build(t);
    expect(s.roots.filter((r) => r.reason === "ACTIVITY_OVERLAP")).toHaveLength(
      3,
    );
  });
  it("诊断区分未查询未提供失败过期不匹配不支持", () => {
    const base = {
      id: "x",
      version: 1,
      kind: "place",
      subjectKey: "a",
      sourceRefId: null,
      collectionId: null,
      inputFingerprint: "mock",
      status: "available",
      retrievedAt: now.toISOString(),
      sourcePublishedAt: null,
      expiresAt: new Date(+now + 1000).toISOString(),
      retryAfter: null,
      appliesTo: { dates: [], regionRef: null, basis: "selected_place" },
      quality: "complete",
      value: { kind: "place" },
      error: null,
      freshness: "fresh",
      unknownReason: null,
    } as unknown as FactView;
    const check = (f: FactView | undefined) =>
      diagnoseFact("place", "a", f, +now).status;
    expect(check(undefined)).toBe("NOT_QUERIED");
    expect(check({ ...base, status: "missing" })).toBe("NOT_PROVIDED");
    expect(check({ ...base, status: "failed" })).toBe("FAILED");
    expect(check({ ...base, freshness: "stale" })).toBe("STALE");
    expect(check({ ...base, unknownReason: "FACT_INPUT_MISMATCH" })).toBe(
      "MISMATCH",
    );
    expect(check({ ...base, quality: "partial" })).toBe("UNSUPPORTED");
  });
  it("未来预报等待与未绑定、未指定同时列出，不鼓励盲目查询天气", () => {
    const s = buildIntelligenceSnapshot(
      trip,
      [],
      [],
      0,
      {},
      new Date("2026-09-08T01:00:00Z"),
    );
    expect(
      s.roots.some(
        (r) =>
          r.reason === "WEATHER_OUT_OF_RANGE" &&
          r.category === "WAITING_EXTERNAL",
      ),
    ).toBe(true);
    expect(s.roots.some((r) => r.reason === "PLACE_UNCONFIRMED")).toBe(true);
    expect(
      s.traces
        .filter((t) => t.rule === "WEATHER_EXPOSURE")
        .every(
          (t) =>
            t.inputs.find((i) => i.key === "weather")?.status ===
            "WAITING_PREREQUISITE",
        ),
    ).toBe(true);
  });
  it("历史天气不伪装成外部等待", () => {
    const s = buildIntelligenceSnapshot(
      trip,
      [],
      [],
      0,
      {},
      new Date("2026-10-20T01:00:00Z"),
    );
    expect(
      s.roots
        .filter((r) => r.reason === "WEATHER_OUT_OF_RANGE")
        .every((r) => r.category === "INFORMATIONAL"),
    ).toBe(true);
  });
  it("营业原文可独立解析，查询日期限制不冒充解析失败", () => {
    const f = {
      kind: "opening_hours",
      status: "available",
      freshness: "fresh",
      value: { kind: "opening_hours", today: null, weekly: "09:00-18:00" },
      expiresAt: "2026-10-14T01:00:00Z",
      id: "mock",
      version: 1,
    } as unknown as FactView;
    const input = diagnoseFact("hours", "place", f, +now);
    expect(input.hoursParsing?.[0]?.parsed.quality).toBe("complete");
  });
  it("每项覆盖计数分区一致，READY不是通过", () => {
    const s = build();
    for (const c of s.capabilities)
      expect(c.objects).toBe(c.evaluated + c.needsData + c.notApplicable);
    expect(s.capabilities.every((c) => c.status === "READY")).toBe(true);
    expect(s.capabilities.some((c) => c.needsData > 0)).toBe(true);
  });
  it("冷却中的可重试失败等待；权限错误和字段未提供不承诺稍后可用", () => {
    const t = structuredClone(trip);
    const entity = "00000000-0000-4000-8000-000000000090";
    t.activities[0]!.entityId = entity;
    const f: FactView = {
      id: "00000000-0000-4000-8000-000000000091",
      version: 1,
      kind: "opening_hours",
      subjectKey: entity,
      inputFingerprint: "mock",
      sourceRefId: null,
      collectionId: null,
      status: "failed",
      retrievedAt: now.toISOString(),
      sourcePublishedAt: null,
      expiresAt: new Date(+now + 3600000).toISOString(),
      retryAfter: new Date(+now + 60000).toISOString(),
      appliesTo: { dates: [], regionRef: null, basis: "described_hours" },
      quality: "failed",
      value: null,
      error: { code: "TIMEOUT", retryable: true },
      freshness: "unknown",
      unknownReason: null,
    };
    const result = (fact: FactView) =>
      buildIntelligenceSnapshot(t, [fact], [], 1, {}, now).roots.find(
        (r) => r.reason === "FACT_PROVIDER_FAILED",
      );
    expect(result(f)?.category).toBe("WAITING_EXTERNAL");
    expect(
      result({ ...f, error: { code: "PERMISSION_DENIED", retryable: false } })
        ?.category,
    ).toBe("INFORMATIONAL");
    const missing = buildIntelligenceSnapshot(
      t,
      [{ ...f, status: "missing", error: null }],
      [],
      1,
      {},
      now,
    ).roots.find(
      (r) => r.reason === "FACT_MISSING" && r.dependency === "hours:" + entity,
    );
    expect(missing?.category).toBe("INFORMATIONAL");
    expect(missing?.action).toBe("VIEW_SOURCE");
  });
});
