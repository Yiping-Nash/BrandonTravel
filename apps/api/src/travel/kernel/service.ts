import { travelNow } from "../clock.js";
import { z } from "zod";
import { weatherLocation } from "@open-sunsama/utils/travel-weather-location";
import { buildIntelligenceSnapshot } from "@open-sunsama/utils/travel-inspection";
import {
  evaluate,
  projectEvaluation,
  adjacent,
} from "@open-sunsama/utils/travel-intelligence";
import { createHash, randomUUID } from "node:crypto";
import type {
  FactSnapshot,
  FactView,
  KernelTrip,
  OperationalFact,
  TravelTrip,
  TravelEstimate,
} from "@open-sunsama/types";
import {
  operationalFactSchema,
  refreshFactsSchema,
  factQuerySchema,
  intelligenceQuerySchema,
  evaluationSchema,
} from "@open-sunsama/utils/travel-kernel-contract";
import { db } from "../store.js";
import { TravelError, applyOperations, mutationSchema } from "../domain.js";
import { legacy, sources } from "./repository.js";
import { transitions } from "../transitions.js";
import { collect, type FactTask } from "./provider.js";
export type CapabilityContext = {
  userId: string;
  actor: "user" | "agent";
  session: string;
  purpose: string;
};
export type RefreshInput = z.infer<typeof refreshFactsSchema>;
const inFlight = new Map<string, Promise<unknown>>();
const cancelledRefreshes = new Set<string>();
const sharedRefreshes = new Map<string, Promise<unknown>>();
let queue: Promise<unknown> = Promise.resolve();
let lastRequest = 0;
function ordered(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(ordered);
  if (x && typeof x === "object")
    return Object.fromEntries(
      Object.entries(x)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, ordered(v)]),
    );
  return x;
}
const digest = (x: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(ordered(x)))
    .digest("hex");
async function owned(ctx: CapabilityContext, id: string) {
  const rows =
    await db()`SELECT state,facts_version FROM travel_trips WHERE id=${id} AND user_id=${ctx.userId}`;
  if (!rows[0]) throw new TravelError("行程不存在", 404);
  return rows[0];
}
export async function getKernelTrip(
  ctx: CapabilityContext,
  id: string,
): Promise<KernelTrip> {
  return (await owned(ctx, id)).state as KernelTrip;
}
export async function queryFacts(
  ctx: CapabilityContext,
  id: string,
  raw: unknown = {},
): Promise<FactSnapshot & { total: number; nextCursor: number | null }> {
  return db().begin(async (tx) => {
    await tx`SELECT id FROM travel_trips WHERE id=${id} AND user_id=${ctx.userId} FOR SHARE`;
    return readFacts(ctx, id, raw, tx as unknown as ReturnType<typeof db>);
  });
}
async function readFacts(
  ctx: CapabilityContext,
  id: string,
  raw: unknown,
  sql: ReturnType<typeof db>,
): Promise<FactSnapshot & { total: number; nextCursor: number | null }> {
  const q = factQuerySchema.parse(raw);
  const rows =
    await sql`SELECT state,facts_version FROM travel_trips WHERE id=${id} AND user_id=${ctx.userId}`;
  if (!rows[0]) throw new TravelError("行程不存在", 404);
  const row = rows[0],
    trip = await legacy(sql, row.state),
    refs = await sources(sql, id);
  if (q.activityId && !trip.activities.some((a) => a.id === q.activityId))
    throw new TravelError("活动不存在", 404);
  const activity = q.activityId
    ? trip.activities.find((a) => a.id === q.activityId)
    : undefined;
  const related = new Set<string>();
  if (activity) {
    if (activity.entityId) related.add(activity.entityId);
    for (const t of transitions(trip))
      if (t.fromId === activity.id || t.toId === activity.id) {
        related.add(t.id);
        const a = trip.activities.find(
          (a) => a.id === (t.fromId === activity.id ? t.toId : t.fromId),
        );
        if (a?.entityId) related.add(a.entityId);
      }
  }
  const records =
    await sql`SELECT fact FROM travel_operational_facts WHERE trip_id=${id} AND user_id=${ctx.userId} ORDER BY kind,subject_key`;
  const active = tasks(
    trip,
    {
      requestId: randomUUID(),
      kinds: ["place", "opening_hours", "route_estimate", "weather"],
      force: false,
    },
    records.map((r) => r.fact as OperationalFact),
  );
  const regional = new Set(
    (trip.entities ?? [])
      .filter((e) => related.has(e.id))
      .map((e) => weatherLocation(e).key),
  );
  const requestedPoint = q.entityId
    ? (trip.entities ?? []).find((e) => e.id === q.entityId)
    : undefined;
  const now = +travelNow();
  const all: FactView[] = records.map((r) => {
    const f = operationalFactSchema.parse(r.fact) as OperationalFact;
    const mismatch = !active.some(
      (t) =>
        t.kind === f.kind &&
        t.subjectKey === f.subjectKey &&
        t.fingerprint === f.inputFingerprint &&
        (f.value?.kind !== "route_estimate" ||
          (t.from?.id === f.value.fromEntityId &&
            t.to?.id === f.value.toEntityId)),
    );
    const freshness = mismatch
      ? "unknown"
      : f.status !== "available"
        ? "unknown"
        : Date.parse(f.expiresAt) <= now
          ? "stale"
          : "fresh";
    return {
      ...f,
      freshness,
      unknownReason:
        f.kind === "weather" &&
        f.value?.kind === "weather" &&
        f.value.providerId !== "open-meteo"
          ? "WEATHER_SOURCE_RETIRED"
          : mismatch
            ? "FACT_INPUT_MISMATCH"
            : f.status !== "available"
              ? (f.error?.code ?? "FACT_MISSING")
              : freshness === "stale"
                ? "FACT_STALE"
                : f.quality !== "complete"
                  ? (f.error?.code ?? "PARSE_PENDING")
                  : null,
    };
  });
  const facts = all.filter(
    (f) =>
      (!q.kind || f.kind === q.kind) &&
      (!q.entityId ||
        f.subjectKey === q.entityId ||
        (f.kind === "weather" &&
          !!requestedPoint &&
          f.subjectKey.startsWith(weatherLocation(requestedPoint).key + ":")) ||
        (f.value?.kind === "route_estimate" &&
          (f.value.fromEntityId === q.entityId ||
            f.value.toEntityId === q.entityId))) &&
      (!activity ||
        related.has(f.subjectKey) ||
        (f.kind === "weather" &&
          !!f.appliesTo.regionRef &&
          regional.has(f.appliesTo.regionRef))) &&
      (!q.date ||
        !f.appliesTo.dates.length ||
        f.appliesTo.dates.includes(q.date) ||
        (f.value?.kind === "opening_hours" && !!f.value.weekly)),
  );
  const gaps = trip.activities
    .filter(
      (a) =>
        (!activity || a.id === activity.id) &&
        (!q.date || a.date === q.date) &&
        !a.entityId,
    )
    .map((a) => ({ subjectKey: a.id, reasonCode: "PLACE_UNCONFIRMED" }));
  if (q.date && q.kind === "weather" && !facts.length)
    gaps.push({
      subjectKey: q.date,
      reasonCode: "FORECAST_OUT_OF_RANGE_OR_MISSING",
    });
  return {
    tripRevision: trip.revision,
    factsVersion: row.facts_version,
    facts: facts.slice(q.cursor, q.cursor + q.limit),
    sources: refs.filter((s) => facts.some((f) => f.sourceRefId === s.id)),
    gaps,
    total: facts.length,
    nextCursor: q.cursor + q.limit < facts.length ? q.cursor + q.limit : null,
  };
}
export function tasks(
  trip: TravelTrip,
  input: RefreshInput,
  _facts: OperationalFact[],
): FactTask[] {
  const result: FactTask[] = [];
  const entities = (trip.entities ?? []).filter(
    (e) =>
      (!input.entityIds || input.entityIds.includes(e.id)) &&
      (!input.dates ||
        trip.activities.some(
          (a) => a.entityId === e.id && a.date && input.dates!.includes(a.date),
        )),
  );
  for (const e of entities) {
    for (const kind of input.kinds.filter(
      (k) => k === "place" || k === "opening_hours",
    ))
      result.push({
        kind,
        subjectKey: e.id,
        sourceRefId: e.id,
        entity: e,
        fingerprint: digest([
          kind,
          e.id,
          e.poiId,
          e.longitude,
          e.latitude,
          "adapter-v1",
        ]),
      });
    if (input.kinds.includes("weather")) {
      const point = weatherLocation(e),
        today = travelNow().toLocaleDateString("en-CA", {
          timeZone: trip.timezone,
        });
      const relevant = trip.activities
        .filter(
          (a) =>
            a.entityId === e.id &&
            a.date &&
            (!input.dates || input.dates.includes(a.date)),
        )
        .map((a) => a.date!);
      for (const weatherKind of ["daily_forecast", "outlook"] as const) {
        const lo = weatherKind === "outlook" ? 16 : 0,
          hi = weatherKind === "outlook" ? 45 : 15;
        if (
          !relevant.some((d) => {
            const offset =
              (Date.parse(d + "T00:00:00Z") -
                Date.parse(today + "T00:00:00Z")) /
              86400000;
            return offset >= lo && offset <= hi;
          })
        )
          continue;
        const subjectKey = point.key + ":" + weatherKind;
        if (
          result.some(
            (t) => t.kind === "weather" && t.subjectKey === subjectKey,
          )
        )
          continue;
        const hex = digest(["weather-source", subjectKey]),
          sourceRefId =
            hex.slice(0, 8) +
            "-" +
            hex.slice(8, 12) +
            "-5" +
            hex.slice(13, 16) +
            "-8" +
            hex.slice(17, 20) +
            "-" +
            hex.slice(20, 32);
        result.push({
          kind: "weather",
          subjectKey,
          sourceRefId,
          entity: e,
          weatherPoint: point,
          weatherKind,
          fingerprint: digest([
            "open-meteo",
            point.key,
            weatherKind,
            today,
            "Asia/Shanghai",
            "adapter-v2",
          ]),
        });
      }
    }
  }
  if (input.kinds.includes("route_estimate"))
    for (const t of transitions(trip)) {
      if (!t.fingerprint || (input.dates && !input.dates.includes(t.date)))
        continue;
      const from = trip.entities!.find(
          (e) =>
            e.id === trip.activities.find((a) => a.id === t.fromId)!.entityId,
        )!,
        to = trip.entities!.find(
          (e) =>
            e.id === trip.activities.find((a) => a.id === t.toId)!.entityId,
        )!;
      if (
        input.entityIds &&
        !input.entityIds.includes(from.id) &&
        !input.entityIds.includes(to.id)
      )
        continue;
      result.push({
        kind: "route_estimate",
        subjectKey: t.id,
        sourceRefId: from.id,
        from,
        to,
        mode: t.mode,
        fingerprint: t.fingerprint,
      });
    }
  return result;
}
function networkAllowed() {
  return (
    process.env.TRAVEL_MOCK_PROVIDERS === "true" ||
    process.env.TRAVEL_FACTS_ALLOW_NETWORK === "true"
  );
}
export async function paced<T>(work: () => Promise<T>): Promise<T> {
  const next = queue
    .catch(() => {})
    .then(async () => {
      if (process.env.TRAVEL_MOCK_PROVIDERS !== "true") {
        const delay = Math.max(0, 1000 - (Date.now() - lastRequest));
        if (delay) await new Promise((r) => setTimeout(r, delay));
        lastRequest = Date.now();
      }
      return work();
    });
  queue = next.catch(() => {});
  return next;
}
async function usage(
  ctx: CapabilityContext,
  status: string,
  provider = "internal",
) {
  await db()`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status) VALUES(${randomUUID()},${ctx.userId},${ctx.session},${process.env.TRAVEL_MOCK_PROVIDERS === "true" ? provider + "-mock" : provider},'facts-cache',${ctx.purpose},${status})`;
}
export async function refreshFacts(
  ctx: CapabilityContext,
  id: string,
  raw: unknown,
) {
  return runRefresh(ctx, id, raw);
}
// The existing route capability was already permitted to agents. It cannot
// select any other fact kind or gain authority to modify the plan.
export async function refreshRouteFacts(
  ctx: CapabilityContext,
  id: string,
  force = false,
) {
  return runRefresh(
    ctx,
    id,
    { requestId: randomUUID(), kinds: ["route_estimate"], force },
    true,
  );
}
export async function cancelRefresh(
  ctx: CapabilityContext,
  id: string,
  requestId: string,
) {
  if (ctx.actor !== "user")
    throw new TravelError("当前Agent不能取消事实刷新", 403);
  const state = await readRefresh(ctx, id, requestId);
  if (state.status === "running")
    cancelledRefreshes.add(`${ctx.userId}:${requestId}`);
  return {
    requestId,
    status: state.status === "running" ? "stopping" : state.status,
  };
}
export async function readRefresh(
  ctx: CapabilityContext,
  id: string,
  requestId: string,
) {
  await owned(ctx, id);
  const rows =
    await db()`SELECT result FROM travel_fact_refreshes WHERE user_id=${ctx.userId} AND trip_id=${id} AND request_id=${requestId}`;
  if (!rows[0]) throw new TravelError("刷新记录不存在", 404);
  return {
    requestId,
    status: rows[0].result
      ? rows[0].result.cancelled
        ? "cancelled"
        : "completed"
      : inFlight.has(`${ctx.userId}:${requestId}`)
        ? "running"
        : "interrupted",
    result: rows[0].result ?? null,
  };
}
async function runRefresh(
  ctx: CapabilityContext,
  id: string,
  raw: unknown,
  legacyRoute: boolean | "preparation" = false,
) {
  if (ctx.actor !== "user" && !legacyRoute)
    throw new TravelError("当前Agent不能刷新新事实接口", 403);
  const input = refreshFactsSchema.parse(raw);
  const initial = await legacy(db(), (await owned(ctx, id)).state);
  if (input.entityIds?.some((e) => !initial.entities?.some((p) => p.id === e)))
    throw new TravelError("地点不属于当前行程", 422);
  const token = digest([ctx.userId, id, input]);
  const key = `${ctx.userId}:${input.requestId}`;
  const existing =
    await db()`SELECT trip_id,payload,result FROM travel_fact_refreshes WHERE user_id=${ctx.userId} AND request_id=${input.requestId}`;
  if (existing[0]) {
    if (
      existing[0].trip_id !== id ||
      digest([ctx.userId, id, existing[0].payload]) !== token
    )
      throw new TravelError("请求标识重复", 409);
    if (existing[0].result) return existing[0].result;
    if (!inFlight.has(key))
      throw new TravelError("上次刷新中断，请用新的请求标识刷新", 409);
    return inFlight.get(key);
  }
  if (inFlight.has(key)) return inFlight.get(key);
  const sharedKey = digest([
    ctx.userId,
    id,
    { ...input, requestId: undefined },
  ]);
  if (sharedRefreshes.has(sharedKey)) {
    const result = await sharedRefreshes.get(sharedKey);
    await db()`INSERT INTO travel_fact_refreshes(user_id,request_id,trip_id,payload,result) VALUES(${ctx.userId},${input.requestId},${id},${db().json(input)},${db().json(result as never)}) ON CONFLICT DO NOTHING`;
    await usage(ctx, "coalesced");
    return result;
  }
  const work = (async () => {
    await db()`INSERT INTO travel_fact_refreshes(user_id,request_id,trip_id,payload) VALUES(${ctx.userId},${input.requestId},${id},${db().json(input)})`;
    const statistics = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      cache: 0,
      coalesced: 0,
      cooldown: 0,
      discarded: 0,
      blocked: 0,
    };
    refreshLoop: for (const kind of [
      "place",
      "opening_hours",
      "route_estimate",
      "weather",
    ] as const) {
      if (!input.kinds.includes(kind)) continue;
      const trip = await legacy(db(), (await owned(ctx, id)).state);
      const previousFacts = (
        await db()`SELECT fact FROM travel_operational_facts WHERE trip_id=${id} AND user_id=${ctx.userId}`
      ).map((r) => operationalFactSchema.parse(r.fact) as OperationalFact);
      const selected = tasks(trip, { ...input, kinds: [kind] }, previousFacts);
      if (selected.length > (legacyRoute === "preparation" ? 12 : 120))
        throw new TravelError("本次刷新范围过大，请分批刷新", 422);
      for (const task of selected) {
        if (cancelledRefreshes.has(key)) break refreshLoop;
        const previous = previousFacts.find(
          (f) =>
            f.kind === task.kind &&
            f.subjectKey === task.subjectKey &&
            f.inputFingerprint === task.fingerprint &&
            (f.value?.kind !== "route_estimate" ||
              (f.value.fromEntityId === task.from?.id &&
                f.value.toEntityId === task.to?.id)),
        );
        if (
          previous?.retryAfter &&
          Date.parse(previous.retryAfter) > +travelNow()
        ) {
          statistics.cooldown++;
          await usage(
            ctx,
            "cooldown",
            kind === "weather" ? "open-meteo" : "amap",
          );
          continue;
        }
        if (
          !input.force &&
          previous?.status === "available" &&
          Date.parse(previous.expiresAt) > +travelNow()
        ) {
          statistics.cache++;
          await usage(ctx, "cache", kind === "weather" ? "open-meteo" : "amap");
          continue;
        }
        if (!networkAllowed()) {
          statistics.blocked++;
          continue;
        }
        if (kind === "weather") {
          const source = {
            id: task.sourceRefId,
            providerId: "open-meteo",
            externalId: task.subjectKey,
            kind: "weather",
            displayName:
              task.weatherKind === "outlook"
                ? "Open-Meteo / ECMWF EC46"
                : "Open-Meteo 日级预报",
          };
          await db()`INSERT INTO travel_source_references(trip_id,user_id,id,source) VALUES(${id},${ctx.userId},${source.id},${db().json(source)}) ON CONFLICT(trip_id,id) DO NOTHING`;
        }
        const collectionId = randomUUID();
        await db()`INSERT INTO travel_fact_collections(id,trip_id,user_id,state) VALUES(${collectionId},${id},${ctx.userId},${db().json({ kind: task.kind, subjectKey: task.subjectKey, fingerprint: task.fingerprint, status: "running", session: ctx.session, provider: process.env.TRAVEL_MOCK_PROVIDERS === "true" ? "mock" : kind === "weather" ? "open-meteo" : "amap", generation: collectionId })})`;
        const fact = await paced(async () => {
          return collect(task, {
            user: ctx.userId,
            session: ctx.session,
            purpose: ctx.purpose,
          });
        });
        statistics.attempted++;
        fact.collectionId = collectionId;
        if (
          fact.value?.kind === "place" &&
          (fact.value.coordinates.longitude !== task.entity!.longitude ||
            fact.value.coordinates.latitude !== task.entity!.latitude ||
            fact.value.name !== task.entity!.name)
        ) {
          fact.quality = "partial";
          fact.error = {
            code: "PLACE_CHANGED_CONFIRMATION_REQUIRED",
            retryable: false,
          };
        }
        operationalFactSchema.parse(fact);
        const stored = await db().begin(async (tx) => {
          const rows =
            await tx`SELECT state FROM travel_trips WHERE id=${id} AND user_id=${ctx.userId} FOR UPDATE`;
          if (!rows[0]) return false;
          const recent =
            await tx`SELECT id FROM travel_fact_collections WHERE trip_id=${id} AND state->>'kind'=${task.kind} AND state->>'subjectKey'=${task.subjectKey} ORDER BY created_at DESC,id DESC LIMIT 1`;
          const latestTrip = await legacy(
            tx as unknown as ReturnType<typeof db>,
            rows[0].state,
          );
          const currentTasks = tasks(
            latestTrip,
            { ...input, kinds: [task.kind] },
            (
              await tx`SELECT fact FROM travel_operational_facts WHERE trip_id=${id}`
            ).map((r) => r.fact as OperationalFact),
          );
          if (
            recent[0]?.id !== collectionId ||
            !currentTasks.some(
              (t) =>
                t.subjectKey === task.subjectKey &&
                t.fingerprint === task.fingerprint &&
                t.from?.id === task.from?.id &&
                t.to?.id === task.to?.id,
            )
          ) {
            await tx`UPDATE travel_fact_collections SET state=state||${tx.json({ status: "discarded" })} WHERE id=${collectionId}`;
            return false;
          }
          const old =
            await tx`SELECT fact FROM travel_operational_facts WHERE trip_id=${id} AND kind=${task.kind} AND subject_key=${task.subjectKey}`;
          fact.version = (old[0]?.fact.version ?? 0) + 1;
          fact.id = old[0]?.fact.id ?? fact.id;
          await tx`INSERT INTO travel_operational_facts(trip_id,user_id,kind,subject_key,fact) VALUES(${id},${ctx.userId},${task.kind},${task.subjectKey},${tx.json(fact)}) ON CONFLICT(trip_id,kind,subject_key) DO UPDATE SET fact=excluded.fact`;
          await tx`UPDATE travel_trips SET facts_version=facts_version+1 WHERE id=${id}`;
          await tx`UPDATE travel_fact_collections SET state=state||${tx.json({ status: fact.status, code: fact.error?.code ?? null, queriedAt: fact.retrievedAt, payloadHash: digest(fact.value), normalized: fact, previous: old[0]?.fact ?? null })} WHERE id=${collectionId}`;
          if (task.kind === "route_estimate") {
            const estimate: TravelEstimate = {
              fingerprint: task.fingerprint,
              status: fact.status === "available" ? "ready" : "unknown",
              distanceMeters:
                fact.value?.kind === "route_estimate"
                  ? fact.value.distanceMeters
                  : null,
              durationSeconds:
                fact.value?.kind === "route_estimate"
                  ? fact.value.durationSeconds
                  : null,
              queriedAt: fact.retrievedAt,
              source: "amap",
              ...(fact.error ? { error: fact.error.code } : {}),
            };
            await tx`INSERT INTO travel_route_estimates(trip_id,transition_id,fingerprint,estimate) VALUES(${id},${task.subjectKey},${task.fingerprint},${tx.json(estimate)}) ON CONFLICT(trip_id,transition_id) DO UPDATE SET fingerprint=excluded.fingerprint,estimate=excluded.estimate`;
          }
          return true;
        });
        if (!stored) statistics.discarded++;
        else if (fact.status === "failed") statistics.failed++;
        else statistics.succeeded++;
      }
    }
    const snapshot = await queryFacts(ctx, id, { limit: 100 });
    const result = {
      ...statistics,
      cancelled: cancelledRefreshes.has(key),
      tripRevision: snapshot.tripRevision,
      factsVersion: snapshot.factsVersion,
      gaps: snapshot.gaps,
    };
    await db()`UPDATE travel_fact_refreshes SET result=${db().json(result)} WHERE user_id=${ctx.userId} AND request_id=${input.requestId}`;
    return result;
  })();
  inFlight.set(key, work);
  sharedRefreshes.set(sharedKey, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
    sharedRefreshes.delete(sharedKey);
    cancelledRefreshes.delete(key);
  }
}

export async function operationalSnapshot(ctx: CapabilityContext, id: string) {
  return db().begin(async (tx) => {
    await tx`SELECT id FROM travel_trips WHERE id=${id} AND user_id=${ctx.userId} FOR SHARE`;
    const sql = tx as unknown as ReturnType<typeof db>;
    const rows =
      await sql`SELECT state FROM travel_trips WHERE id=${id} AND user_id=${ctx.userId}`;
    if (!rows[0]) throw new TravelError("行程不存在", 404);
    const trip = await legacy(sql, rows[0].state);
    let snapshot = await readFacts(ctx, id, { limit: 100 }, sql);
    const facts = [...snapshot.facts];
    while (snapshot.nextCursor !== null) {
      snapshot = await readFacts(
        ctx,
        id,
        { limit: 100, cursor: snapshot.nextCursor },
        sql,
      );
      facts.push(...snapshot.facts);
    }
    return {
      trip,
      facts,
      factsVersion: snapshot.factsVersion,
      sources: await sources(sql, id),
      environments: Object.fromEntries(
        (rows[0].state as KernelTrip).activities.map((a) => [
          a.id,
          a.environment ?? "unspecified",
        ]),
      ),
    };
  });
}
export async function getIntelligence(
  ctx: CapabilityContext,
  id: string,
  raw: unknown = {},
) {
  const filter = intelligenceQuerySchema.parse(raw),
    snapshot = await operationalSnapshot(ctx, id);
  if (
    filter.activityId &&
    !snapshot.trip.activities.some((a) => a.id === filter.activityId)
  )
    throw new TravelError("活动不存在", 404);
  const full = evaluate(
    snapshot.trip,
    snapshot.facts,
    snapshot.factsVersion,
    travelNow(),
    undefined,
    snapshot.environments,
  );
  const result = projectEvaluation(full, snapshot.trip, filter);
  evaluationSchema.parse(result);
  return result;
}
export async function getOperationalContext(
  ctx: CapabilityContext,
  id: string,
  activityId: string,
) {
  const snapshot = await operationalSnapshot(ctx, id);
  const activity = snapshot.trip.activities.find((a) => a.id === activityId);
  if (!activity) throw new TravelError("活动不存在", 404);
  const evaluation = projectEvaluation(
    evaluate(
      snapshot.trip,
      snapshot.facts,
      snapshot.factsVersion,
      travelNow(),
      undefined,
      snapshot.environments,
    ),
    snapshot.trip,
    { activityId },
  );
  evaluationSchema.parse(evaluation);
  const connections = adjacent(snapshot.trip)
    .filter((t) => t.from.id === activityId || t.to.id === activityId)
    .map((t) => ({ id: t.id, fromId: t.from.id, toId: t.to.id }));
  const refs = new Set(
    evaluation.results.flatMap((r) => r.factRefs.map((f) => f.id)),
  );
  return {
    activity,
    connections,
    evaluation,
    facts: snapshot.facts.filter((f) => refs.has(f.id)),
  };
}

export async function getIntelligenceSnapshot(
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
  return buildIntelligenceSnapshot(
    s.trip,
    s.facts,
    s.sources,
    s.factsVersion,
    s.environments,
    travelNow(),
    filter,
  );
}

/** Pure candidate evaluation over one authoritative snapshot. Never collects facts. */
export async function previewOperations(
  ctx: CapabilityContext,
  id: string,
  raw: unknown,
) {
  const input = mutationSchema.parse(raw),
    snapshot = await operationalSnapshot(ctx, id);
  if (snapshot.trip.revision !== input.expectedRevision)
    throw new TravelError("行程已更新，请重新读取", 409);
  const after = applyOperations(snapshot.trip, input.operations, ctx.actor);
  const { candidateFacts } = await import("./planning.js");
  const evaluation = evaluate(
    after,
    candidateFacts(after, snapshot.facts),
    snapshot.factsVersion,
    travelNow(),
    undefined,
    snapshot.environments,
  );
  evaluationSchema.parse(evaluation);
  return { after, evaluation };
}

export const prepareInputSchema = z
  .object({
    requestId: z.uuid(),
    date: z.iso.date(),
    kinds: z
      .array(z.enum(["place", "opening_hours", "route_estimate", "weather"]))
      .min(1)
      .max(2),
    entityIds: z.array(z.uuid()).min(1).max(3).optional(),
  })
  .strict();
export async function prepareOperationalFacts(
  ctx: CapabilityContext,
  id: string,
  raw: unknown,
) {
  const input = prepareInputSchema.parse(raw),
    s = await operationalSnapshot(ctx, id);
  if (input.date < s.trip.startDate || input.date > s.trip.endDate)
    throw new TravelError("查询日期不属于当前行程", 422);
  const selected = {
    requestId: input.requestId,
    kinds: [...new Set(input.kinds)],
    dates: [input.date],
    entityIds: input.entityIds,
    force: false,
  };
  if (tasks(s.trip, selected, s.facts).length > 12)
    throw new TravelError("查询范围超过12项，请选择最多3个地点", 422);
  return runRefresh(ctx, id, selected, "preparation");
}
export async function getTripContext(ctx: CapabilityContext, id: string) {
  await owned(ctx, id);
  const rows =
    await db()`SELECT id,state FROM travel_chat_runs WHERE trip_id=${id} AND user_id=${ctx.userId} ORDER BY created_at DESC,id DESC LIMIT 20`;
  let remaining = 6000;
  const turns = rows
    .flatMap((r) => {
      const message = String(r.state.message ?? "");
      if (message.length > remaining) return [];
      remaining -= message.length;
      return [
        {
          runId: r.id,
          message,
          createdAt: r.state.createdAt,
          scope: "current_trip_user_statement",
        },
      ];
    })
    .reverse();
  return {
    tripId: id,
    scope: "current_trip",
    turns,
    limit: 20,
    characterLimit: 6000,
    permanentMemory: false,
  };
}
