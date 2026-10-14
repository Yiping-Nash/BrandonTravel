import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { applyOperations } from "./domain.js";
import { transitions } from "./transitions.js";
import { parseRoute } from "./amap.js";
import type {
  TravelTrip,
  TravelEntity,
  TravelEstimate,
} from "@open-sunsama/types";
const entity = (id: string, n: number): TravelEntity => ({
  id,
  provider: "amap",
  poiId: `poi${n}`,
  name: `地点${n}`,
  address: "",
  city: "大同",
  longitude: 113 + n / 100,
  latitude: 40,
  coordinateSystem: "GCJ-02",
  selectedAt: new Date().toISOString(),
});
function sample(): TravelTrip {
  const e1 = randomUUID(),
    e2 = randomUUID();
  return {
    id: randomUUID(),
    title: "test",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    timezone: "Asia/Shanghai",
    revision: 2,
    entities: [entity(e1, 1), entity(e2, 2)],
    activities: [0, 1, 2].map((n) => ({
      id: randomUUID(),
      title: `活动${n}`,
      date: "2026-10-01",
      start: 600 + n * 60,
      duration: 45,
      position: n,
      locked: false,
      notes: "",
      place: "文本",
      entityId: n === 0 ? e1 : n === 2 ? e2 : null,
    })),
  };
}
describe("地点和连接领域", () => {
  it("默认驾车且显式步行保留，旧方式缓存不匹配", () => {
    const t = sample();
    t.activities[1]!.entityId = t.entities![1]!.id;
    const drive = transitions(t)[0]!;
    expect(drive.mode).toBe("driving");
    t.transitionModes = { [drive.id]: "walking" };
    const walk = transitions(t)[0]!;
    expect(walk.mode).toBe("walking");
    expect(walk.fingerprint).not.toBe(drive.fingerprint);
    const estimate: TravelEstimate = {
      fingerprint: walk.fingerprint!,
      status: "ready",
      distanceMeters: 100,
      durationSeconds: 60,
      queriedAt: new Date().toISOString(),
      source: "amap",
    };
    delete t.transitionModes;
    expect(transitions(t, { [walk.id]: estimate })[0]!.estimate).toBeNull();
  });
  it("不跳过无地点的中间活动，不跨夜", () => {
    const t = sample();
    expect(transitions(t)).toHaveLength(2);
    expect(transitions(t).every((x) => x.fingerprint === null)).toBe(true);
    t.activities[2]!.date = "2026-10-02";
    expect(transitions(t)).toHaveLength(1);
  });
  it("时间变化不改路线指纹，但重算可行性；地点改变失效", () => {
    const t = sample();
    t.activities[1]!.entityId = t.entities![1]!.id;
    const before = transitions(t)[0]!;
    const estimate: TravelEstimate = {
      fingerprint: before.fingerprint!,
      status: "ready",
      distanceMeters: 1000,
      durationSeconds: 1800,
      queriedAt: new Date().toISOString(),
      source: "amap",
    };
    const cache = { [estimate.fingerprint]: estimate };
    expect(transitions(t, cache)[0]!.shortageMinutes).toBe(15);
    t.activities[1]!.start = 720;
    expect(transitions(t, cache)[0]!.shortageMinutes).toBe(0);
    t.entities![1]!.longitude += 0.01;
    expect(transitions(t, cache)[0]!.estimate).toBeNull();
  });
  it("过期估计与未知有明确状态", () => {
    const t = sample();
    t.activities[1]!.entityId = t.entities![1]!.id;
    const f = transitions(t)[0]!.fingerprint!;
    const estimate: TravelEstimate = {
      fingerprint: f,
      status: "ready",
      distanceMeters: 1,
      durationSeconds: 1,
      queriedAt: new Date(0).toISOString(),
      source: "amap",
    };
    expect(transitions(t, { [f]: estimate })[0]!.freshness).toBe("stale");
    estimate.status = "unknown";
    estimate.durationSeconds = null;
    expect(transitions(t, { [f]: estimate })[0]!.shortageMinutes).toBeNull();
  });
  it("返回保留日期；排序完整无重复，固定仅保护时间", () => {
    const t = sample();
    t.activities.forEach((a) => (a.start = null));
    t.activities[0]!.locked = true;
    const ids = t.activities.map((a) => a.id).reverse();
    const next = applyOperations(t, [{ type: "reorder_pending", ids }], "user");
    expect(next.activities.find((a) => a.id === ids[0])!.position).toBe(0);
    expect(() =>
      applyOperations(t, [{ type: "reorder_pending", ids: [ids[0]!] }], "user"),
    ).toThrow();
    expect(() =>
      applyOperations(
        t,
        [{ type: "reorder_pending", ids: [ids[0]!, ids[0]!, ids[2]!] }],
        "user",
      ),
    ).toThrow();
    const scheduled = sample(),
      a = scheduled.activities[0]!;
    expect(
      applyOperations(
        scheduled,
        [{ type: "edit", id: a.id, patch: { start: null } }],
        "user",
      ).activities[0]!.date,
    ).toBe(a.date);
  });
  it("同POI复用实体，AI提案应用遵循同一地点规则，文本变更解除关联", () => {
    const t = sample(),
      a = t.activities[1]!;
    const existing = t.entities![0]!;
    const next = applyOperations(
      t,
      [
        {
          type: "bind_entity",
          id: a.id,
          entity: { ...existing, id: randomUUID() },
        },
      ],
      "user",
    );
    expect(next.entities).toHaveLength(2);
    expect(next.activities[1]!.entityId).toBe(existing.id);
    expect(
      applyOperations(
        t,
        [{ type: "bind_entity", id: a.id, entity: existing }],
        "agent",
      ).activities[1]!.entityId,
    ).toBe(existing.id);
    expect(
      applyOperations(
        next,
        [{ type: "edit", id: a.id, patch: { place: "新地点" } }],
        "user",
      ).activities[1]!.entityId,
    ).toBeNull();
  });
  it("解析真实路由数据结构，缺失耗时不得变成零", () => {
    expect(
      parseRoute(
        {
          status: "1",
          route: { paths: [{ distance: "1500", cost: { duration: "900" } }] },
        },
        "f",
      ).durationSeconds,
    ).toBe(900);
    expect(() =>
      parseRoute(
        { status: "1", route: { paths: [{ distance: "1500" }] } },
        "f",
      ),
    ).toThrow();
    expect(() =>
      parseRoute({ status: "1", route: { paths: [] } }, "f"),
    ).toThrow();
  });
});
