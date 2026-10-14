import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
const configSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z0-9]{16,100}$/),
    securityJsCode: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/),
  })
  .strict();
export function mapConfig() {
  const file =
    process.env.TRAVEL_AMAP_JS_CONFIG ??
    path.join(
      process.env.TRAVEL_PROJECT_ROOT ?? process.cwd(),
      ".runtime/amap-js.json",
    );
  try {
    return configSchema.parse(
      JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")),
    );
  } catch {
    return null;
  }
}
export type MapSession = { user: string; session: string; expires: number };
export function signMapSession(value: MapSession, secret: string) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return (
    body + "." + createHmac("sha256", secret).update(body).digest("base64url")
  );
}
export function verifyMapSession(
  ticket: string,
  secret: string,
  now = Date.now(),
): MapSession | null {
  try {
    const [body, signature, ...extra] = ticket.split(".");
    if (!body || !signature || extra.length) return null;
    const expected = createHmac("sha256", secret).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    const value = z
      .object({
        user: z.uuid(),
        session: z.string().regex(/^[a-f0-9]{64}$/),
        expires: z.number(),
      })
      .strict()
      .parse(JSON.parse(Buffer.from(body, "base64url").toString()));
    return value.expires > now ? value : null;
  } catch {
    return null;
  }
}
const parameters = new Set([
  "key",
  "callback",
  "style",
  "styles",
  "styleid",
  "v",
  "version",
  "output",
  "language",
  "lang",
  "sdkversion",
  "logversion",
]);
export function styleTarget(
  request: URL,
  config: { key: string; securityJsCode: string },
) {
  if (
    request.pathname !== "/amap-map/_AMapService/v4/map/styles" ||
    request.search.length > 4096
  )
    throw Error("不允许的地图代理请求");
  const target = new URL("https://webapi.amap.com/v4/map/styles");
  for (const [key, value] of request.searchParams) {
    if (
      !parameters.has(key) ||
      value.length > 512 ||
      (key === "key" && value !== config.key) ||
      target.searchParams.has(key)
    )
      throw Error("不允许的地图参数");
    if (key === "callback" && !/^[A-Za-z_$][\w.$]*$/.test(value))
      throw Error("不允许的回调");
    target.searchParams.set(key, value);
  }
  target.searchParams.set("key", config.key);
  target.searchParams.set("jscode", config.securityJsCode);
  return target;
}
