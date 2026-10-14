import { Hono } from "hono";
import type * as SecurityModule from "./amap-js-security.js";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { amapJsProxy, amapJsRouter } from "./amap-js-routes.js";
import { signMapSession } from "./amap-js-security.js";
import type { AuthVariables } from "../middleware/auth.js";
const test = vi.hoisted(() => ({
  config: {
    key: "fixture-key-0123456789",
    securityJsCode: "fixture-code-0123456789",
  },
  log: vi.fn(async () => []),
}));
vi.mock("./store.js", () => ({ db: () => test.log }));
vi.mock("./amap-js-security.js", async (original) => ({
  ...(await original<typeof SecurityModule>()),
  mapConfig: () => test.config,
}));
const user = "00000000-0000-4000-8000-000000000045",
  session = "c".repeat(64),
  secret = "isolated-map-router-secret";
function cookie() {
  return (
    "bt_amap_session=" +
    signMapSession({ user, session, expires: Date.now() + 60000 }, secret)
  );
}
const proxy = new Hono().route("/amap-map", amapJsProxy);
function app(actor: "user" | "agent" = "user") {
  const a = new Hono<{ Variables: AuthVariables }>();
  a.use("*", async (c, next) => {
    c.set("userId", user);
    c.set("travelSession", session);
    c.set("travelActor", actor);
    await next();
  });
  return a.route("/travel", amapJsRouter);
}
beforeEach(() => {
  vi.stubEnv("JWT_SECRET", secret);
  test.log.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("真实地图HTTP边界（模拟上游）", () => {
  it("配置返回公钥和HttpOnly会话，不返回安全密钥", async () => {
    const r = await app().request("/travel/map/config");
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain(test.config.securityJsCode);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    expect(r.headers.get("set-cookie")).toContain("SameSite=Strict");
  });
  it("Agent不读取显示凭据", async () =>
    expect((await app("agent").request("/travel/map/config")).status).toBe(
      403,
    ));
  it("未认证/伪造会话、非法目标不发HTTP", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (await proxy.request("/amap-map/_AMapService/v4/map/styles")).status,
    ).toBe(401);
    expect(
      (
        await proxy.request("/amap-map/_AMapService/v4/map/styles", {
          headers: { Cookie: "bt_amap_session=wrong" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await proxy.request("/amap-map/_AMapService/v5/direction/driving", {
          headers: { Cookie: cookie() },
        })
      ).status,
    ).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("合法样式代理固定目标，记录会话且不公开密钥", async () => {
    const fetch = vi.fn(
      async () =>
        new Response('{"style":"fixture"}', {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const r = await proxy.request(
      "/amap-map/_AMapService/v4/map/styles?styleid=whitesmoke",
      { headers: { Cookie: cookie() } },
    );
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain(test.config.securityJsCode);
    const target = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(target[0].origin).toBe("https://webapi.amap.com");
    expect(target[1].redirect).toBe("error");
    expect(test.log).toHaveBeenCalled();
  });
  it("用户注入参数被拒绝且无外部调用", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await proxy.request(
          "/amap-map/_AMapService/v4/map/styles?url=https://evil.test",
          { headers: { Cookie: cookie() } },
        )
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("上游失败或响应泄密返回安全错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(test.config.securityJsCode)),
    );
    const r = await proxy.request("/amap-map/_AMapService/v4/map/styles", {
      headers: { Cookie: cookie() },
    });
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain(test.config.securityJsCode);
  });
  it("浏览器事件只允许枚举，不收集坐标和任意错误正文", async () => {
    const a = app();
    expect(
      (
        await a.request("/travel/map/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "initialized", elapsedMs: 10 }),
        })
      ).status,
    ).toBe(200);
    expect(test.log).toHaveBeenCalled();
  });
});
