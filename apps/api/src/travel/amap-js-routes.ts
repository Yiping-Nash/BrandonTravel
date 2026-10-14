import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AuthVariables } from "../middleware/auth.js";
import { db } from "./store.js";
import {
  mapConfig,
  signMapSession,
  verifyMapSession,
  styleTarget,
} from "./amap-js-security.js";
const cookie = "bt_amap_session";
const fail = (message: string) => ({ success: false, error: { message } });
export const amapJsRouter = new Hono<{ Variables: AuthVariables }>();
amapJsRouter.get("/map/config", (c) => {
  if (c.get("travelActor") !== "user")
    return c.json(fail("地图仅用于已登录网页"), 403);
  const config = mapConfig(),
    secret = process.env.JWT_SECRET;
  if (!config || !secret)
    return c.json(
      fail("尚未配置高德Web端（JS API）Key与安全密钥；Web服务Key不能替代"),
      503,
    );
  setCookie(
    c,
    cookie,
    signMapSession(
      {
        user: c.get("userId"),
        session: c.get("travelSession")!,
        expires: Date.now() + 15 * 60000,
      },
      secret,
    ),
    {
      httpOnly: true,
      sameSite: "Strict",
      secure:
        process.env.NODE_ENV === "production" ||
        c.req.header("x-forwarded-proto") === "https" ||
        new URL(c.req.url).protocol === "https:",
      path: "/",
      maxAge: 900,
    },
  );
  c.header("Cache-Control", "no-store");
  return c.json({
    success: true,
    data: {
      key: config.key,
      version: "2.0",
      serviceHost: "/api/amap-map/_AMapService",
    },
  });
});
amapJsRouter.post("/map/events", async (c) => {
  if (c.get("travelActor") !== "user")
    return c.json(fail("仅用户地图会话可记录"), 403);
  const input = z
    .object({
      event: z.enum([
        "loader_started",
        "initialized",
        "load_failed",
        "destroyed",
      ]),
      elapsedMs: z.number().int().min(0).max(120000).default(0),
    })
    .strict()
    .parse(await c.req.json());
  await log(
    c.get("userId"),
    c.get("travelSession")!,
    "amap-js-client",
    input.event,
    input.event === "load_failed" ? "failed" : "success",
    input.elapsedMs,
  );
  return c.json({ success: true, data: { recorded: true } });
});
async function log(
  user: string,
  session: string,
  provider: string,
  endpoint: string,
  status: string,
  elapsed: number,
) {
  await db()`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status,elapsed_ms) VALUES(${randomUUID()},${user},${session},${provider},${endpoint},'map-display',${status},${elapsed})`.catch(
    () => {},
  );
}
export const amapJsProxy = new Hono();
amapJsProxy.get("/_AMapService/v4/map/styles", async (c) => {
  const started = Date.now(),
    config = mapConfig(),
    secret = process.env.JWT_SECRET;
  const session = secret
    ? verifyMapSession(getCookie(c, cookie) ?? "", secret)
    : null;
  if (!session) return c.json(fail("地图会话未登录或已过期，请重试加载"), 401);
  if (!config) return c.json(fail("地图配置不可用"), 503);
  let target: URL;
  try {
    target = styleTarget(new URL(c.req.url), config);
  } catch {
    return c.json(fail("不允许的地图代理请求"), 400);
  }
  // Fixed endpoint, bounded response, no arbitrary host or domain-service forwarding.
  const slot = session.user;
  const bucket = limits.get(slot);
  if (bucket && started - bucket.since < 60000 && bucket.count >= 60)
    return c.json(fail("地图请求过于频繁"), 429);
  limits.set(
    slot,
    bucket && started - bucket.since < 60000
      ? { since: bucket.since, count: bucket.count + 1 }
      : { since: started, count: 1 },
  );
  for (const [key, value] of limits)
    if (started - value.since > 60000) limits.delete(key);
  let status = "failed";
  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok || !response.body) throw Error("upstream");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw Error("oversize");
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (text.includes(config.securityJsCode)) throw Error("secret");
    status = "success";
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const content = response.headers.get("content-type") ?? "application/json";
    return c.body(text, 200, {
      "Content-Type": /javascript/.test(content)
        ? "application/javascript; charset=utf-8"
        : "application/json; charset=utf-8",
    });
  } catch {
    return c.json(fail("高德地图样式请求失败，请重试或切换简易图"), 502);
  } finally {
    await log(
      session.user,
      session.session,
      "amap-js-proxy",
      "GET /v4/map/styles",
      status,
      Date.now() - started,
    );
  }
});
const limits = new Map<string, { since: number; count: number }>();
