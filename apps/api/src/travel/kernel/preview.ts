import { entitySchema } from "@open-sunsama/utils/travel-contract";
import { randomUUID } from "node:crypto";
import { db } from "../store.js";
import { verifyPlaceSelection, amapRequest } from "../amap.js";
import { TravelError } from "../domain.js";
import { legacy } from "./repository.js";
import { collect } from "./provider.js";
import { paced, type CapabilityContext } from "./service.js";
import type { OperationalFact } from "@open-sunsama/types";
const active = new Map<
  string,
  Promise<{ facts: OperationalFact[]; cached: boolean }>
>();
async function log(ctx: CapabilityContext, status: string) {
  await db()`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status) VALUES(${randomUUID()},${ctx.userId},${ctx.session},${process.env.TRAVEL_MOCK_PROVIDERS === "true" ? "amap-mock" : "amap"},'place-preview-cache',${ctx.purpose},${status})`;
}
export async function previewPlace(
  ctx: CapabilityContext,
  id: string,
  raw: unknown,
) {
  if (ctx.actor !== "user")
    throw new TravelError("当前Agent不能查询地点预览", 403);
  const entity = entitySchema.parse(raw);
  const rows =
    await db()`SELECT state FROM travel_trips WHERE id=${id} AND user_id=${ctx.userId}`;
  if (!rows[0]) throw new TravelError("行程不存在", 404);
  verifyPlaceSelection(ctx.userId, entity, await legacy(db(), rows[0].state));
  const key = ctx.userId + ":" + id + ":" + entity.poiId;
  const cached =
    await db()`SELECT state FROM travel_fact_collections WHERE trip_id=${id} AND user_id=${ctx.userId} AND state->>'kind'='place_preview' AND state->>'subjectKey'=${entity.poiId} ORDER BY state->>'queriedAt' DESC LIMIT 1`;
  if (
    cached[0]?.state.status === "failed" &&
    Date.parse(cached[0].state.expiresAt) > Date.now()
  ) {
    await log(ctx, "cooldown");
    if (cached[0].state.result)
      return { ...cached[0].state.result, cached: true };
    throw new TravelError("上次查询失败，正在冷却，请稍后重试", 429);
  }
  if (
    cached[0]?.state.result &&
    Date.parse(cached[0].state.expiresAt) > Date.now()
  ) {
    await log(ctx, cached[0].state.status === "failed" ? "cooldown" : "cache");
    return { ...cached[0].state.result, cached: true };
  }
  if (active.has(key)) {
    await log(ctx, "coalesced");
    return active.get(key)!;
  }
  if (
    process.env.TRAVEL_FACTS_ALLOW_NETWORK !== "true" &&
    process.env.TRAVEL_MOCK_PROVIDERS !== "true"
  )
    throw new TravelError("当前未开启外部查询", 503);
  const work = (async () => {
    const collectionId = randomUUID(),
      now = new Date();
    await db()`INSERT INTO travel_fact_collections(id,trip_id,user_id,state) VALUES(${collectionId},${id},${ctx.userId},${db().json({ kind: "place_preview", subjectKey: entity.poiId, provider: process.env.TRAVEL_MOCK_PROVIDERS === "true" ? "mock" : "amap", status: "running", queriedAt: now.toISOString(), session: ctx.session })})`;
    try {
      const response = await paced(async () => {
        if (process.env.TRAVEL_MOCK_PROVIDERS !== "true") {
          const n =
            await db()`SELECT count(*)::int AS count FROM travel_fact_collections WHERE state->>'provider'='amap'`;
          if (n[0]!.count > 200)
            throw new TravelError("Phase2测试预算上限", 429);
        }
        return amapRequest(
          "/v5/place/detail",
          { id: entity.poiId, show_fields: "business" },
          { user: ctx.userId, session: ctx.session, purpose: ctx.purpose },
        );
      });
      const facts = await Promise.all(
        (["place", "opening_hours"] as const).map((kind) =>
          collect(
            {
              kind,
              subjectKey: entity.id,
              sourceRefId: entity.id,
              fingerprint: "preview",
              entity,
            },
            { user: ctx.userId },
            fetch,
            now,
            response,
          ),
        ),
      );
      const result = { facts, cached: false };
      await db()`UPDATE travel_fact_collections SET state=state||${db().json({ result, status: facts.some((f) => f.status === "failed") ? "failed" : "completed", expiresAt: new Date(+now + (facts.some((f) => f.status === "failed") ? 60000 : 900000)).toISOString() })} WHERE id=${collectionId}`;
      return result;
    } catch (error) {
      await db()`UPDATE travel_fact_collections SET state=state||${db().json({ status: "failed", expiresAt: new Date(+now + 60000).toISOString() })} WHERE id=${collectionId}`;
      throw error;
    }
  })();
  active.set(key, work);
  try {
    return await work;
  } finally {
    active.delete(key);
  }
}
