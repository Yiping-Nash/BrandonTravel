import { randomUUID, createHash } from "node:crypto";
import { kernelMutationSchema } from "@open-sunsama/utils/travel-kernel-contract";
import type { KernelTrip, TravelTrip } from "@open-sunsama/types";
import { applyOperations, TravelError } from "../domain.js";
import { verifyPlaceSelection } from "../amap.js";
import { db } from "../store.js";
import { legacy, persist } from "./repository.js";
import { toCanonical } from "./compat.js";
import type { CapabilityContext } from "./service.js";
const hash = (x: unknown): string => {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, sort(v)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(sort(x)))
    .digest("hex");
};
export async function mutateKernel(
  ctx: CapabilityContext,
  id: string,
  raw: unknown,
) {
  if (ctx.actor !== "user") throw new TravelError("AI只能读取或创建提案", 403);
  const input = kernelMutationSchema.parse(raw);
  if (
    new Set(input.environments.map((e) => e.activityId)).size !==
    input.environments.length
  )
    throw new TravelError("户外属性不能重复");
  return db().begin(async (tx) => {
    const sql = tx as unknown as ReturnType<typeof db>;
    const rows =
      await tx`SELECT state FROM travel_trips WHERE id=${id} AND user_id=${ctx.userId} FOR UPDATE`;
    if (!rows[0]) throw new TravelError("行程不存在", 404);
    const prior =
      await tx`SELECT trip_id,payload,result FROM travel_requests WHERE user_id=${ctx.userId} AND request_id=${input.requestId}`;
    if (prior[0]) {
      if (prior[0].trip_id !== id || hash(prior[0].payload) !== hash(input))
        throw new TravelError("请求标识已用于其他修改", 409);
      return prior[0].result as TravelTrip;
    }
    const original = await legacy(sql, rows[0].state),
      previous = rows[0].state as KernelTrip;
    if (original.revision !== input.expectedRevision)
      throw new TravelError("行程已更新，请刷新", 409);
    for (const op of input.operations)
      if (op.type === "bind_entity" && op.entity)
        verifyPlaceSelection(ctx.userId, op.entity, original);
    const next = applyOperations(original, input.operations, "user");
    const canonical = toCanonical(next, previous).trip;
    for (const e of input.environments) {
      const a = canonical.activities.find((a) => a.id === e.activityId);
      if (!a) throw new TravelError("活动不存在", 404);
      if (
        (a.locked || original.activities.find((x) => x.id === a.id)?.locked) &&
        a.environment !== e.environment
      )
        throw new TravelError("请先解除固定，再修改户外属性");
      a.environment = e.environment;
    }
    await persist(sql, ctx.userId, next, canonical);
    await tx`INSERT INTO travel_events(id,user_id,trip_id,state) VALUES(${randomUUID()},${ctx.userId},${id},${tx.json({ actor: "user", requestId: input.requestId, operations: input.operations, environments: input.environments, before: previous, after: canonical, createdAt: new Date().toISOString() })})`;
    await tx`INSERT INTO travel_requests(user_id,request_id,trip_id,payload,result) VALUES(${ctx.userId},${input.requestId},${id},${tx.json(input)},${tx.json(next)})`;
    return next;
  });
}
