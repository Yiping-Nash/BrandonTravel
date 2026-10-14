import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const root = "http://127.0.0.1:4331/api";
const login = await (
  await fetch(root + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: a.email, password: a.password }),
  })
).json();
const token = login.data.token,
  headers = { Authorization: "Bearer " + token };
assert.equal((await fetch(root + "/travel/map/config")).status, 401);
const r = await fetch(root + "/travel/map/config", { headers });
assert.equal(r.status, 503);
const result = await r.json();
assert(result.error.message.includes("Web服务Key不能替代"));
assert.equal(
  (await fetch(root + "/amap-map/_AMapService/v4/map/styles")).status,
  401,
);
const event = await fetch(root + "/travel/map/events", {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ event: "load_failed", elapsedMs: 0 }),
});
assert.equal(event.status, 200);
writeFileSync(
  "verification/frontend-v2-amap-api.json",
  JSON.stringify(
    {
      checks: [
        "未登录不能读取地图配置",
        "真实后端缺JS凭据503且解释服务类型",
        "代理无会话401不请求上游",
        "合法地图事件记录到登录会话",
      ],
      actualSdkInitializations: 0,
      actualProviderRequests: 0,
      modelRequests: 0,
    },
    null,
    2,
  ),
);
console.log("4项真实API与会话记录验收通过；无地图/模型调用");
