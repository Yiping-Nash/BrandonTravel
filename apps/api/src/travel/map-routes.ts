import { evaluate } from "@open-sunsama/utils/travel-intelligence";
import { refreshRouteFacts, operationalSnapshot } from "./kernel/service.js";
import { Hono } from "hono";
import { z } from "zod";
import { db, ownedTrip } from "./store.js";
import type { AuthVariables } from "../middleware/auth.js";
import type { TravelEstimate } from "@open-sunsama/types";
import { transitions } from "./transitions.js";
import { searchPlaces } from "./amap.js";

export const mapRouter = new Hono<{ Variables: AuthVariables }>();
mapRouter.get("/places/search", async (c) => {
  const input = z
    .object({
      query: z.string().trim().min(1).max(100),
      city: z.string().trim().min(1).max(100),
    })
    .parse(c.req.query());
  return c.json({
    success: true,
    data: await searchPlaces(input.query, input.city, {
      user: c.get("userId"),
      session: c.get("travelSession"),
      purpose:
        c.req.header("X-Travel-Test") === "true" ? "acceptance" : "interactive",
    }),
  });
});
export async function readTransitions(user: string, id: string) {
  const snapshot = await operationalSnapshot(
    {
      userId: user,
      actor: "user",
      session: "unknown",
      purpose: "read-transitions",
    },
    id,
  );
  const estimates: Record<string, TravelEstimate> = {};
  for (const f of snapshot.facts.filter((f) => f.kind === "route_estimate")) {
    estimates[f.inputFingerprint] = {
      fingerprint: f.inputFingerprint,
      status: f.status === "available" ? "ready" : "unknown",
      distanceMeters:
        f.value?.kind === "route_estimate" ? f.value.distanceMeters : null,
      durationSeconds:
        f.value?.kind === "route_estimate" ? f.value.durationSeconds : null,
      queriedAt: f.retrievedAt,
      source: "amap",
      ...(f.error ? { error: f.error.code } : {}),
    };
  }
  const results = evaluate(
    snapshot.trip,
    snapshot.facts,
    snapshot.factsVersion,
  ).results;
  return transitions(snapshot.trip, estimates).map((t) => {
    const result = results.find(
      (r) => r.rule === "TRANSITION_GAP" && r.transitionId === t.id,
    );
    return {
      ...t,
      shortageMinutes:
        result?.rule === "TRANSITION_GAP"
          ? result.details.shortageMinutes
          : null,
      freshness:
        result?.state === "UNKNOWN"
          ? ((result.reasonCode === "FACT_STALE" ? "stale" : "unknown") as
              "stale" | "unknown")
          : t.freshness,
    };
  });
}
mapRouter.get("/trips/:id/transitions", async (c) =>
  c.json({
    success: true,
    data: await readTransitions(
      c.get("userId"),
      z.uuid().parse(c.req.param("id")),
    ),
  }),
);
export async function refreshTransitions(
  user: string,
  id: string,
  force = false,
  purpose = "interactive",
  session = "acceptance",
) {
  await refreshRouteFacts(
    { userId: user, actor: "agent", purpose, session },
    id,
    force,
  );
  return readTransitions(user, id);
}
mapRouter.post("/trips/:id/transitions/refresh", async (c) => {
  const input = z
    .object({ force: z.boolean().default(false) })
    .strict()
    .parse(await c.req.json());
  return c.json({
    success: true,
    data: await refreshTransitions(
      c.get("userId"),
      z.uuid().parse(c.req.param("id")),
      input.force,
      c.req.header("X-Travel-Test") === "true" ? "acceptance" : "interactive",
      c.get("travelSession"),
    ),
  });
});
mapRouter.get("/usage", async (c) => {
  const user = c.get("userId");
  const totals =
    await db()`SELECT provider,status,count(*)::int as count,coalesce(sum(input_tokens),0)::int as input_tokens,coalesce(sum(output_tokens),0)::int as output_tokens FROM travel_api_usage WHERE user_id=${user} AND session_id=${c.get("travelSession") ?? "unknown"} GROUP BY provider,status`;
  const recent =
    await db()`SELECT provider,endpoint,purpose,status,elapsed_ms,input_tokens,output_tokens,error,created_at FROM travel_api_usage WHERE user_id=${user} AND session_id=${c.get("travelSession") ?? "unknown"} ORDER BY created_at DESC LIMIT 50`;
  return c.json({ success: true, data: { totals, recent } });
});
mapRouter.get("/trips/:id/inspection", async (c) => {
  const user = c.get("userId"),
    id = z.uuid().parse(c.req.param("id"));
  const trip = await ownedTrip(user, id);
  const proposals =
    await db()`SELECT state FROM travel_proposals WHERE user_id=${user} AND trip_id=${id} ORDER BY id`;
  const operations =
    await db()`SELECT state FROM travel_events WHERE user_id=${user} AND trip_id=${id} ORDER BY created_at DESC LIMIT 10`;
  return c.json({
    success: true,
    data: {
      trip,
      transitions: await readTransitions(user, id),
      proposals: proposals.map((r) => r.state),
      operations: operations.map((r) => r.state),
    },
  });
});
