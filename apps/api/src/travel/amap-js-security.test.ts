import { describe, it, expect, vi } from "vitest";
import {
  signMapSession,
  verifyMapSession,
  styleTarget,
  mapConfig,
} from "./amap-js-security.js";
vi.mock("node:fs", () => ({
  readFileSync: () => {
    throw Error("isolated missing config");
  },
}));
const secret = "isolated-test-signing-secret",
  session = {
    user: "00000000-0000-4000-8000-000000000001",
    session: "a".repeat(64),
    expires: 2000,
  };
const config = {
  key: "test-key-0123456789",
  securityJsCode: "isolated-code-0123456789",
};
describe("地图代理安全边界", () => {
  it("有效会话、过期、篡改和错误签名", () => {
    const value = signMapSession(session, secret);
    expect(verifyMapSession(value, secret, 1000)).toEqual(session);
    expect(verifyMapSession(value, secret, 2000)).toBeNull();
    expect(verifyMapSession(value + "x", secret, 1000)).toBeNull();
    expect(verifyMapSession(value, "other", 1000)).toBeNull();
  });
  it("仅固定样式端点，补入服务器密钥，不允许用户指定host", () => {
    const url = styleTarget(
      new URL(
        "http://local/amap-map/_AMapService/v4/map/styles?styleid=whitesmoke&callback=AMap.cb",
      ),
      config,
    );
    expect(url.origin).toBe("https://webapi.amap.com");
    expect(url.pathname).toBe("/v4/map/styles");
    expect(url.searchParams.get("jscode")).toBe(config.securityJsCode);
    expect(url.searchParams.get("key")).toBe(config.key);
  });
  for (const query of [
    "url=https://evil.test",
    "jscode=evil",
    "callback=alert(1)",
    "styleid=a&styleid=b",
    "key=wrong",
    "styleid=" + "a".repeat(513),
  ])
    it("拒绝参数 " + query.slice(0, 30), () =>
      expect(() =>
        styleTarget(
          new URL("http://local/amap-map/_AMapService/v4/map/styles?" + query),
          config,
        ),
      ).toThrow(),
    );
  it("地点、路线与任意代理路径被拒绝", () => {
    for (const path of [
      "/v3/place/text",
      "/v5/direction/driving",
      "/../map/styles",
    ]) {
      expect(() =>
        styleTarget(
          new URL("http://local/amap-map/_AMapService" + path),
          config,
        ),
      ).toThrow();
    }
  });
  it("缺失JS配置明确返回不可用，不复用Web服务配置", () => {
    expect(mapConfig()).toBeNull();
  });
});
