import { travelNow } from "./clock.js";
import type {
  TravelTrip,
  TravelActivity,
  TravelOperation,
  TravelProposal,
} from "@open-sunsama/types";
import { TravelError } from "./domain.js";
export function calendar(trip: Pick<TravelTrip, "startDate" | "endDate">) {
  const rows: { date: string; weekday: string; day: number }[] = [];
  for (
    let time = Date.parse(trip.startDate + "T00:00:00Z");
    time <= Date.parse(trip.endDate + "T00:00:00Z");
    time += 86400000
  )
    rows.push({
      date: new Date(time).toISOString().slice(0, 10),
      weekday: "周" + "日一二三四五六"[new Date(time).getUTCDay()],
      day: rows.length + 1,
    });
  return rows;
}
function numeral(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const n: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    零: 0,
  };
  if (text.includes("十")) {
    const [a, b] = text.split("十");
    return (a ? n[a]! : 1) * 10 + (b ? n[b]! : 0);
  }
  return n[text] ?? NaN;
}
export function resolveDate(
  trip: TravelTrip,
  expression: string,
  now = travelNow(),
) {
  const days = calendar(trip);
  const text = expression.trim();
  let matches: typeof days;
  if (/^(今天|明天|后天|昨天)$/.test(text)) {
    const offset = { 今天: 0, 明天: 1, 后天: 2, 昨天: -1 }[text]!;
    const today = now.toLocaleDateString("en-CA", { timeZone: trip.timezone });
    const date = new Date(Date.parse(today + "T00:00:00Z") + offset * 86400000)
      .toISOString()
      .slice(0, 10);
    matches = days.filter((d) => d.date === date);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text))
    matches = days.filter((d) => d.date === text);
  else if (/^\d{1,2}月\d{1,2}[日号]?$/.test(text)) {
    const [month, day] = text.match(/\d+/g)!;
    matches = days.filter(
      (d) =>
        Number(d.date.slice(5, 7)) === Number(month) &&
        Number(d.date.slice(8)) === Number(day),
    );
  } else if (/^(周|星期|礼拜)[一二三四五六日天]$/.test(text))
    matches = days.filter(
      (d) => d.weekday === "周" + (text.at(-1) === "天" ? "日" : text.at(-1)),
    );
  else if (/^第[一二三四五六七八九十零两\d]+天$/.test(text))
    matches = days.filter((d) => d.day === numeral(text.slice(1, -1)));
  else matches = [];
  return { expression, matches, needsClarification: matches.length !== 1 };
}
export function dateIntent(trip: TravelTrip, message: string) {
  const pattern =
    /\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}[日号]?|(?:周|星期|礼拜)[一二三四五六日天]|第[一二三四五六七八九十零两\d]+天|今天|明天|后天|昨天/g;
  const refs = [...message.matchAll(pattern)].map((m) => {
    const left = message.slice(0, m.index).search(/[^，,；;。]*$/);
    const right = message.slice(m.index).search(/[，,；;。]/);
    return {
      ...resolveDate(trip, m[0]),
      clause: message.slice(left, right < 0 ? message.length : m.index + right),
    };
  });
  const dates = [...new Set(refs.flatMap((r) => r.matches.map((d) => d.date)))];
  const error = /(?:上|下|本|这)(?:一)?周/.test(message)
    ? "相对日期需要澄清，请使用具体ISO日期、星期或行程第几天。"
    : refs.some((r) => r.needsClarification)
      ? `日期表达需要澄清：${refs
          .filter((r) => r.needsClarification)
          .map((r) => r.expression)
          .join("、")}。当前行程：${calendar(trip)
          .map((d) => d.date + " " + d.weekday)
          .join("、")}`
      : refs.some((r) =>
            refs.some(
              (s) =>
                s.clause === r.clause &&
                s.matches[0]?.date !== r.matches[0]?.date,
            ),
          )
        ? "同一句中的日期与星期冲突，请确认具体日期及活动对应关系。"
        : undefined;
  return { refs, dates, error };
}
export function referencedActivities(trip: TravelTrip, message: string) {
  return trip.activities.filter((a) =>
    [
      a.title,
      a.title.split(/[·|]/)[0]!.trim(),
      a.title.match(/的([^·|]{2,})$/)?.[1] ?? "",
      a.place,
    ]
      .filter((name) => name.length >= 2 && name !== "地点待确认")
      .some((name) => message.includes(name)),
  );
}
export function summaryActivity(trip: TravelTrip, a: TravelActivity) {
  const e = trip.entities?.find((e) => e.id === a.entityId);
  return {
    id: a.id,
    title: a.title,
    date: a.date,
    start: a.start,
    duration: a.duration,
    locked: a.locked,
    position: a.position,
    place: a.place,
    entityId: a.entityId ?? null,
    city: e?.city ?? null,
  };
}
export function agentView(
  trip: TravelTrip,
  input: {
    view: string;
    date?: string;
    activityId?: string;
    query?: string;
    cursor?: number;
    limit?: number;
  },
) {
  const base = {
    view: input.view,
    tripId: trip.id,
    title: trip.title,
    revision: trip.revision,
    timezone: trip.timezone,
    currentDate: travelNow().toLocaleDateString("en-CA", {
      timeZone: trip.timezone,
    }),
    dates: calendar(trip),
    activityCount: trip.activities.length,
    cities: [
      ...new Set(
        (trip.entities ?? [])
          .filter((e) => trip.activities.some((a) => a.entityId === e.id))
          .map((e) => e.city),
      ),
    ],
  };
  let activities =
    input.view === "day"
      ? trip.activities.filter((a) => a.date === input.date)
      : input.view === "activity"
        ? trip.activities.filter((a) => a.id === input.activityId)
        : input.query
          ? referencedActivities(trip, input.query)
          : [];
  const total = activities.length,
    cursor = input.cursor ?? 0,
    limit = input.limit ?? 20;
  activities = activities
    .sort(
      (a, b) =>
        (a.start ?? Infinity) - (b.start ?? Infinity) ||
        a.position - b.position,
    )
    .slice(cursor, cursor + limit);
  return {
    ...base,
    activities: activities.map((a) =>
      input.view === "activity"
        ? {
            ...summaryActivity(trip, a),
            notes: a.notes,
            entity: (() => {
              const e = trip.entities?.find((e) => e.id === a.entityId);
              if (!e) return null;
              const { selectionProof: _proof, ...detail } = e;
              return detail;
            })(),
          }
        : summaryActivity(trip, a),
    ),
    total,
    nextCursor: cursor + limit < total ? cursor + limit : null,
  };
}
export function constrainDates(
  trip: TravelTrip,
  message: string,
  operations: TravelOperation[],
) {
  const intent = dateIntent(trip, message);
  if (intent.error) throw new TravelError(intent.error);
  const constraints: {
    activityId: string;
    date: string;
    expression: string;
  }[] = [];
  for (const op of operations) {
    if (
      op.type !== "add" &&
      !(
        op.type === "edit" &&
        ("start" in op.patch || "date" in op.patch || "duration" in op.patch)
      )
    )
      continue;
    const activity =
      op.type === "add"
        ? op.activity
        : trip.activities.find((a) => a.id === op.id);
    if (!activity) throw new TravelError("活动不存在", 404);
    const actual =
      op.type === "add"
        ? op.activity.date
        : op.patch.date === undefined
          ? activity.date
          : op.patch.date;
    let expected = intent.dates.length === 1 ? intent.dates[0] : undefined;
    if (intent.dates.length > 1) {
      const dates = [
        ...new Set(
          intent.refs
            .filter(
              (r) =>
                referencedActivities(
                  { ...trip, activities: [activity] },
                  r.clause,
                ).length,
            )
            .map((r) => r.matches[0]!.date),
        ),
      ];
      if (dates.length !== 1)
        throw new TravelError(`请明确「${activity.title}」对应哪一天`);
      expected = dates[0];
    }
    if (expected && actual !== expected)
      throw new TravelError(
        `日期不一致：「${activity.title}」应为${expected}，不是${actual}。请重新读取日期表再提案。`,
      );
    if (
      !intent.dates.length &&
      op.type === "edit" &&
      "date" in op.patch &&
      actual !== activity.date
    )
      throw new TravelError("没有明确改日期的要求，请先澄清");
    if (expected)
      constraints.push({
        activityId: activity.id,
        date: expected,
        expression: expected,
      });
  }
  return constraints;
}
export function assertDateConstraints(
  trip: TravelTrip,
  constraints: { activityId: string; date: string; expression?: string }[] = [],
) {
  for (const c of constraints) {
    const parsed = c.expression ? dateIntent(trip, c.expression) : undefined;
    if (
      parsed &&
      (parsed.error || parsed.dates.length !== 1 || parsed.dates[0] !== c.date)
    )
      throw new TravelError("日期表达与约束不一致");
    if (trip.activities.find((a) => a.id === c.activityId)?.date !== c.date)
      throw new TravelError(`日期约束不一致：应为${c.date}`);
  }
}
export function proposalReceipt(p: TravelProposal) {
  return {
    id: p.id,
    tripId: p.tripId,
    revision: p.revision,
    status: p.status,
    reason: p.reason,
    evaluation: p.evaluation
      ? {
          tripRevision: p.evaluation.tripRevision,
          factsVersion: p.evaluation.factsVersion,
          counts: p.evaluation.counts,
          conflicts: p.evaluation.results.filter(
            (r) => r.state === "CONFLICT" || r.state === "WARNING",
          ),
        }
      : undefined,
    changes: p.operations.map((op) =>
      op.type === "add"
        ? { type: op.type, activity: summaryActivity(p.after, op.activity) }
        : "id" in op
          ? {
              type: op.type,
              before: p.before.activities.find((a) => a.id === op.id)
                ? summaryActivity(
                    p.before,
                    p.before.activities.find((a) => a.id === op.id)!,
                  )
                : null,
              after: p.after.activities.find((a) => a.id === op.id)
                ? summaryActivity(
                    p.after,
                    p.after.activities.find((a) => a.id === op.id)!,
                  )
                : null,
            }
          : op.type === "return_to_pending"
            ? {
                type: op.type,
                activities: op.ids
                  .map((id) => p.after.activities.find((a) => a.id === id))
                  .filter((a): a is TravelActivity => !!a)
                  .map((a) => ({
                    ...summaryActivity(p.after, a),
                    backlogOriginDate: a.backlogOriginDate,
                  })),
              }
            : op,
    ),
  };
}
