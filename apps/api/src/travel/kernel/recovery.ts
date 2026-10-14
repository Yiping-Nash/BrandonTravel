import { z } from "zod";
import type { TravelTrip, TravelOperation } from "@open-sunsama/types";
import { TravelError, applyOperations } from "../domain.js";
import { operationalSnapshot, type CapabilityContext } from "./service.js";
import { db } from "../store.js";
export function inverseSchedule(
  before: TravelTrip,
  after: TravelTrip,
  current: TravelTrip,
  activityId: string,
): TravelOperation[] {
  const old = before.activities.find((a) => a.id === activityId),
    changed = after.activities.find((a) => a.id === activityId),
    now = current.activities.find((a) => a.id === activityId);
  if (!old || !changed || !now)
    throw new TravelError("历史或当前活动不存在，不能恢复", 422);
  const patch: { date?: string | null; start?: number | null } = {};
  for (const k of ["date", "start"] as const)
    if (old[k] !== changed[k]) {
      if (now[k] !== changed[k])
        throw new TravelError(
          "目标时间字段后来已被修改，请先确认如何恢复",
          409,
        );
      if (k === "date") patch.date = old.date;
      else patch.start = old.start;
    }
  if (!Object.keys(patch).length)
    throw new TravelError("该记录没有可恢复的日期/开始时间修改", 422);
  const operations: TravelOperation[] = [
    { type: "edit", id: activityId, patch },
  ];
  applyOperations(current, operations, "agent");
  return operations;
}
export async function recentChanges(ctx: CapabilityContext, id: string) {
  await operationalSnapshot(ctx, id);
  const rows =
    await db()`SELECT id,state FROM travel_events WHERE trip_id=${id} AND user_id=${ctx.userId} ORDER BY created_at DESC,id DESC LIMIT 10`;
  return {
    tripId: id,
    changes: rows.map((r) => ({
      eventId: r.id,
      actor: r.state.actor,
      proposalId: r.state.proposalId ?? null,
      createdAt: r.state.createdAt,
      beforeRevision: r.state.before.revision,
      afterRevision: r.state.after.revision,
      activities: (
        r.state.after.activities as TravelTrip["activities"]
      ).flatMap<{
        activityId: string;
        title: string;
        kind: string;
        before: { date: string | null; start: number | null } | null;
        after: { date: string | null; start: number | null };
      }>((a) => {
        const b = (r.state.before.activities as TravelTrip["activities"]).find(
          (b) => b.id === a.id,
        );
        return !b
          ? [
              {
                activityId: a.id,
                title: a.title,
                kind: "added",
                before: null,
                after: { date: a.date, start: a.start },
              },
            ]
          : b.date !== a.date || b.start !== a.start
            ? [
                {
                  activityId: a.id,
                  title: a.title,
                  kind: "schedule",
                  before: { date: b.date, start: b.start },
                  after: { date: a.date, start: a.start },
                },
              ]
            : [];
      }),
    })),
  };
}
export async function previewRestore(
  ctx: CapabilityContext,
  id: string,
  raw: unknown,
) {
  const input = z
    .object({
      eventId: z.uuid(),
      activityId: z.uuid(),
      expectedRevision: z.number().int().min(0),
    })
    .strict()
    .parse(raw);
  const snapshot = await operationalSnapshot(ctx, id);
  if (snapshot.trip.revision !== input.expectedRevision)
    throw new TravelError("行程已更新，请重新读取", 409);
  const rows =
    await db()`SELECT state FROM travel_events WHERE id=${input.eventId} AND trip_id=${id} AND user_id=${ctx.userId}`;
  if (!rows[0]) throw new TravelError("变更记录不存在", 404);
  const operations = inverseSchedule(
    rows[0].state.before,
    rows[0].state.after,
    snapshot.trip,
    input.activityId,
  );
  return {
    tripId: id,
    revision: snapshot.trip.revision,
    eventId: input.eventId,
    activityId: input.activityId,
    operations,
    persisted: false,
  };
}
export async function findProposal(
  ctx: CapabilityContext,
  id: string,
  requestId: string,
) {
  await operationalSnapshot(ctx, id);
  z.uuid().parse(requestId);
  const rows =
    await db()`SELECT state FROM travel_proposals WHERE trip_id=${id} AND user_id=${ctx.userId} AND state->>'requestId'=${requestId}`;
  const { proposalReceipt } = await import("../agent-state.js");
  return {
    tripId: id,
    requestId,
    proposal: rows[0] ? proposalReceipt(rows[0].state) : null,
  };
}
