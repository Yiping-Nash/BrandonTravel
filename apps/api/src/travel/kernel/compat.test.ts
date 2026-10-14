import { describe, it, expect } from "vitest";
import { toCanonical, toLegacy } from "./compat.js";
import type { TravelTrip } from "@open-sunsama/types";
const trip: TravelTrip = {
  id: "trip",
  title: "旧行程",
  timezone: "Asia/Shanghai",
  startDate: "2026-10-13",
  endDate: "2026-10-13",
  revision: 3,
  activities: [
    {
      id: "a",
      title: "活动",
      date: "2026-10-13",
      start: 600,
      duration: 60,
      locked: false,
      place: "旧文字",
      notes: "保留",
      position: 0,
    },
  ],
  entities: [
    {
      id: "e",
      provider: "amap",
      poiId: "poi",
      name: "地点",
      address: "地址",
      city: "大同",
      longitude: 113,
      latitude: 40,
      coordinateSystem: "GCJ-02",
      selectedAt: "2026-10-07T00:00:00.000Z",
    },
  ],
};
describe("内核兼容", () => {
  it("v1往返不改变身份/文本/版本/来源字段", () => {
    const c = toCanonical(trip);
    expect(toLegacy(c.trip, c.sources)).toEqual(trip);
    expect(c.trip.entities![0]).not.toHaveProperty("poiId");
  });
  it("旧写入保留v2户外属性", () => {
    const c = toCanonical(trip);
    c.trip.activities[0]!.environment = "outdoor";
    expect(
      toCanonical({ ...trip, title: "新标题" }, c.trip).trip.activities[0]!
        .environment,
    ).toBe("outdoor");
  });
  it("未知来源不伪装高德", () => {
    const c = toCanonical(trip);
    expect(() => toLegacy(c.trip, [])).toThrow("旧地点来源不可表达");
  });
});
