import { weatherResult } from "./travel-weather";
import { DEFAULT_TRAVEL_MODE } from "./travel-contract";
import { SPECIAL_DATES, CALENDAR_YEARS } from "./travel-calendar";
import type {
  TravelTrip,
  TravelActivity,
  FactView,
  Interval,
  ParsedHours,
  ConstraintResult,
  ConstraintReason,
  Evaluation,
  ConstraintPolicy,
} from "@open-sunsama/types";
export const ENGINE_VERSION = "1.2.0";
export const DEFAULT_POLICY: ConstraintPolicy = {
  version: "1.0.0",
  specialDates: SPECIAL_DATES,
  calendarYears: CALENDAR_YEARS,
  tightTransitionMinutes: null,
  nearClosingMinutes: null,
};
const all = [0, 1, 2, 3, 4, 5, 6],
  names = "一二三四五六日";
export function mergeIntervals(input: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const r of [...input].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const last = result.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else result.push({ ...r });
  }
  return result;
}
export function parseHours(raw: string | null): ParsedHours {
  const result: ParsedHours = {
    raw: raw ?? "",
    quality: "failed",
    unrecognized: [],
    days: [],
  };
  if (!raw?.trim()) return result;
  const normalized = raw
    .normalize("NFKC")
    .replace(/星期|礼拜/g, "周")
    .replace(/周天/g, "周日")
    .replace(/：/g, ":")
    .replace(/[～~—–]/g, "-")
    .replace(/[；;]/g, ";")
    .replace(/(?<=[0-9馆园业息放闭])[,，](?=\s*周[一二三四五六日])/g, ";")
    .replace(/至|到/g, "-");
  for (const segment of normalized
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    let rest = segment,
      weekdays = [...all];
    const prefix = rest.match(
      /^(每天|每日|周[一二三四五六日](?:\s*-\s*周?[一二三四五六日])?(?:[、，,]\s*周?[一二三四五六日])*)\s*/,
    );
    if (prefix) {
      const selector = prefix[1]!;
      if (!/^每/.test(selector)) {
        weekdays = [];
        for (const piece of selector.split(/[、，,]/)) {
          const chars = piece.match(/[一二三四五六日]/g)!;
          const start = names.indexOf(chars[0]!);
          if (chars.length === 2) {
            for (let i = start; ; i = (i + 1) % 7) {
              weekdays.push(i);
              if (i === names.indexOf(chars[1]!)) break;
            }
          } else weekdays.push(start);
        }
      }
      rest = rest.slice(prefix[0].length).trim();
    }
    if (/^(全天|全天开放|全天营业|24小时|24小时营业)$/.test(rest)) {
      result.days.push({ weekdays, intervals: [{ start: 0, end: 1440 }] });
      continue;
    }
    if (/^(闭馆|闭园|停业|关闭|休息|不开放|暂停开放|暂停营业)$/.test(rest)) {
      result.days.push({ weekdays, intervals: [] });
      continue;
    }
    const intervals: Interval[] = [];
    let invalid = false;
    rest = rest.replace(
      /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g,
      (match, a, b, c, d) => {
        const start = Number(a) * 60 + Number(b),
          end = Number(c) * 60 + Number(d);
        if (
          Number(a) > 23 ||
          Number(c) > 24 ||
          Number(b) > 59 ||
          Number(d) > 59 ||
          (Number(c) === 24 && Number(d) !== 0) ||
          end === start
        ) {
          invalid = true;
          return match;
        }
        intervals.push({ start, end: end < start ? end + 1440 : end });
        return "";
      },
    );
    rest = rest.replace(/[\s、，,]/g, "");
    if (intervals.length)
      result.days.push({ weekdays, intervals: mergeIntervals(intervals) });
    if (rest || invalid || !intervals.length) result.unrecognized.push(segment);
  }
  for (const day of all) {
    const applicable = result.days.filter((d) => d.weekdays.includes(day));
    if (
      applicable.some((d) => !d.intervals.length) &&
      applicable.some((d) => d.intervals.length)
    ) {
      result.unrecognized.push("同一星期的闭馆与开放描述冲突");
      break;
    }
  }
  result.quality = result.days.length
    ? result.unrecognized.length
      ? "partial"
      : "complete"
    : "failed";
  return result;
}
const weekday = (date: string) =>
  (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
export function intervalsFor(parsed: ParsedHours, date: string): Interval[] {
  const current = weekday(date),
    previous = (current + 6) % 7;
  return mergeIntervals(
    parsed.days.flatMap((d) => [
      ...(d.weekdays.includes(current)
        ? d.intervals.map((r) => ({
            start: r.start,
            end: Math.min(1440, r.end),
          }))
        : []),
      ...(d.weekdays.includes(previous)
        ? d.intervals
            .filter((r) => r.end > 1440)
            .map((r) => ({ start: 0, end: r.end - 1440 }))
        : []),
    ]),
  );
}
function currentIntervals(parsed: ParsedHours, date: string) {
  return mergeIntervals(
    parsed.days
      .filter((d) => d.weekdays.includes(weekday(date)))
      .flatMap((d) =>
        d.intervals.map((r) => ({
          start: r.start,
          end: Math.min(1440, r.end),
        })),
      ),
  );
}
function uncovered(
  start: number,
  end: number,
  intervals: Interval[],
): Interval[] {
  const gaps: Interval[] = [];
  let cursor = start;
  for (const r of intervals) {
    if (r.end <= cursor) continue;
    if (r.start >= end) break;
    if (r.start > cursor)
      gaps.push({ start: cursor, end: Math.min(end, r.start) });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < end) gaps.push({ start: cursor, end });
  return gaps;
}
export function scheduled(trip: Pick<TravelTrip, "activities">) {
  return trip.activities
    .filter((a) => a.date && a.start !== null)
    .sort(
      (a, b) =>
        a.date!.localeCompare(b.date!) ||
        a.start! - b.start! ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
}
export function adjacent(trip: Pick<TravelTrip, "activities">) {
  const rows = scheduled(trip);
  return rows
    .slice(1)
    .flatMap((to, i) =>
      rows[i]!.date === to.date
        ? [{ id: `${rows[i]!.id}:${to.id}`, from: rows[i]!, to }]
        : [],
    );
}
function base(
  rule: ConstraintResult["rule"],
  ids: string[],
  entities: string[],
  transitionId: string | null = null,
) {
  return {
    id: `${rule}:${transitionId ?? ids.join(":")}`,
    state: "VALID" as const,
    severity: "info" as const,
    activityIds: ids,
    entityIds: entities,
    transitionId,
    reasonCode: "OK" as const,
    factRefs: [] as { id: string; version: number }[],
  };
}
function set(
  result: ConstraintResult,
  reason: ConstraintReason,
  state: "UNKNOWN" | "CONFLICT",
) {
  result.reasonCode = reason;
  result.state = state;
  result.severity = state === "CONFLICT" ? "error" : "info";
}
export function comparisonPairs(trip: Pick<TravelTrip, "activities">) {
  const rows = scheduled(trip),
    pairs: { from: TravelActivity; to: TravelActivity }[] = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const from = rows[i]!,
        to = rows[j]!;
      if (from.date !== to.date) break;
      pairs.push({ from, to });
    }
  return pairs;
}
export function overlapResults(
  trip: Pick<TravelTrip, "activities">,
): ConstraintResult[] {
  const results: ConstraintResult[] = [];
  for (const { from: a, to: b } of comparisonPairs(trip)) {
    const start = Math.max(a.start!, b.start!),
      end = Math.min(a.start! + a.duration, b.start! + b.duration);
    if (start >= end) continue;
    const r: ConstraintResult = {
      ...base("OVERLAP", [a.id, b.id], []),
      rule: "OVERLAP",
      details: {
        date: a.date,
        overlapStart: start,
        overlapEnd: end,
        overlapMinutes: end - start,
      },
    };
    r.id = `OVERLAP:${[a.id, b.id].sort().join(":")}`;
    set(r, "ACTIVITY_OVERLAP", "CONFLICT");
    results.push(r);
  }
  if (!results.length)
    results.push({
      ...base("OVERLAP", [], []),
      rule: "OVERLAP",
      details: {
        date: null,
        overlapStart: null,
        overlapEnd: null,
        overlapMinutes: 0,
      },
    });
  return results;
}
export function factProblem(
  f: FactView | undefined,
  now: number,
): ConstraintReason | null {
  if (!f) return "FACT_MISSING";
  if (f.unknownReason === "FACT_INPUT_MISMATCH") return "FACT_INPUT_MISMATCH";
  if (f.status === "failed") return "FACT_PROVIDER_FAILED";
  if (f.status !== "available" || !f.value) return "FACT_MISSING";
  if (f.freshness === "stale" || Date.parse(f.expiresAt) <= now)
    return "FACT_STALE";
  if (f.kind !== "opening_hours" && f.quality !== "complete")
    return "FACT_PARSE_INCOMPLETE";
  if (f.error?.code === "PLACE_CHANGED_CONFIRMATION_REQUIRED")
    return "FACT_INPUT_MISMATCH";
  return null;
}
export function routeResult(
  from: TravelActivity,
  to: TravelActivity,
  mode: "walking" | "driving",
  fact?: FactView,
  now = Date.now(),
): ConstraintResult {
  const id = `${from.id}:${to.id}`,
    r: ConstraintResult = {
      ...base(
        "TRANSITION_GAP",
        [from.id, to.id],
        [from.entityId, to.entityId].filter((s): s is string => !!s),
        id,
      ),
      rule: "TRANSITION_GAP",
      details: {
        date: from.date,
        mode,
        gapSeconds: (to.start! - (from.start! + from.duration)) * 60,
        durationSeconds: null,
        shortageMinutes: null,
      },
    };
  if (fact) r.factRefs = [{ id: fact.id, version: fact.version }];
  const problem =
    !from.entityId || !to.entityId
      ? "PLACE_UNCONFIRMED"
      : factProblem(fact, now);
  if (problem) {
    set(r, problem, "UNKNOWN");
    return r;
  }
  if (
    fact!.value?.kind !== "route_estimate" ||
    fact!.value.mode !== mode ||
    fact!.value.fromEntityId !== from.entityId ||
    fact!.value.toEntityId !== to.entityId
  ) {
    set(r, "FACT_INPUT_MISMATCH", "UNKNOWN");
    return r;
  }
  r.details.durationSeconds = fact!.value.durationSeconds;
  r.details.shortageMinutes = Math.max(
    0,
    Math.ceil((fact!.value.durationSeconds - r.details.gapSeconds!) / 60),
  );
  if (r.details.shortageMinutes > 0)
    set(r, "TRANSITION_TIME_SHORTAGE", "CONFLICT");
  return r;
}
export function evaluate(
  trip: TravelTrip,
  facts: FactView[],
  factsVersion: number,
  now = new Date(),
  policy = DEFAULT_POLICY,
  environments: Record<string, "indoor" | "outdoor" | "unspecified"> = {},
): Evaluation {
  const results = overlapResults(trip);
  for (const { id, from, to } of adjacent(trip))
    results.push(
      routeResult(
        from,
        to,
        trip.transitionModes?.[id] ?? DEFAULT_TRAVEL_MODE,
        facts.find((f) => f.kind === "route_estimate" && f.subjectKey === id),
        +now,
      ),
    );
  for (const a of trip.activities) {
    const f = facts.find(
        (f) => f.kind === "opening_hours" && f.subjectKey === a.entityId,
      ),
      r: ConstraintResult = {
        ...base("OPENING_COVERAGE", [a.id], a.entityId ? [a.entityId] : []),
        rule: "OPENING_COVERAGE",
        details: {
          date: a.date,
          activityStart: a.start,
          activityEnd: a.start === null ? null : a.start + a.duration,
          openIntervals: null,
          uncoveredIntervals: null,
          parseQuality: "failed",
          unrecognized: [],
        },
      };
    results.push(r);
    if (f) r.factRefs = [{ id: f.id, version: f.version }];
    const problem =
      !a.date || a.start === null
        ? "ACTIVITY_UNSCHEDULED"
        : !a.entityId
          ? "PLACE_UNCONFIRMED"
          : factProblem(f, +now);
    if (problem) {
      set(r, problem, "UNKNOWN");
      continue;
    }
    if (f!.value?.kind !== "opening_hours") {
      set(r, "FACT_INPUT_MISMATCH", "UNKNOWN");
      continue;
    }
    const v = f!.value,
      day = new Intl.DateTimeFormat("en-CA", {
        timeZone: trip.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(f!.retrievedAt));
    if (a.date! < day) {
      set(r, "HISTORICAL_HOURS_UNVERIFIED", "UNKNOWN");
      continue;
    }
    if (
      policy.specialDates.includes(a.date!) ||
      !policy.calendarYears.includes(Number(a.date!.slice(0, 4)))
    ) {
      set(r, "SPECIAL_DATE_UNVERIFIED", "UNKNOWN");
      continue;
    }
    const today = parseHours(v.today),
      weekly = parseHours(v.weekly),
      useToday = a.date === day && f!.appliesTo.dates.includes(a.date!);
    const parsed = useToday && v.today ? today : weekly;
    r.details.parseQuality = parsed.quality;
    r.details.unrecognized = parsed.unrecognized;
    if (parsed.quality !== "complete") {
      set(
        r,
        v.weekly || (useToday && v.today)
          ? "FACT_PARSE_INCOMPLETE"
          : "FACT_DATE_NOT_APPLICABLE",
        "UNKNOWN",
      );
      continue;
    }
    const intervals =
      useToday && v.today
        ? currentIntervals(parsed, a.date!)
        : intervalsFor(parsed, a.date!);
    if (
      useToday &&
      v.today &&
      parsed.days.some((d) =>
        d.intervals.some((r) => r.end > 1440 && a.start! < r.end - 1440),
      )
    ) {
      set(r, "FACT_DATE_NOT_APPLICABLE", "UNKNOWN");
      continue;
    }
    if (
      !useToday &&
      weekly.days.every(
        (d) =>
          !d.weekdays.includes(weekday(a.date!)) &&
          !(
            d.weekdays.includes((weekday(a.date!) + 6) % 7) &&
            d.intervals.some((r) => r.end > 1440)
          ),
      )
    ) {
      set(r, "FACT_DATE_NOT_APPLICABLE", "UNKNOWN");
      continue;
    }
    if (!useToday) {
      const current = weekday(a.date!);
      const statedDay = parsed.days.some((d) => d.weekdays.includes(current));
      const statedClosed = parsed.days.some(
        (d) => d.weekdays.includes(current) && !d.intervals.length,
      );
      const previousTail = parsed.days.some(
        (d) =>
          d.weekdays.includes((current + 6) % 7) &&
          d.intervals.some((x) => x.end > 1440),
      );
      if (statedClosed && previousTail) {
        set(r, "HOURS_SOURCE_INCONSISTENT", "UNKNOWN");
        continue;
      }
      if (
        !statedDay &&
        uncovered(a.start!, a.start! + a.duration, intervals).length
      ) {
        set(r, "FACT_DATE_NOT_APPLICABLE", "UNKNOWN");
        continue;
      }
    }
    if (useToday && v.today && v.weekly) {
      if (
        weekly.quality !== "complete" ||
        JSON.stringify(intervals) !==
          JSON.stringify(currentIntervals(weekly, a.date!))
      ) {
        set(
          r,
          weekly.quality !== "complete"
            ? "FACT_PARSE_INCOMPLETE"
            : "HOURS_SOURCE_INCONSISTENT",
          "UNKNOWN",
        );
        continue;
      }
    }
    r.details.openIntervals = intervals;
    r.details.uncoveredIntervals = uncovered(
      a.start!,
      a.start! + a.duration,
      intervals,
    );
    if (r.details.uncoveredIntervals.length)
      set(r, "OPENING_NOT_COVERED", "CONFLICT");
  }
  for (const a of trip.activities)
    results.push(
      weatherResult(
        a,
        environments[a.id] ?? "unspecified",
        facts,
        now,
        trip.timezone,
        trip.entities?.find((e) => e.id === a.entityId),
      ),
    );
  const expiry = facts
    .filter((f) => Date.parse(f.expiresAt) > +now)
    .map((f) => Date.parse(f.expiresAt));
  return {
    tripRevision: trip.revision,
    factsVersion,
    engineVersion: ENGINE_VERSION,
    policyVersion: policy.version,
    evaluatedAt: now.toISOString(),
    expiresAt: new Date(Math.min(+now + 60000, ...expiry)).toISOString(),
    results,
    counts: counts(results),
  };
}
export function counts(results: ConstraintResult[]): Evaluation["counts"] {
  const out = { VALID: 0, WARNING: 0, CONFLICT: 0, UNKNOWN: 0 };
  results.forEach((r) => out[r.state]++);
  return out;
}
export function projectEvaluation(
  value: Evaluation,
  trip: TravelTrip,
  filter: { date?: string; activityId?: string },
): Evaluation {
  const ids = new Set(
    filter.activityId
      ? [filter.activityId]
      : trip.activities.filter((a) => a.date === filter.date).map((a) => a.id),
  );
  const results =
    filter.date || filter.activityId
      ? value.results.filter((r) => r.activityIds.some((id) => ids.has(id)))
      : value.results;
  return { ...value, results, counts: counts(results) };
}
