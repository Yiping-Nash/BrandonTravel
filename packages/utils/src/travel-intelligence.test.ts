import { describe, it, expect } from "vitest";
import {
  parseHours,
  intervalsFor,
  evaluate,
  projectEvaluation,
  routeResult,
  DEFAULT_POLICY,
} from "./travel-intelligence";
import {
  evaluationSchema,
  intelligenceQuerySchema,
} from "./travel-kernel-contract";
import type { TravelTrip, FactView } from "@open-sunsama/types";
const date = "2026-10-13",
  now = new Date("2026-10-13T01:00:00Z");
const trip: TravelTrip = {
  id: "trip",
  title: "样例",
  startDate: date,
  endDate: "2026-10-15",
  timezone: "Asia/Shanghai",
  revision: 2,
  activities: [
    {
      id: "a",
      title: "景点A",
      date,
      start: 780,
      duration: 60,
      locked: false,
      position: 0,
      place: "地点A",
      notes: "",
      entityId: "ea",
    },
    {
      id: "b",
      title: "景点B",
      date,
      start: 870,
      duration: 60,
      locked: false,
      position: 1,
      place: "地点B",
      notes: "",
      entityId: "eb",
    },
  ],
};
const route: FactView = {
  id: "route",
  version: 1,
  kind: "route_estimate",
  subjectKey: "a:b",
  inputFingerprint: "fingerprint",
  sourceRefId: null,
  collectionId: null,
  status: "available",
  retrievedAt: now.toISOString(),
  sourcePublishedAt: null,
  expiresAt: "2026-10-13T02:00:00Z",
  retryAfter: null,
  appliesTo: { dates: [], regionRef: null, basis: "current_estimate" },
  quality: "complete",
  value: {
    kind: "route_estimate",
    distanceMeters: 1000,
    durationSeconds: 2580,
    mode: "driving",
    fromEntityId: "ea",
    toEntityId: "eb",
  },
  error: null,
  freshness: "fresh",
  unknownReason: null,
};
const hours = (raw: string, today: string | null = null): FactView => ({
  ...route,
  id: "hours",
  kind: "opening_hours",
  subjectKey: "ea",
  quality: "partial",
  value: {
    kind: "opening_hours",
    today,
    weekly: raw,
    timezone: "Asia/Shanghai",
    parseStatus: "pending",
  },
  appliesTo: {
    dates: today ? [date] : [],
    regionRef: null,
    basis: "described_hours",
  },
  unknownReason: "PARSE_PENDING",
});
const opening = (raw: string, start: number, duration: number) =>
  evaluate(
    { ...trip, activities: [{ ...trip.activities[0]!, start, duration }] },
    [hours(raw)],
    1,
    now,
  ).results.find((r) => r.rule === "OPENING_COVERAGE")!;
describe("营业原文解析", () => {
  it.each([
    "周一至周日 09:00-17:00",
    "星期一-星期日 09：00～17：00",
    "每天 09:00—17:00",
  ])("常见中文标点：%s", (raw) => {
    expect(parseHours(raw).quality).toBe("complete");
    expect(intervalsFor(parseHours(raw), date)).toEqual([
      { start: 540, end: 1020 },
    ]);
  });
  it("多区间并集和午间关闭", () => {
    expect(opening("10:30-14:30、17:00-21:30", 840, 60).state).toBe("CONFLICT");
    expect(opening("10:30-14:30、17:00-21:30", 780, 60).state).toBe("VALID");
  });
  it.each([
    [480, 60, "CONFLICT"],
    [600, 60, "VALID"],
    [990, 60, "CONFLICT"],
    [960, 60, "VALID"],
  ] as const)("开始/结束边界 %s", (start, duration, state) =>
    expect(opening("09:00-17:00", start, duration).state).toBe(state),
  );
  it("全天和闭馆", () => {
    expect(opening("全天开放", 0, 1440).state).toBe("VALID");
    expect(opening("闭馆", 600, 60).state).toBe("CONFLICT");
  });
  it("星期差异", () => {
    const p = parseHours("周一 09:00-12:00；周二 14:00-18:00；周三 闭馆");
    expect(p.quality).toBe("complete");
    expect(intervalsFor(p, date)).toEqual([{ start: 840, end: 1080 }]);
    expect(intervalsFor(p, "2026-10-14")).toEqual([]);
  });
  it("跨午夜前日尾部", () =>
    expect(
      intervalsFor(parseHours("周一 22:00-02:00；周二 10:00-18:00"), date),
    ).toEqual([
      { start: 0, end: 120 },
      { start: 600, end: 1080 },
    ]));
  it.each([
    "季节开放 09:00-17:00",
    "09:00-17:00 最晚入场16:00",
    "09:00-17:00 现场公告为准",
    "节假日另行通知 09:00-17:00",
  ])("不能忽略限制：%s", (raw) => {
    expect(parseHours(raw).quality).toBe("partial");
    expect(opening(raw, 600, 60).reasonCode).toBe("FACT_PARSE_INCOMPLETE");
  });
  it.each(["25:00-26:00", "09:99-17:00", "看现场", "00:00-00:00"])(
    "无效/歧义语法 %s",
    (raw) => expect(parseHours(raw).quality).toBe("failed"),
  );
  it("今日字段不用于别日，未描述星期为未知", () => {
    const result = evaluate(trip, [hours("", "09:00-17:00")], 1, now);
    expect(
      result.results.find((r) => r.rule === "OPENING_COVERAGE")?.state,
    ).toBe("VALID");
    const shifted = {
      ...trip,
      activities: [{ ...trip.activities[0]!, date: "2026-10-14" }],
    };
    expect(
      evaluate(shifted, [hours("", "09:00-17:00")], 1, now).results.find(
        (r) => r.rule === "OPENING_COVERAGE",
      )?.reasonCode,
    ).toBe("FACT_DATE_NOT_APPLICABLE");
    expect(opening("周一 09:00-17:00", 600, 60).reasonCode).toBe(
      "FACT_DATE_NOT_APPLICABLE",
    );
  });
  it("缺少年份日历不能猜普通营业，调休日期也保持未知", () => {
    for (const date of ["2027-10-13", "2026-10-10"]) {
      const shifted = {
        ...trip,
        activities: [{ ...trip.activities[0]!, date }],
      };
      expect(
        evaluate(
          shifted,
          [{ ...hours("09:00-17:00"), retrievedAt: "2026-10-07T01:00:00Z" }],
          1,
          new Date("2026-10-07T01:00:00Z"),
        ).results.find((r) => r.rule === "OPENING_COVERAGE")?.reasonCode,
      ).toBe("SPECIAL_DATE_UNVERIFIED");
    }
  });
  it("今日与周描述不一致", () =>
    expect(
      evaluate(
        trip,
        [hours("10:00-17:00", "09:00-17:00")],
        1,
        now,
      ).results.find((r) => r.rule === "OPENING_COVERAGE")?.reasonCode,
    ).toBe("HOURS_SOURCE_INCONSISTENT"));
  it("历史和指定特殊日期未知", () => {
    const past = {
      ...trip,
      activities: [{ ...trip.activities[0]!, date: "2026-10-12" }],
    };
    expect(
      evaluate(past, [hours("09:00-17:00")], 1, now).results.find(
        (r) => r.rule === "OPENING_COVERAGE",
      )?.reasonCode,
    ).toBe("HISTORICAL_HOURS_UNVERIFIED");
    expect(
      evaluate(trip, [hours("09:00-17:00")], 1, now, {
        ...DEFAULT_POLICY,
        specialDates: [date],
      }).results.find((r) => r.rule === "OPENING_COVERAGE")?.reasonCode,
    ).toBe("SPECIAL_DATE_UNVERIFIED");
  });
});
describe("营业分句边界", () => {
  it("中文逗号分隔星期安排", () =>
    expect(parseHours("周一闭馆，周二至周日 09:00-17:00").quality).toBe(
      "complete",
    ));
  it("矛盾闭馆描述不可判通过", () =>
    expect(opening("周二闭馆；周二 09:00-17:00", 600, 60).reasonCode).toBe(
      "FACT_PARSE_INCOMPLETE",
    ));
});
describe("跨午夜信息不足", () => {
  it("前日尾部不证明当天其余时间关闭", () => {
    expect(opening("周一 22:00-02:00", 180, 30).reasonCode).toBe(
      "FACT_DATE_NOT_APPLICABLE",
    );
    expect(opening("周一 22:00-02:00", 30, 30).state).toBe("VALID");
  });
  it("闭馆日与前日跨午夜尾部冲突时不猜测", () =>
    expect(opening("周一 22:00-02:00；周二闭馆", 30, 30).reasonCode).toBe(
      "HOURS_SOURCE_INCONSISTENT",
    ));
});
describe("今日跨午夜语义", () => {
  it("今日22点开放不证明前日夜间已开放", () => {
    const value = hours("22:00-02:00", "22:00-02:00");
    const early = {
      ...trip,
      activities: [{ ...trip.activities[0]!, start: 30, duration: 30 }],
    };
    expect(
      evaluate(early, [value], 1, now).results.find(
        (r) => r.rule === "OPENING_COVERAGE",
      )?.state,
    ).toBe("UNKNOWN");
    const late = {
      ...trip,
      activities: [{ ...trip.activities[0]!, start: 1350, duration: 30 }],
    };
    expect(
      evaluate(late, [value], 1, now).results.find(
        (r) => r.rule === "OPENING_COVERAGE",
      )?.state,
    ).toBe("VALID");
  });
});
describe("统一约束", () => {
  it("同一重叠活动对修改先后时间仍有稳定ID", () => {
    const make = (a: number, b: number) =>
      evaluate(
        {
          ...trip,
          activities: [
            { ...trip.activities[0]!, start: a },
            { ...trip.activities[1]!, start: b },
          ],
        },
        [],
        0,
        now,
      ).results.find((r) => r.reasonCode === "ACTIVITY_OVERLAP")!.id;
    expect(make(780, 810)).toBe(make(810, 780));
  });

  it("30分钟空档/43分钟路程不足13分钟", () => {
    const r = routeResult(
      trip.activities[0]!,
      trip.activities[1]!,
      "driving",
      route,
      +now,
    );
    expect(r.state).toBe("CONFLICT");
    expect(r.rule === "TRANSITION_GAP" && r.details.shortageMinutes).toBe(13);
  });
  it("45分钟足够，不增加默认缓冲", () =>
    expect(
      routeResult(
        trip.activities[0]!,
        { ...trip.activities[1]!, start: 885 },
        "driving",
        route,
        +now,
      ).state,
    ).toBe("VALID"));
  it.each(["stale", "failed", "missing", "mismatch"])(
    "%s不计算确定不足",
    (kind) => {
      const f = {
        ...route,
        ...(kind === "stale"
          ? { expiresAt: now.toISOString() }
          : kind === "failed"
            ? { status: "failed" as const }
            : kind === "missing"
              ? { status: "missing" as const }
              : { unknownReason: "FACT_INPUT_MISMATCH" }),
      };
      const r = routeResult(
        trip.activities[0]!,
        trip.activities[1]!,
        "driving",
        f,
        +now,
      );
      expect(r.state).toBe("UNKNOWN");
      expect(
        r.rule === "TRANSITION_GAP" && r.details.shortageMinutes,
      ).toBeNull();
    },
  );
  it("重叠和刚好相接", () => {
    expect(
      evaluate(
        {
          ...trip,
          activities: trip.activities.map((a) => ({ ...a, start: 780 })),
        },
        [],
        0,
        now,
      ).results.some((r) => r.reasonCode === "ACTIVITY_OVERLAP"),
    ).toBe(true);
    expect(
      evaluate(
        {
          ...trip,
          activities: [
            trip.activities[0]!,
            { ...trip.activities[1]!, start: 840 },
          ],
        },
        [],
        0,
        now,
      ).results.some((r) => r.reasonCode === "ACTIVITY_OVERLAP"),
    ).toBe(false);
  });
  it("跨日不连接，缺地点中间项不跳过", () => {
    const cross = {
      ...trip,
      activities: [
        trip.activities[0]!,
        { ...trip.activities[1]!, date: "2026-10-14" },
      ],
    };
    expect(
      evaluate(cross, [], 0, now).results.filter(
        (r) => r.rule === "TRANSITION_GAP",
      ),
    ).toHaveLength(0);
    const mid = {
      ...trip,
      activities: [
        trip.activities[0]!,
        { ...trip.activities[0]!, id: "mid", entityId: null, start: 850 },
        trip.activities[1]!,
      ],
    };
    expect(
      evaluate(mid, [route], 1, now)
        .results.filter((r) => r.rule === "TRANSITION_GAP")
        .map((r) => r.transitionId),
    ).toEqual(["a:mid", "mid:b"]);
  });
  it("行程/日/活动来自相同快照并含前后连接", () => {
    const full = evaluate(trip, [route, hours("全天")], 7, now);
    const activity = projectEvaluation(full, trip, { activityId: "b" });
    expect(activity.results).toEqual(
      full.results.filter((r) => r.activityIds.includes("b")),
    );
    expect(activity.results.some((r) => r.transitionId === "a:b")).toBe(true);
    expect(projectEvaluation(full, trip, { date }).results).toEqual(
      full.results.filter((r) => r.activityIds.length),
    );
    expect(evaluationSchema.safeParse(full).success).toBe(true);
  });
  it("互斥筛选及严格契约", () => {
    expect(
      intelligenceQuerySchema.safeParse({
        date,
        activityId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
    const result = evaluate(trip, [route], 7, now);
    expect(
      evaluationSchema.safeParse({
        ...result,
        results: [{ ...result.results[0], details: { anything: true } }],
      }).success,
    ).toBe(false);
  });
});
