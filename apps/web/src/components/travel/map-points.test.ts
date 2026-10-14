import { it, expect } from "vitest";
import type { TravelTrip } from "@open-sunsama/types";
import { mapPoints } from "./map-points";
const trip = {
  entities: [{ id: "e", longitude: 113, latitude: 40 }],
  activities: [
    { id: "b", date: "2026-10-14", start: 600, position: 0, entityId: "e" },
    { id: "a", date: "2026-10-13", start: 600, position: 0 },
    { id: "c", date: "2026-10-13", start: 610, position: 0, entityId: "e" },
    { id: "d", date: null, start: null, position: 0, entityId: "e" },
  ],
} as TravelTrip;
it("两种地图共用排序和编号，缺地点不伪造，待安排不参与", () => {
  const p = mapPoints(trip, "all");
  expect(p.items.map((i) => [i.activity.id, i.number])).toEqual([
    ["c", 2],
    ["b", 3],
  ]);
  expect(p.missing).toBe(1);
});
it("日期筛选只呈现当天，不丢失缺地点数量", () => {
  const p = mapPoints(trip, "2026-10-13");
  expect(p.items.map((i) => i.activity.id)).toEqual(["c"]);
  expect(p.missing).toBe(1);
});
