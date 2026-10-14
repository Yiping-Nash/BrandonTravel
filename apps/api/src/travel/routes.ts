import { amapJsRouter } from "./amap-js-routes.js";
import { exchangeRouter } from "./exchange-rates.js";
import { previewOperations } from "./kernel/service.js";
import { kernelRouter } from "./kernel/routes.js";
import { legacy, persist } from "./kernel/repository.js";
import type { KernelTrip } from "@open-sunsama/types";
import {
  agentView,
  resolveDate,
  assertDateConstraints,
  proposalReceipt,
} from "./agent-state.js";
import { Hono } from "hono";
import { verifyPlaceSelection } from "./amap.js";
import { db, ownedTrip } from "./store.js";
import { mapRouter } from "./map-routes.js";
import { chatRouter } from "./chat-routes.js";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { TravelTrip, TravelProposal } from "@open-sunsama/types";
import { auth, type AuthVariables } from "../middleware/auth.js";
import {
  applyOperations,
  validateTrip,
  conflicts,
  createTripSchema,
  mutationSchema,
  proposalSchema,
  TravelError,
} from "./domain.js";
import { z } from "zod";
import { isAppError } from "@open-sunsama/utils";
const router = new Hono<{ Variables: AuthVariables }>();
router.onError((err, c) => {
  const status =
    err instanceof TravelError
      ? err.status
      : err instanceof z.ZodError
        ? 422
        : isAppError(err)
          ? err.statusCode
          : 500;
  return c.json(
    {
      success: false,
      error: { message: status === 500 ? "保存失败，请重试" : err.message },
    },
    status as 422 | 403 | 404 | 409 | 500,
  );
});
router.use("*", async (c, next) => {
  const key = c.req.header("X-Travel-Key");
  if (key) {
    const digest = createHash("sha256").update(key).digest("hex");
    const rows =
      await db()`SELECT user_id FROM travel_keys WHERE digest=${digest}`;
    if (!rows[0])
      return c.json({ success: false, error: { message: "凭据无效" } }, 401);
    c.set("userId", rows[0].user_id);
    c.set("travelActor", "agent");
    c.set(
      "travelSession",
      c.req.header("X-Travel-Session")?.match(/^[a-f0-9]{64}$/)?.[0] ?? digest,
    );
    await next();
    return undefined;
  }
  return await auth(c, async () => {
    if (c.get("authMethod") !== "jwt")
      throw new TravelError("旅行入口仅支持用户会话或专用提案凭据", 403);
    c.set("travelActor", "user");
    c.set(
      "travelSession",
      c.get("travelSession") ??
        createHash("sha256")
          .update(c.req.header("Authorization") ?? "")
          .digest("hex"),
    );
    await next();
  });
});
router.use("*", async (c, next) => {
  const started = Date.now();
  try {
    await next();
  } finally {
    const endpoint =
      c.req.method +
      " " +
      c.req.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id");
    await db()`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status,elapsed_ms) VALUES(${randomUUID()},${c.get("userId")},${c.get("travelSession") ?? "unknown"},'internal',${endpoint},${c.req.header("X-Travel-Test") === "true" ? "acceptance" : "interactive"},${c.res.status >= 400 ? "failed" : "success"},${Date.now() - started})`.catch(
      () => {},
    );
  }
});
router.use("*", async (c, next) => {
  if (
    c.get("travelActor") === "agent" &&
    c.req.method !== "GET" &&
    !/^\/travel\/trips\/[^/]+\/(proposals|transitions\/refresh|plan-preview|prepare-operational-facts|restore-preview)$/.test(
      c.req.path,
    )
  )
    throw new TravelError("AI 只能读取或创建提案", 403);
  await next();
});
router.post("/keys", async (c) => {
  const key = "bt_" + randomBytes(32).toString("hex");
  const digest = createHash("sha256").update(key).digest("hex");
  await db()`INSERT INTO travel_keys(id,user_id,digest) VALUES(${randomUUID()},${c.get("userId")},${digest})`;
  return c.json({ success: true, data: { key } }, 201);
});
router.route("/", exchangeRouter);
router.get("/trips", async (c) => {
  const rows =
    await db()`SELECT state FROM travel_trips WHERE user_id=${c.get("userId")} ORDER BY id`;
  return c.json({
    success: true,
    data: await Promise.all(rows.map((r) => legacy(db(), r.state))),
  });
});
router.post("/trips", async (c) => {
  const input = createTripSchema.parse(await c.req.json());
  const trip: TravelTrip = validateTrip({
    ...input,
    id: randomUUID(),
    timezone: "Asia/Shanghai",
    revision: 0,
    activities: [],
  });
  await db().begin(async (tx) =>
    persist(
      tx as unknown as ReturnType<typeof db>,
      c.get("userId"),
      trip,
      undefined,
      true,
    ),
  );
  return c.json({ success: true, data: trip }, 201);
});
router.get("/trips/:id", async (c) => {
  const id = z.uuid().parse(c.req.param("id"));
  const rows =
    await db()`SELECT state FROM travel_trips WHERE id=${id} AND user_id=${c.get("userId")}`;
  if (!rows[0]) throw new TravelError("行程不存在", 404);
  return c.json({
    success: true,
    data: await legacy(db(), rows[0].state),
    conflicts: conflicts(await legacy(db(), rows[0].state)),
  });
});
router.post("/trips/:id/operations", async (c) => {
  const id = z.uuid().parse(c.req.param("id")),
    user = c.get("userId"),
    input = mutationSchema.parse(await c.req.json());
  const result = await db().begin(async (tx) => {
    const rows =
      await tx`SELECT state FROM travel_trips WHERE id=${id} AND user_id=${user} FOR UPDATE`;
    if (!rows[0]) throw new TravelError("行程不存在", 404);
    const old =
      await tx`SELECT trip_id,payload,result FROM travel_requests WHERE user_id=${user} AND request_id=${input.requestId}`;
    if (old[0]) {
      if (
        old[0].trip_id !== id ||
        JSON.stringify(old[0].payload) !==
          JSON.stringify(JSON.parse(JSON.stringify(input)))
      ) {
        // JSONB key order is not authoritative: compare normalized structures.
        if (
          old[0].trip_id !== id ||
          canonical(old[0].payload) !== canonical(input)
        )
          throw new TravelError("请求标识已用于其他修改", 409);
      }
      return old[0].result as TravelTrip;
    }
    const original = await legacy(
      tx as unknown as ReturnType<typeof db>,
      rows[0].state,
    );
    if (original.revision !== input.expectedRevision)
      throw new TravelError("行程已更新，请刷新", 409);
    for (const op of input.operations)
      if (op.type === "bind_entity" && op.entity)
        verifyPlaceSelection(user, op.entity, original);
    const next = applyOperations(original, input.operations, "user");
    await persist(
      tx as unknown as ReturnType<typeof db>,
      user,
      next,
      rows[0].state as KernelTrip,
    );
    await tx`INSERT INTO travel_events(id,user_id,trip_id,state) VALUES(${randomUUID()},${user},${id},${tx.json({ actor: "user", requestId: input.requestId, operations: input.operations, before: original, after: next, createdAt: new Date().toISOString() })})`;
    await tx`INSERT INTO travel_requests(user_id,request_id,trip_id,payload,result) VALUES(${user},${input.requestId},${id},${tx.json(input)},${tx.json(next)})`;
    return next;
  });
  return c.json({
    success: true,
    data: result,
    conflicts: conflicts(result as TravelTrip),
  });
});
router.get("/trips/:id/proposals", async (c) => {
  const id = z.uuid().parse(c.req.param("id")),
    user = c.get("userId");
  await ownedTrip(user, id);
  if (!c.req.query("status")) {
    const rows =
      await db()`SELECT state FROM travel_proposals WHERE trip_id=${id} AND user_id=${user} ORDER BY id`;
    return c.json({
      success: true,
      data: await Promise.all(rows.map((r) => legacy(db(), r.state))),
    });
  }
  const input = z
    .object({
      status: z.enum(["pending", "history"]),
      cursor: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .parse(c.req.query());
  const history = input.status === "history";
  const counts =
    await db()`SELECT count(*) FILTER (WHERE state->>'status'='pending')::int AS pending, count(*) FILTER (WHERE state->>'status'<>'pending')::int AS history FROM travel_proposals WHERE trip_id=${id} AND user_id=${user}`;
  const rows =
    await db()`SELECT p.state, COALESCE(p.state->>'processedAt', (SELECT max(e.created_at)::text FROM travel_events e WHERE e.user_id=${user} AND e.state->>'proposalId'=p.id::text)) AS processed_time FROM travel_proposals p WHERE p.trip_id=${id} AND p.user_id=${user} AND (p.state->>'status'='pending')=${!history} ORDER BY COALESCE((p.state->>'processedAt')::timestamptz, (SELECT max(e.created_at) FROM travel_events e WHERE e.user_id=${user} AND e.state->>'proposalId'=p.id::text),(p.state->>'createdAt')::timestamptz) DESC NULLS LAST,p.id DESC LIMIT ${input.limit} OFFSET ${input.cursor}`;
  const total = history
    ? (counts[0]!.history as number)
    : (counts[0]!.pending as number);
  return c.json({
    success: true,
    data: {
      items: rows.map((r) => ({
        ...r.state,
        ...(r.processed_time && !r.state.processedAt
          ? { processedAt: r.processed_time }
          : {}),
      })),
      total,
      historyTotal: counts[0]!.history,
      nextCursor:
        input.cursor + rows.length < total ? input.cursor + rows.length : null,
    },
  });
});
router.get("/trips/:id/agent", async (c) => {
  const id = z.uuid().parse(c.req.param("id"));
  const input = z
    .object({
      view: z.enum(["overview", "day", "activity", "date"]),
      date: z.string().optional(),
      activityId: z.uuid().optional(),
      query: z.string().max(4000).optional(),
      expression: z.string().max(100).optional(),
      cursor: z.coerce.number().int().min(0).optional(),
      limit: z.coerce.number().int().min(1).max(30).optional(),
    })
    .parse(c.req.query());
  const trip = await ownedTrip(c.get("userId"), id);
  if (
    (input.view === "day" && !input.date) ||
    (input.view === "activity" && !input.activityId) ||
    (input.view === "date" && !input.expression)
  )
    throw new TravelError("读取视图缺少日期、活动ID或日期表达");
  return c.json({
    success: true,
    data:
      input.view === "date"
        ? resolveDate(trip, input.expression!)
        : agentView(trip, input),
  });
});
router.post("/trips/:id/proposals", async (c) => {
  const id = z.uuid().parse(c.req.param("id")),
    user = c.get("userId"),
    input = proposalSchema.parse(await c.req.json());
  // Idempotent replay must work even after a proposal has been confirmed.
  const replay =
    await db()`SELECT state FROM travel_proposals WHERE user_id=${user} AND state->>'requestId'=${input.requestId}`;
  if (replay[0]) {
    if (
      replay[0].state.tripId !== id ||
      canonical(replay[0].state.input) !== canonical(input)
    )
      throw new TravelError("请求标识重复", 409);
    return c.json({ success: true, data: replay[0].state }, 201);
  }
  const preview = await previewOperations(
    {
      userId: user,
      actor: "agent",
      session: c.get("travelSession") ?? "unknown",
      purpose: "proposal-preview",
    },
    id,
    {
      expectedRevision: input.expectedRevision,
      requestId: input.requestId,
      operations: input.operations,
    },
  );
  const result = await db().begin(async (tx) => {
    const rows =
      await tx`SELECT state FROM travel_trips WHERE id=${id} AND user_id=${user} FOR UPDATE`;
    if (!rows[0]) throw new TravelError("行程不存在", 404);
    const existing =
      await tx`SELECT state FROM travel_proposals WHERE user_id=${user} AND state->>'requestId'=${input.requestId}`;
    if (existing[0]) {
      if (
        existing[0].state.tripId !== id ||
        canonical(existing[0].state.input) !== canonical(input)
      )
        throw new TravelError("请求标识重复", 409);
      return existing[0].state;
    }
    const before = await legacy(
      tx as unknown as ReturnType<typeof db>,
      rows[0].state,
    );
    if (before.revision !== input.expectedRevision)
      throw new TravelError("行程已更新，请重新读取", 409);
    for (const op of input.operations)
      if (op.type === "bind_entity" && op.entity)
        verifyPlaceSelection(user, op.entity, before);
    const after = applyOperations(before, input.operations, "agent");
    assertDateConstraints(after, input.dateConstraints);
    const proposal = {
      id: randomUUID(),
      tripId: id,
      revision: before.revision,
      reason: input.reason,
      status: "pending",
      evaluation: preview.evaluation,
      operations: input.operations,
      before,
      after,
      result: null,
      createdAt: new Date().toISOString(),
      dateConstraints: input.dateConstraints,
      requestId: input.requestId,
      input,
    };
    await tx`INSERT INTO travel_proposals(id,user_id,trip_id,state) VALUES(${proposal.id},${user},${id},${tx.json(proposal)})`;
    return proposal;
  });
  return c.json({ success: true, data: result }, 201);
});
router.get("/proposals/:id", async (c) => {
  const id = z.uuid().parse(c.req.param("id"));
  const rows =
    await db()`SELECT state FROM travel_proposals WHERE id=${id} AND user_id=${c.get("userId")}`;
  if (!rows[0]) throw new TravelError("提案不存在", 404);
  return c.json({ success: true, data: rows[0].state });
});
router.get("/proposals/:id/agent", async (c) => {
  const id = z.uuid().parse(c.req.param("id"));
  const rows =
    await db()`SELECT state FROM travel_proposals WHERE id=${id} AND user_id=${c.get("userId")}`;
  if (!rows[0]) throw new TravelError("提案不存在", 404);
  return c.json({
    success: true,
    data: proposalReceipt(rows[0].state as TravelProposal),
  });
});
router.post("/proposals/:id/:action", async (c) => {
  const id = z.uuid().parse(c.req.param("id")),
    action = z.enum(["confirm", "reject"]).parse(c.req.param("action")),
    user = c.get("userId");
  const result = await db().begin(async (tx) => {
    const first =
      await tx`SELECT trip_id FROM travel_proposals WHERE id=${id} AND user_id=${user}`;
    if (!first[0]) throw new TravelError("提案不存在", 404);
    const trips =
      await tx`SELECT state FROM travel_trips WHERE id=${first[0].trip_id} AND user_id=${user} FOR UPDATE`;
    const rows =
      await tx`SELECT state FROM travel_proposals WHERE id=${id} AND user_id=${user} FOR UPDATE`;
    const p = rows[0]!.state as TravelProposal;
    if (p.status !== "pending") {
      if (
        (action === "confirm" && p.status !== "applied") ||
        (action === "reject" && p.status !== "rejected")
      )
        throw new TravelError("提案已处理", 409);
      return p;
    }
    if (action === "reject") p.status = "rejected";
    else {
      const trip = await legacy(
        tx as unknown as ReturnType<typeof db>,
        trips[0]!.state,
      );
      if (trip.revision !== p.revision)
        throw new TravelError("提案已过期，请让 AI 重新提出", 409);
      const next = applyOperations(trip, p.operations, "agent");
      assertDateConstraints(next, p.dateConstraints);
      await persist(
        tx as unknown as ReturnType<typeof db>,
        user,
        next,
        trips[0]!.state as KernelTrip,
      );
      await tx`INSERT INTO travel_events(id,user_id,trip_id,state) VALUES(${randomUUID()},${user},${trip.id},${tx.json({ actor: "agent-proposal", proposalId: p.id, operations: p.operations, before: trip, after: next, createdAt: new Date().toISOString() })})`;
      p.status = "applied";
      p.result = next;
    }
    p.processedAt = new Date().toISOString();
    await tx`UPDATE travel_proposals SET state=${tx.json(p)} WHERE id=${id}`;
    return p;
  });
  return c.json({ success: true, data: result });
});
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((v as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
router.route("/", amapJsRouter);
router.route("/", kernelRouter);
router.route("/", mapRouter);
router.route("/", chatRouter);
export { router as travelRouter };
