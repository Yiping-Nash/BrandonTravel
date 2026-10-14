import { weatherLocation } from "@open-sunsama/utils/travel-weather-location";
import { randomUUID } from "node:crypto";
import {
  evaluate,
  projectEvaluation,
  scheduled,
} from "@open-sunsama/utils/travel-intelligence";
import { intelligenceQuerySchema } from "@open-sunsama/utils/travel-kernel-contract";
import type { FactView, TravelTrip, Evaluation } from "@open-sunsama/types";
import { applyOperations, mutationSchema, TravelError } from "../domain.js";
import { summaryActivity } from "../agent-state.js";
import { travelNow } from "../clock.js";
import {
  operationalSnapshot,
  tasks,
  type CapabilityContext,
} from "./service.js";
/** Match stored facts against candidate inputs, never promote stale/failed facts. */
export function candidateFacts(
  trip: TravelTrip,
  facts: FactView[],
): FactView[] {
  const inputs = tasks(
    trip,
    {
      requestId: randomUUID(),
      kinds: ["place", "opening_hours", "route_estimate", "weather"],
      force: false,
    },
    facts,
  );
  return inputs.flatMap((t) => {
    const f = facts.find(
      (f) =>
        f.kind === t.kind &&
        f.inputFingerprint === t.fingerprint &&
        (t.kind !== "route_estimate"
          ? f.subjectKey === t.subjectKey
          : f.value?.kind === "route_estimate" &&
            f.value.fromEntityId === t.from?.id &&
            f.value.toEntityId === t.to?.id &&
            f.value.mode === t.mode),
    );
    if (!f) return [];
    return [
      {
        ...f,
        subjectKey: t.subjectKey,
        freshness:
          f.status === "available"
            ? Date.parse(f.expiresAt) > +travelNow()
              ? "fresh"
              : "stale"
            : "unknown",
        unknownReason:
          f.unknownReason === "FACT_INPUT_MISMATCH" ? null : f.unknownReason,
      } as FactView,
    ];
  });
}
export function dayPressure(trip: TravelTrip, date: string) {
  const rows = scheduled(trip).filter((a) => a.date === date);
  return {
    date,
    scheduledCount: rows.length,
    occupiedMinutes: rows.reduce((n, a) => n + a.duration, 0),
    spanMinutes: rows.length
      ? rows.at(-1)!.start! + rows.at(-1)!.duration - rows[0]!.start!
      : 0,
    gaps: rows.slice(1).map((to, i) => ({
      fromId: rows[i]!.id,
      toId: to.id,
      gapMinutes: to.start! - rows[i]!.start! - rows[i]!.duration,
    })),
  };
}

/** Bounded advisory candidates; the shared engine verifies every slot, never mutates. */
export function insertionOptions(
  trip: TravelTrip,
  facts: FactView[],
  factsVersion: number,
  date: string,
  environments: Record<string, "indoor" | "outdoor" | "unspecified">,
) {
  return trip.activities
    .filter((a) => a.start === null && (!a.date || a.date === date))
    .slice(0, 5)
    .map((activity) => {
      const slots: {
        start: number;
        end: number;
        factRefs: { id: string; version: number }[];
      }[] = [];
      for (let start = 0; start + activity.duration <= 1440; start += 15) {
        const after = {
          ...trip,
          activities: trip.activities.map((a) =>
            a.id === activity.id ? { ...a, date, start } : a,
          ),
        };
        const evaluation = evaluate(
          after,
          candidateFacts(after, facts),
          factsVersion,
          travelNow(),
          undefined,
          environments,
        );
        const relevant = evaluation.results.filter(
          (r) =>
            r.activityIds.includes(activity.id) &&
            ["OVERLAP", "OPENING_COVERAGE", "TRANSITION_GAP"].includes(r.rule),
        );
        if (relevant.length && relevant.every((r) => r.state === "VALID"))
          slots.push({
            start,
            end: start + activity.duration,
            factRefs: relevant.flatMap((r) => r.factRefs),
          });
      }
      return {
        activityId: activity.id,
        duration: activity.duration,
        date,
        gridMinutes: 15,
        slots: slots.slice(0, 3),
        hasMore: slots.length > 3,
        scope: "当前资料下的15分钟网格候选，不代表所有解；不采集新路程",
      };
    });
}

export async function planningContext(
  ctx: CapabilityContext,
  id: string,
  raw: unknown = {},
) {
  const filter = intelligenceQuerySchema.parse(raw),
    s = await operationalSnapshot(ctx, id);
  if (
    filter.activityId &&
    !s.trip.activities.some((a) => a.id === filter.activityId)
  )
    throw new TravelError("活动不存在", 404);
  const full = evaluate(
    s.trip,
    s.facts,
    s.factsVersion,
    travelNow(),
    undefined,
    s.environments,
  );
  const evaluation = projectEvaluation(full, s.trip, filter);
  const related = new Set(evaluation.results.flatMap((r) => r.activityIds));
  const activities = s.trip.activities.filter((a) =>
    filter.activityId
      ? related.has(a.id) || a.id === filter.activityId
      : !filter.date || a.date === filter.date,
  );
  const entities = new Set(activities.map((a) => a.entityId));
  const refs = new Set(
    evaluation.results.flatMap((r) => r.factRefs.map((f) => f.id)),
  );
  const regions = new Set(
    (s.trip.entities ?? [])
      .filter((e) => entities.has(e.id))
      .map((e) => weatherLocation(e).key),
  );
  const facts = s.facts.filter(
    (f) =>
      refs.has(f.id) ||
      entities.has(f.subjectKey) ||
      (f.kind === "weather" &&
        !!f.appliesTo.regionRef &&
        regions.has(f.appliesTo.regionRef)),
  );
  return {
    tripId: id,
    revision: s.trip.revision,
    clock: { now: travelNow().toISOString(), timezone: s.trip.timezone },
    evaluation,
    activities: activities.map((a) => ({
      ...summaryActivity(s.trip, a),
      environment: s.environments[a.id] ?? "unspecified",
    })),
    pressure: [
      ...new Set(activities.map((a) => a.date).filter((d): d is string => !!d)),
    ].map((d) => dayPressure(s.trip, d)),
    insertionOptions: filter.date
      ? insertionOptions(
          s.trip,
          s.facts,
          s.factsVersion,
          filter.date,
          s.environments,
        )
      : [],
    facts: facts.map(
      ({ collectionId: _collection, inputFingerprint: _fingerprint, ...f }) =>
        f,
    ),
    sources: s.sources.filter((source) =>
      facts.some((f) => f.sourceRefId === source.id),
    ),
  };
}
export async function previewPlan(
  ctx: CapabilityContext,
  id: string,
  raw: unknown,
) {
  const input = mutationSchema.parse(raw),
    s = await operationalSnapshot(ctx, id);
  if (s.trip.revision !== input.expectedRevision)
    throw new TravelError("行程已更新，请重新读取", 409);
  const after = applyOperations(s.trip, input.operations, ctx.actor);
  const facts = candidateFacts(after, s.facts);
  const evaluation = evaluate(
    after,
    facts,
    s.factsVersion,
    travelNow(),
    undefined,
    s.environments,
  );
  return {
    tripId: id,
    revision: s.trip.revision,
    candidateRevision: after.revision,
    evaluation,
    activities: after.activities.map((a) => summaryActivity(after, a)),
    pressure: [
      ...new Set(
        after.activities.map((a) => a.date).filter((d): d is string => !!d),
      ),
    ].map((d) => dayPressure(after, d)),
    persisted: false,
  };
}

/** Shared read-only precondition for a conditional admission request. */
export function requireOpeningCoverage(
  evaluation: Evaluation,
  ids: Set<string>,
) {
  const checks = evaluation.results.filter(
    (r) =>
      r.rule === "OPENING_COVERAGE" && r.activityIds.some((id) => ids.has(id)),
  );
  if (!checks.length || checks.some((r) => r.state !== "VALID"))
    throw new TravelError(
      "条件安排尚未满足：营业覆盖未知、过期或冲突，无法确认可以去。请先核实；不能把条件请求改为未验证的安排。",
      422,
    );
}
export async function verifyOpeningCondition(
  ctx: CapabilityContext,
  id: string,
  input: unknown,
) {
  const preview = await previewPlan(ctx, id, input);
  const mutation = mutationSchema.parse(input);
  const ids = new Set(
    mutation.operations.flatMap((op) =>
      op.type === "add" ? [op.activity.id] : op.type === "edit" ? [op.id] : [],
    ),
  );
  requireOpeningCoverage(preview.evaluation, ids);
  return preview;
}
