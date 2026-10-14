import { weatherLocation } from "./travel-weather-location";
import {
  dayPresentation,
  intelligenceDaySchema,
} from "./travel-day-presentation";
import { z } from "zod";
import type {
  TravelTrip,
  FactView,
  KernelSource,
  TravelEnvironment,
  IntelligenceSnapshot,
  InspectionTrace,
  InspectionInput,
  IntelligenceRoot,
  ConstraintReason,
  ConstraintResult,
} from "@open-sunsama/types";
import {
  evaluate,
  projectEvaluation,
  comparisonPairs,
  factProblem,
  parseHours,
} from "./travel-intelligence";
import { weatherResult, forecastWindow } from "./travel-weather";
import {
  evaluationSchema,
  operationalFactSchema,
  constraintReasonSchema,
} from "./travel-kernel-contract";
const rule = z.enum([
  "OVERLAP",
  "TRANSITION_GAP",
  "OPENING_COVERAGE",
  "WEATHER_EXPOSURE",
]);
const ref = z
  .object({ id: z.string(), version: z.number().int().nonnegative() })
  .strict();
const inputSchema = z
  .object({
    key: z.string(),
    dependency: z.string(),
    status: z.enum([
      "PROVIDED",
      "NOT_QUERIED",
      "NOT_PROVIDED",
      "FAILED",
      "STALE",
      "MISMATCH",
      "UNSUPPORTED",
      "WAITING_PREREQUISITE",
    ]),
    reason: constraintReasonSchema.nullable(),
    factRefs: z.array(ref),
    hoursParsing: z
      .array(
        z
          .object({
            basis: z.enum(["today", "weekly"]),
            parsed: z
              .object({
                quality: z.enum(["complete", "partial", "failed"]),
                raw: z.string(),
                unrecognized: z.array(z.string()),
                days: z.array(
                  z
                    .object({
                      weekdays: z.array(z.number().int().min(0).max(6)),
                      intervals: z.array(
                        z
                          .object({ start: z.number(), end: z.number() })
                          .strict(),
                      ),
                    })
                    .strict(),
                ),
              })
              .strict(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const intelligenceSnapshotSchema = z
  .object({
    projectionVersion: z.enum(["1.0.0", "1.1.0", "1.2.0", "1.3.0"]),
    days: z.array(intelligenceDaySchema).optional(),
    connections: z
      .array(
        z
          .object({
            id: z.string(),
            fromId: z.string(),
            toId: z.string(),
            date: z.string().nullable(),
            mode: z.enum(["walking", "driving"]),
            state: z.enum(["VALID", "WARNING", "CONFLICT", "UNKNOWN"]),
            reasonCode: constraintReasonSchema,
            gapSeconds: z.number().nullable(),
            durationSeconds: z.number().nullable(),
            distanceMeters: z.number().nullable(),
            shortageMinutes: z.number().nullable(),
            factRefs: z.array(ref),
          })
          .strict(),
      )
      .optional(),
    mode: z.enum(["LIVE", "DEMO"]),
    evaluatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    evaluation: evaluationSchema,
    capabilities: z.array(
      z
        .object({
          rule,
          status: z.literal("READY"),
          requiredInputs: z.array(z.string()),
          objects: z.number().int().nonnegative(),
          evaluated: z.number().int().nonnegative(),
          needsData: z.number().int().nonnegative(),
          notApplicable: z.number().int().nonnegative(),
          deferred: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    activities: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          date: z.string().nullable(),
          start: z.number().nullable(),
          duration: z.number(),
          locked: z.boolean(),
          entityId: z.string().nullable(),
          environment: z.enum(["indoor", "outdoor", "unspecified"]),
          markers: z.array(z.string()),
        })
        .strict(),
    ),
    traces: z.array(
      z
        .object({
          id: z.string(),
          rule,
          date: z.string().nullable(),
          activityIds: z.array(z.string()),
          applicability: z.enum([
            "APPLICABLE",
            "NOT_APPLICABLE",
            "DEFERRED",
            "UNDETERMINED",
          ]),
          state: z.enum(["VALID", "WARNING", "CONFLICT", "UNKNOWN"]).nullable(),
          resultIds: z.array(z.string()),
          inputs: z.array(inputSchema),
        })
        .strict(),
    ),
    roots: z.array(
      z
        .object({
          id: z.string(),
          reason: constraintReasonSchema,
          dependency: z.string(),
          category: z.enum([
            "ACTION_REQUIRED",
            "WAITING_EXTERNAL",
            "INFORMATIONAL",
          ]),
          action: z.enum([
            "EDIT_PLAN",
            "BIND_PLACE",
            "SET_ENVIRONMENT",
            "QUERY_FACTS",
            "REFRESH_FACTS",
            "WAIT",
            "VIEW_SOURCE",
            "NONE",
          ]),
          activityIds: z.array(z.string()),
          resultIds: z.array(z.string()),
          traceIds: z.array(z.string()),
        })
        .strict(),
    ),
    facts: z.array(
      operationalFactSchema.extend({
        freshness: z.enum(["fresh", "stale", "unknown"]),
        unknownReason: z.string().nullable(),
      }),
    ),
    sources: z.array(
      z
        .object({
          id: z.string(),
          providerId: z.string(),
          externalId: z.string(),
          kind: z.enum(["place", "region", "route", "weather"]),
          displayName: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export function diagnoseFact(
  key: string,
  dependency: string,
  f: FactView | undefined,
  now: number,
): InspectionInput {
  const reason = factProblem(f, now);
  let status: InspectionInput["status"] = "PROVIDED";
  if (!f) status = "NOT_QUERIED";
  else if (reason === "FACT_INPUT_MISMATCH") status = "MISMATCH";
  else if (f.status === "failed") status = "FAILED";
  else if (f.status === "missing" || !f.value) status = "NOT_PROVIDED";
  else if (reason === "FACT_STALE") status = "STALE";
  else if (reason === "FACT_PARSE_INCOMPLETE") status = "UNSUPPORTED";
  const hoursParsing =
    f?.value?.kind === "opening_hours"
      ? (["today", "weekly"] as const).flatMap((basis) => {
          const raw = f.value?.kind === "opening_hours" ? f.value[basis] : null;
          return raw ? [{ basis, parsed: parseHours(raw) }] : [];
        })
      : undefined;
  return {
    key,
    dependency,
    status,
    reason,
    ...(hoursParsing ? { hoursParsing } : {}),
    factRefs: f ? [{ id: f.id, version: f.version }] : [],
  };
}
const requirements: Record<ConstraintResult["rule"], string[]> = {
  OVERLAP: ["日期", "开始时间", "时长"],
  TRANSITION_GAP: ["两端确认地点", "路线估计", "相邻安排"],
  OPENING_COVERAGE: ["确认地点", "营业原文", "适用日期"],
  WEATHER_EXPOSURE: ["室内／户外", "确认地点与区域", "对应日期预报"],
};
export function buildIntelligenceSnapshot(
  trip: TravelTrip,
  facts: FactView[],
  sources: KernelSource[],
  factsVersion: number,
  environments: Record<string, TravelEnvironment> = {},
  now = new Date(),
  filter: { date?: string; activityId?: string } = {},
  mode: "LIVE" | "DEMO" = "LIVE",
): IntelligenceSnapshot {
  const full = evaluate(
      trip,
      facts,
      factsVersion,
      now,
      undefined,
      environments,
    ),
    evaluation = projectEvaluation(full, trip, filter);
  const selected = new Set(
    trip.activities
      .filter((a) =>
        filter.activityId
          ? a.id === filter.activityId
          : filter.date
            ? a.date === filter.date
            : true,
      )
      .map((a) => a.id),
  );
  const traces: InspectionTrace[] = [];
  const provided = (key: string, dependency: string): InspectionInput => ({
    key,
    dependency,
    status: "PROVIDED",
    reason: null,
    factRefs: [],
  });
  const blocked = (
    key: string,
    dependency: string,
    reason: ConstraintReason | null,
  ): InspectionInput => ({
    key,
    dependency,
    status: "WAITING_PREREQUISITE",
    reason,
    factRefs: [],
  });
  const bound = (id: string) => {
    const a = trip.activities.find((a) => a.id === id)!;
    return a.entityId
      ? provided("place", id)
      : {
          ...blocked("place", id, "PLACE_UNCONFIRMED"),
          status: "NOT_PROVIDED" as const,
        };
  };
  for (const { from: a, to: b } of comparisonPairs(trip)) {
    const r = full.results.find(
      (r) =>
        r.rule === "OVERLAP" &&
        r.activityIds.includes(a.id) &&
        r.activityIds.includes(b.id),
    );
    traces.push({
      id: "pair:" + a.id + ":" + b.id,
      rule: "OVERLAP",
      date: a.date,
      activityIds: [a.id, b.id],
      applicability: "APPLICABLE",
      state: r?.state ?? "VALID",
      resultIds: r ? [r.id] : [],
      inputs: [provided("plan", a.id), provided("plan", b.id)],
    });
  }
  for (const r of full.results.filter((r) => r.rule !== "OVERLAP")) {
    const a = trip.activities.find((a) => a.id === r.activityIds[0])!;
    let applicability: InspectionTrace["applicability"] = "APPLICABLE";
    if (a.start === null || !a.date) applicability = "DEFERRED";
    else if (r.rule === "WEATHER_EXPOSURE" && environments[a.id] === "indoor")
      applicability = "NOT_APPLICABLE";
    else if (
      r.rule === "WEATHER_EXPOSURE" &&
      (!environments[a.id] || environments[a.id] === "unspecified")
    )
      applicability = "UNDETERMINED";
    const inputs: InspectionInput[] = [provided("plan", a.id)];
    if (applicability === "DEFERRED")
      inputs[0] = blocked("plan", a.id, "ACTIVITY_UNSCHEDULED");
    if (applicability !== "NOT_APPLICABLE" && applicability !== "DEFERRED") {
      if (r.rule === "TRANSITION_GAP") {
        inputs.push(...r.activityIds.map(bound));
        const allBound = r.activityIds.every(
          (id) => trip.activities.find((a) => a.id === id)?.entityId,
        );
        inputs.push(
          allBound
            ? diagnoseFact(
                "route",
                r.transitionId!,
                facts.find(
                  (f) =>
                    f.kind === "route_estimate" &&
                    f.subjectKey === r.transitionId,
                ),
                +now,
              )
            : blocked("route", r.transitionId!, null),
        );
      } else {
        inputs.push(bound(a.id));
        if (r.rule === "OPENING_COVERAGE")
          inputs.push(
            a.entityId
              ? diagnoseFact(
                  "hours",
                  a.entityId,
                  facts.find(
                    (f) =>
                      f.kind === "opening_hours" && f.subjectKey === a.entityId,
                  ),
                  +now,
                )
              : blocked("hours", a.id, null),
          );
        else {
          inputs.push(
            environments[a.id] && environments[a.id] !== "unspecified"
              ? provided("environment", a.id)
              : {
                  ...blocked("environment", a.id, "ENVIRONMENT_UNSPECIFIED"),
                  status: "NOT_PROVIDED",
                },
          );
          const entity = trip.entities?.find((e) => e.id === a.entityId);
          const region = entity ? weatherLocation(entity).key : null;
          inputs.push(
            entity
              ? provided("region", entity.id)
              : blocked("region", a.id, null),
          );
          const window = forecastWindow(now, trip.timezone);
          const beyondWindow =
            !!a.date && (a.date < window.start || a.date > window.end);
          if (beyondWindow)
            inputs.push({
              key: "weather-date",
              dependency: a.date!,
              status: "WAITING_PREREQUISITE",
              reason: "WEATHER_OUT_OF_RANGE",
              factRefs: [],
            });
          const conditional = weatherResult(
            a,
            "outdoor",
            facts,
            now,
            trip.timezone,
            trip.entities?.find((e) => e.id === a.entityId),
          );
          if (
            !beyondWindow &&
            conditional.state === "UNKNOWN" &&
            conditional.reasonCode !== r.reasonCode &&
            ![
              "PLACE_UNCONFIRMED",
              "WEATHER_REGION_UNRESOLVED",
              "FACT_STALE",
              "FACT_MISSING",
              "FACT_PROVIDER_FAILED",
              "FACT_INPUT_MISMATCH",
            ].includes(conditional.reasonCode)
          )
            inputs.push({
              key: "weather-date",
              dependency: a.date!,
              status: "WAITING_PREREQUISITE",
              reason: conditional.reasonCode,
              factRefs: conditional.factRefs,
            });
          inputs.push(
            region &&
              !beyondWindow &&
              conditional.reasonCode !== "WEATHER_OUT_OF_RANGE" &&
              !!entity
              ? diagnoseFact(
                  "weather",
                  region,
                  facts.find(
                    (f) =>
                      f.kind === "weather" &&
                      f.subjectKey === region + ":daily_forecast",
                  ),
                  +now,
                )
              : blocked("weather", a.id, null),
          );
        }
      }
      if (
        r.state === "UNKNOWN" &&
        !inputs.some((x) => x.reason === r.reasonCode)
      )
        inputs.push({
          key: "applicability",
          dependency:
            r.rule === "WEATHER_EXPOSURE"
              ? (r.details.date ?? a.id)
              : (a.entityId ?? a.id),
          status:
            r.reasonCode === "WEATHER_OUT_OF_RANGE"
              ? "WAITING_PREREQUISITE"
              : "UNSUPPORTED",
          reason: r.reasonCode,
          factRefs: r.factRefs,
        });
    }
    for (const sourceInput of [...inputs])
      for (const h of sourceInput.hoursParsing ?? [])
        if (h.parsed.quality !== "complete")
          inputs.push({
            key: "hours-parse",
            dependency: sourceInput.dependency + ":" + h.basis,
            status: "UNSUPPORTED",
            reason: "FACT_PARSE_INCOMPLETE",
            factRefs: sourceInput.factRefs,
            hoursParsing: [h],
          });
    traces.push({
      id: r.id,
      rule: r.rule,
      date: a.date,
      activityIds: r.activityIds,
      applicability,
      state:
        applicability === "NOT_APPLICABLE" || applicability === "DEFERRED"
          ? null
          : r.state,
      resultIds: [r.id],
      inputs,
    });
  }
  const filtered = traces.filter((t) =>
    t.activityIds.some((id) => selected.has(id)),
  );
  const roots = new Map<string, IntelligenceRoot>();
  const add = (
    t: InspectionTrace,
    reason: ConstraintReason,
    dependency: string,
    input?: InspectionInput,
  ) => {
    const result = full.results.find((r) => t.resultIds.includes(r.id));
    let category: IntelligenceRoot["category"] = "ACTION_REQUIRED",
      action: IntelligenceRoot["action"] = "VIEW_SOURCE";
    if (reason === "PLACE_UNCONFIRMED") action = "BIND_PLACE";
    else if (reason === "ENVIRONMENT_UNSPECIFIED") action = "SET_ENVIRONMENT";
    else if (reason === "FACT_STALE" || reason === "FACT_INPUT_MISMATCH")
      action = "REFRESH_FACTS";
    else if (reason === "FACT_MISSING") {
      action = input?.status === "NOT_QUERIED" ? "QUERY_FACTS" : "VIEW_SOURCE";
      if (input?.status !== "NOT_QUERIED") category = "INFORMATIONAL";
    } else if (reason === "WEATHER_OUT_OF_RANGE") {
      category =
        dependency.split(":").at(-1)! > forecastWindow(now, trip.timezone).end
          ? "WAITING_EXTERNAL"
          : "INFORMATIONAL";
      action = category === "INFORMATIONAL" ? "VIEW_SOURCE" : "WAIT";
    } else if (reason === "ACTIVITY_UNSCHEDULED" || reason === "OK") {
      category = "INFORMATIONAL";
      action = "NONE";
    } else if (reason === "FACT_PROVIDER_FAILED") {
      const f = facts.find((f) =>
        input?.factRefs.some((ref) => ref.id === f.id),
      );
      if (
        f?.error?.retryable &&
        f.retryAfter &&
        Date.parse(f.retryAfter) > +now
      ) {
        category = "WAITING_EXTERNAL";
        action = "WAIT";
      } else if (f?.error?.retryable) action = "REFRESH_FACTS";
      else category = "INFORMATIONAL";
    } else if (result?.state === "CONFLICT" || result?.state === "WARNING")
      action = "EDIT_PLAN";
    else category = "INFORMATIONAL";
    const key = reason + ":" + dependency;
    const root = roots.get(key) ?? {
      id: key,
      reason,
      dependency,
      category,
      action,
      activityIds: [],
      resultIds: [],
      traceIds: [],
    };
    root.activityIds = [
      ...new Set([
        ...root.activityIds,
        ...(reason === "PLACE_UNCONFIRMED" ||
        reason === "ENVIRONMENT_UNSPECIFIED"
          ? [dependency]
          : t.activityIds),
      ]),
    ];
    root.resultIds = [...new Set([...root.resultIds, ...t.resultIds])];
    root.traceIds = [...new Set([...root.traceIds, t.id])];
    roots.set(key, root);
  };
  for (const t of filtered) {
    if (t.applicability === "DEFERRED") {
      add(t, "ACTIVITY_UNSCHEDULED", t.activityIds[0]!);
      continue;
    }
    if (t.applicability === "NOT_APPLICABLE") {
      add(t, "OK", t.activityIds[0]!);
      continue;
    }
    const r = full.results.find((r) => t.resultIds.includes(r.id));
    if (r && (r.state === "CONFLICT" || r.state === "WARNING"))
      add(t, r.reasonCode, t.id);
    for (const input of t.inputs)
      if (input.reason && input.status !== "PROVIDED")
        add(
          t,
          input.reason,
          input.key === "place" || input.key === "environment"
            ? input.dependency
            : input.key + ":" + input.dependency,
          input,
        );
  }
  const capabilities = (
    Object.keys(requirements) as ConstraintResult["rule"][]
  ).map((rule) => {
    const ts = filtered.filter((t) => t.rule === rule);
    return {
      rule,
      status: "READY" as const,
      requiredInputs: requirements[rule],
      objects: ts.filter((t) => t.applicability !== "DEFERRED").length,
      evaluated: ts.filter(
        (t) =>
          t.applicability === "APPLICABLE" &&
          t.state !== null &&
          t.state !== "UNKNOWN",
      ).length,
      needsData: ts.filter((t) => t.state === "UNKNOWN").length,
      notApplicable: ts.filter((t) => t.applicability === "NOT_APPLICABLE")
        .length,
      deferred: ts.filter((t) => t.applicability === "DEFERRED").length,
    };
  });
  const related = new Set(filtered.flatMap((t) => t.activityIds));
  const snapshot: IntelligenceSnapshot = {
    projectionVersion: "1.3.0",
    days: dayPresentation(trip, facts, [...roots.values()], now, filter),
    mode,
    evaluatedAt: full.evaluatedAt,
    expiresAt: full.expiresAt,
    evaluation,
    capabilities,
    connections: evaluation.results
      .filter((r) => r.rule === "TRANSITION_GAP")
      .map((r) => {
        const f = facts.find((f) =>
          r.factRefs.some(
            (ref) => ref.id === f.id && ref.version === f.version,
          ),
        );
        return {
          id: r.transitionId!,
          fromId: r.activityIds[0]!,
          toId: r.activityIds[1]!,
          date: r.details.date,
          mode: r.details.mode,
          state: r.state,
          reasonCode: r.reasonCode,
          gapSeconds: r.details.gapSeconds,
          durationSeconds: r.details.durationSeconds,
          shortageMinutes: r.details.shortageMinutes,
          distanceMeters:
            r.details.durationSeconds !== null &&
            f?.value?.kind === "route_estimate"
              ? f.value.distanceMeters
              : null,
          factRefs: r.factRefs,
        };
      }),
    activities: trip.activities
      .filter((a) => related.has(a.id) || selected.has(a.id))
      .map((a) => ({
        ...{
          id: a.id,
          title: a.title,
          date: a.date,
          start: a.start,
          duration: a.duration,
          locked: a.locked,
          entityId: a.entityId ?? null,
          environment: environments[a.id] ?? "unspecified",
        },
        markers: evaluation.results
          .filter(
            (r) =>
              r.activityIds.includes(a.id) &&
              (r.state === "CONFLICT" || r.state === "WARNING"),
          )
          .map((r) =>
            r.rule === "WEATHER_EXPOSURE"
              ? "天气提醒"
              : r.rule === "TRANSITION_GAP"
                ? "路程冲突"
                : r.rule === "OPENING_COVERAGE"
                  ? "营业冲突"
                  : "时间重叠",
          ),
      })),
    traces: filtered,
    roots: [...roots.values()],
    facts,
    sources,
  };
  intelligenceSnapshotSchema.parse(snapshot);
  return snapshot;
}
