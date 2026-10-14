import { describe, it, expect } from "vitest";
import { calculateDemo, demoScenes } from "./demo.js";
describe("Sprint13不落库演示", () => {
  it("所有受信场景可计算且来源与版本显式模拟", () => {
    for (const s of demoScenes) {
      const x = calculateDemo({ scene: s.id });
      expect(x.mode).toBe("DEMO");
      expect(x.sources[0]?.providerId).toBe("simulation");
    }
  });
  it("重叠移动后消失", () => {
    const s = calculateDemo({ scene: "overlap" });
    expect(s.evaluation.counts.CONFLICT).toBeGreaterThan(0);
    const r = calculateDemo({
      scene: "overlap",
      changes: [{ activityId: s.activities[1]!.id, start: 630 }],
    });
    expect(
      r.evaluation.results.filter(
        (r) => r.rule === "OVERLAP" && r.state === "CONFLICT",
      ),
    ).toHaveLength(0);
  });
  it("30分钟空档43分钟路线不足13，45分钟通过", () => {
    const s = calculateDemo({ scene: "route-shortage" });
    expect(
      s.evaluation.results.find((r) => r.rule === "TRANSITION_GAP")?.details,
    ).toMatchObject({ shortageMinutes: 13 });
    const r = calculateDemo({
      scene: "route-shortage",
      changes: [{ activityId: s.activities[1]!.id, start: 885 }],
    });
    expect(
      r.evaluation.results.find((r) => r.rule === "TRANSITION_GAP")?.state,
    ).toBe("VALID");
  });
  it("午间闭馆移动到开放时间", () => {
    const s = calculateDemo({ scene: "lunch-closure" });
    expect(
      s.evaluation.results.find((r) => r.rule === "OPENING_COVERAGE")?.state,
    ).toBe("CONFLICT");
    const r = calculateDemo({
      scene: "lunch-closure",
      changes: [{ activityId: s.activities[0]!.id, start: 1020 }],
    });
    expect(
      r.evaluation.results.find((r) => r.rule === "OPENING_COVERAGE")?.state,
    ).toBe("VALID");
  });
  it("强降雨户外提醒，室内不适用", () => {
    const s = calculateDemo({ scene: "weather" });
    expect(s.evaluation.counts.WARNING).toBeGreaterThan(0);
    const r = calculateDemo({
      scene: "weather",
      changes: s.activities.map((a) => ({
        activityId: a.id,
        environment: "indoor",
      })),
    });
    expect(
      r.capabilities.find((c) => c.rule === "WEATHER_EXPOSURE")?.notApplicable,
    ).toBe(s.activities.length);
  });
  it("拒绝任意事实注入和非内置活动", () => {
    expect(() => calculateDemo({ scene: "overlap", facts: [] })).toThrow();
    expect(() =>
      calculateDemo({
        scene: "overlap",
        changes: [
          { activityId: "00000000-0000-4000-8000-000000000001", start: 600 },
        ],
      }),
    ).toThrow();
  });
  it("每次重新计算从初始资产开始", () => {
    const s = calculateDemo({ scene: "overlap" });
    calculateDemo({
      scene: "overlap",
      changes: [{ activityId: s.activities[1]!.id, start: 630 }],
    });
    expect(calculateDemo({ scene: "overlap" })).toEqual(s);
  });
});
