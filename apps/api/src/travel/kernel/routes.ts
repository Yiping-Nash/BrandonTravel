import { recentChanges, previewRestore, findProposal } from "./recovery.js";
import { planningContext, previewPlan } from "./planning.js";
import { calculateDemo, demoScenes } from "./demo.js";
import { TravelError } from "../domain.js";
import { mutateKernel } from "./commands.js";
import { previewPlace } from "./preview.js";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../../middleware/auth.js";
import {
  queryFacts,
  prepareOperationalFacts,
  getTripContext,
  getIntelligence,
  getIntelligenceSnapshot,
  getOperationalContext,
  refreshFacts,
  getKernelTrip,
  readRefresh,
  cancelRefresh,
  type CapabilityContext,
} from "./service.js";
export const kernelRouter = new Hono<{ Variables: AuthVariables }>();
function context(c: {
  get: (key: keyof AuthVariables) => unknown;
}): CapabilityContext {
  return {
    userId: c.get("userId") as string,
    actor: c.get("travelActor") === "agent" ? "agent" : "user",
    session: (c.get("travelSession") as string) ?? "unknown",
    purpose: "operational-facts",
  };
}
kernelRouter.get("/trips/:id/kernel", async (c) =>
  c.json({
    success: true,
    data: await getKernelTrip(context(c), z.uuid().parse(c.req.param("id"))),
  }),
);
kernelRouter.get("/trips/:id/operational-facts", async (c) =>
  c.json({
    success: true,
    data: await queryFacts(
      context(c),
      z.uuid().parse(c.req.param("id")),
      c.req.query(),
    ),
  }),
);
kernelRouter.post("/trips/:id/intelligence/refresh", async (c) =>
  c.json({
    success: true,
    data: await refreshFacts(
      context(c),
      z.uuid().parse(c.req.param("id")),
      await c.req.json(),
    ),
  }),
);

kernelRouter.get("/trips/:id/intelligence/refresh/:requestId", async (c) =>
  c.json({
    success: true,
    data: await readRefresh(
      context(c),
      z.uuid().parse(c.req.param("id")),
      z.uuid().parse(c.req.param("requestId")),
    ),
  }),
);

kernelRouter.post(
  "/trips/:id/intelligence/refresh/:requestId/cancel",
  async (c) =>
    c.json({
      success: true,
      data: await cancelRefresh(
        context(c),
        z.uuid().parse(c.req.param("id")),
        z.uuid().parse(c.req.param("requestId")),
      ),
    }),
);

kernelRouter.get("/trips/:id/intelligence", async (c) =>
  c.json({
    success: true,
    data: await getIntelligence(
      context(c),
      z.uuid().parse(c.req.param("id")),
      c.req.query(),
    ),
  }),
);
kernelRouter.get(
  "/trips/:id/activities/:activityId/operational-context",
  async (c) =>
    c.json({
      success: true,
      data: await getOperationalContext(
        context(c),
        z.uuid().parse(c.req.param("id")),
        z.uuid().parse(c.req.param("activityId")),
      ),
    }),
);

kernelRouter.post("/trips/:id/kernel/operations", async (c) =>
  c.json({
    success: true,
    data: await mutateKernel(
      context(c),
      z.uuid().parse(c.req.param("id")),
      await c.req.json(),
    ),
  }),
);
kernelRouter.post("/trips/:id/place-preview", async (c) =>
  c.json({
    success: true,
    data: await previewPlace(
      context(c),
      z.uuid().parse(c.req.param("id")),
      await c.req.json(),
    ),
  }),
);

kernelRouter.get("/trips/:id/intelligence-snapshot", async (c) =>
  c.json({
    success: true,
    data: await getIntelligenceSnapshot(
      context(c),
      z.uuid().parse(c.req.param("id")),
      c.req.query(),
    ),
  }),
);
kernelRouter.get("/intelligence-demo", (c) => {
  if (context(c).actor !== "user")
    throw new TravelError("演示仅面向登录用户", 403);
  return c.json({ success: true, data: demoScenes });
});
kernelRouter.post("/intelligence-demo", async (c) => {
  if (context(c).actor !== "user")
    throw new TravelError("演示仅面向登录用户", 403);
  return c.json({ success: true, data: calculateDemo(await c.req.json()) });
});

kernelRouter.get("/trips/:id/planning-context", async (c) =>
  c.json({
    success: true,
    data: await planningContext(
      context(c),
      z.uuid().parse(c.req.param("id")),
      c.req.query(),
    ),
  }),
);
kernelRouter.post("/trips/:id/plan-preview", async (c) =>
  c.json({
    success: true,
    data: await previewPlan(
      context(c),
      z.uuid().parse(c.req.param("id")),
      await c.req.json(),
    ),
  }),
);

kernelRouter.post("/trips/:id/prepare-operational-facts", async (c) =>
  c.json({
    success: true,
    data: await prepareOperationalFacts(
      context(c),
      z.uuid().parse(c.req.param("id")),
      await c.req.json(),
    ),
  }),
);
kernelRouter.get("/trips/:id/trip-context", async (c) =>
  c.json({
    success: true,
    data: await getTripContext(context(c), z.uuid().parse(c.req.param("id"))),
  }),
);

kernelRouter.get("/trips/:id/recent-changes", async (c) =>
  c.json({
    success: true,
    data: await recentChanges(context(c), z.uuid().parse(c.req.param("id"))),
  }),
);
kernelRouter.get("/trips/:id/proposal-request/:requestId", async (c) =>
  c.json({
    success: true,
    data: await findProposal(
      context(c),
      z.uuid().parse(c.req.param("id")),
      z.uuid().parse(c.req.param("requestId")),
    ),
  }),
);
kernelRouter.post("/trips/:id/restore-preview", async (c) =>
  c.json({
    success: true,
    data: await previewRestore(
      context(c),
      z.uuid().parse(c.req.param("id")),
      await c.req.json(),
    ),
  }),
);
