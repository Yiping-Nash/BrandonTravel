import type { MiddlewareHandler } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { verifyToken } from "../lib/jwt.js";
import { db } from "./store.js";
export const httpUsage: MiddlewareHandler = async (c, next) => {
  const started = Date.now();
  await next();
  if (c.req.path.startsWith("/travel")) return;
  let authorization = c.req.header("Authorization") ?? "";
  if (
    ["/auth/login", "/auth/register", "/auth/refresh"].includes(c.req.path) &&
    c.res.status < 400
  ) {
    try {
      const result = (await c.res.clone().json()) as {
        data?: { token?: string };
      };
      if (result.data?.token) authorization = "Bearer " + result.data.token;
    } catch {
      return;
    }
  }
  if (!authorization.startsWith("Bearer ")) return;
  try {
    const { userId, sessionId } = verifyToken(authorization.slice(7));
    const session = createHash("sha256")
      .update(sessionId ?? authorization)
      .digest("hex");
    const endpoint =
      c.req.method +
      " " +
      c.req.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id");
    await db()`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status,elapsed_ms) VALUES(${randomUUID()},${userId},${session},'internal',${endpoint},${c.req.header("X-Travel-Test") === "true" ? "acceptance" : "interactive"},${c.res.status >= 400 ? "failed" : "success"},${Date.now() - started})`;
  } catch {
    /* monitoring must not break authentication */
  }
};
