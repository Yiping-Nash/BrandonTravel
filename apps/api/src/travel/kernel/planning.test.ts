import { it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  fixture,
  fixtureFacts,
  FIXED_NOW,
} from "../eval/planning-scenarios.js";
import { candidateFacts, insertionOptions } from "./planning.js";
import { travelNow } from "../clock.js";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FIXED_NOW));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("候选重新匹配不能把过期资料、错误方式、错误坐标升级为有效", () => {
  const t = fixture("S05"),
    facts = fixtureFacts("S05", t);
  const f = facts.find((f) => f.kind === "route_estimate")!;
  f.expiresAt = "2000-01-01T00:00:00Z";
  f.unknownReason = "FACT_INPUT_MISMATCH";
  expect(candidateFacts(t, facts).find((v) => v.id === f.id)?.freshness).toBe(
    "stale",
  );
  t.entities![0]!.longitude += 1;
  expect(candidateFacts(t, facts).some((v) => v.id === f.id)).toBe(false);
});
it("真实数据库即便配置测试时钟也忽略，只有隔离合成库可使用", () => {
  vi.stubEnv("TRAVEL_EVAL_FIXTURES", "synthetic");
  vi.stubEnv("TRAVEL_EVAL_CLOCK", "2000-01-01T00:00:00Z");
  vi.stubEnv("DATABASE_URL", "postgres://local/brandontravel");
  expect(travelNow().getUTCFullYear()).not.toBe(2000);
  vi.stubEnv("DATABASE_URL", "postgres://local/bt_eval_ab1234");
  expect(travelNow().getUTCFullYear()).toBe(2000);
});

it("插入候选只给引擎已判定的可行时段，资料缺失不伪装可行", () => {
  const trip = fixture("S05"),
    facts = fixtureFacts("S05", trip);
  const slots = insertionOptions(trip, facts, 1, "2026-10-14", {});
  expect(slots[0]?.slots[0]?.start).toBe(780);
  expect(insertionOptions(trip, [], 0, "2026-10-14", {})[0]?.slots).toEqual([]);
});

it("事实准备契约只允许有界日期和类型，禁止强制刷新绕过冷却", async () => {
  const { prepareInputSchema } = await import("./service.js");
  const base = {
    requestId: "00000000-0000-4000-8000-000000000001",
    date: "2026-10-14",
    kinds: ["weather"],
  };
  expect(prepareInputSchema.safeParse(base).success).toBe(true);
  expect(prepareInputSchema.safeParse({ ...base, force: true }).success).toBe(
    false,
  );
  expect(
    prepareInputSchema.safeParse({
      ...base,
      kinds: ["place", "weather", "opening_hours"],
    }).success,
  ).toBe(false);
  expect(prepareInputSchema.safeParse({ ...base, actor: "user" }).success).toBe(
    false,
  );
});

it("条件营业验证拒绝未知/过期/冲突，不把未知放行", async () => {
  const { requireOpeningCoverage } = await import("./planning.js");
  const { evaluate } = await import("@open-sunsama/utils/travel-intelligence");
  const trip = fixture("S04"),
    id = trip.activities[0]!.id;
  expect(() =>
    requireOpeningCoverage(evaluate(trip, [], 0), new Set([id])),
  ).toThrow("无法确认");
});

it("同坐标跨日期只生成一个天气任务，不同坐标保持独立", async () => {
  const { tasks } = await import("./service.js");
  const trip = fixture("S05");
  const first = trip.entities![0]!;
  const second = { ...first, id: "00000000-0000-4000-8000-000000000089" };
  trip.entities = [first, second];
  trip.activities = trip.activities.slice(0, 2).map((a, i) => ({
    ...a,
    entityId: i ? second.id : first.id,
    date: i ? "2026-10-15" : "2026-10-14",
  }));
  const input = {
    requestId: "00000000-0000-4000-8000-000000000088",
    kinds: ["weather" as const],
    force: false,
    dates: ["2026-10-14", "2026-10-15"],
  };
  expect(tasks(trip, input, [])).toHaveLength(1);
  second.longitude += 1;
  expect(tasks(trip, input, [])).toHaveLength(2);
});
