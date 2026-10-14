// Sprint09 isolated provider probes: no model import/call, no plan mutation.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
if (!process.argv.includes("--execute-authorized-probes"))
  throw Error(
    "此脚本会消耗外部API额度；需要显式执行标记，且不能重复已执行账本。",
  );
const dir = ".runtime/research-sprint09",
  ledgerPath = dir + "/amap-budget.json";
mkdirSync(dir, { recursive: true });
mkdirSync("verification", { recursive: true });
const parse = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
if (existsSync(ledgerPath) && parse(ledgerPath).reserved !== 0)
  throw Error("已有本轮实际请求账本；禁止自动重复。检查证据后另行决定。");
const cfg = parse(".runtime/config.json"),
  account = parse(".runtime/test-account.json"),
  key = parse(".runtime/amap.json").apiKey;
const pg = (await import("../apps/api/node_modules/postgres/src/index.js"))
  .default;
const sql = pg(
  `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
  { max: 1 },
);
const evidence = {
  date: new Date().toISOString(),
  kind: "real-provider-research",
  status: "running",
  modelRequests: 0,
  amapRequests: 0,
  counts: { place: 0, weather: 0, route: 0, reserve: 0 },
  samples: [],
  checks: [],
};
const persist = () => {
  writeFileSync(
    ledgerPath,
    JSON.stringify(
      {
        maximum: 20,
        reserved: evidence.amapRequests,
        counts: evidence.counts,
        modelRequests: 0,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    dir + "/provider-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
};
const hash = (rows) =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");
try {
  const r = await fetch("http://127.0.0.1:4332/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(r.ok, "本地登录失败");
  const login = (await r.json()).data;
  const payload = JSON.parse(
    Buffer.from(login.token.split(".")[1], "base64url"),
  );
  const session = createHash("sha256")
    .update(payload.sessionId ?? "Bearer " + login.token)
    .digest("hex");
  evidence.userId = login.user.id;
  evidence.sessionId = session;
  const before =
    await sql`SELECT id,state FROM travel_trips WHERE user_id=${login.user.id} ORDER BY id`;
  evidence.planBefore = { count: before.length, sha256: hash(before) };
  persist();
  async function probe(name, category, endpoint, params) {
    const caps = { place: 12, weather: 4, route: 2, reserve: 2 };
    assert.ok(
      evidence.amapRequests < 20 && evidence.counts[category] < caps[category],
      "预算已到上限",
    );
    evidence.amapRequests++;
    evidence.counts[category]++;
    persist();
    const id = randomUUID(),
      started = Date.now();
    await sql`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status) VALUES(${id},${login.user.id},${session},'amap',${endpoint},'sprint09-research','running')`;
    let data = null,
      error = null,
      httpStatus = null;
    try {
      const url = new URL("https://restapi.amap.com" + endpoint);
      url.search = new URLSearchParams({ ...params, key }).toString();
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      httpStatus = res.status;
      data = await res.json();
      if (!res.ok || data.status !== "1")
        error = `HTTP ${res.status}; ${data.infocode ?? "unknown"} ${data.info ?? "未知供应商错误"}`;
    } catch {
      error = "请求超时、网络失败或响应非JSON";
    }
    const status = error ? "failed" : "success",
      elapsedMs = Date.now() - started;
    await sql`UPDATE travel_api_usage SET status=${status},elapsed_ms=${elapsedMs},error=${error} WHERE id=${id}`;
    // Deliberately omit key, request URL, phone numbers and unrelated vendor fields.
    const sample = {
      name,
      category,
      endpoint,
      params,
      status,
      httpStatus,
      elapsedMs,
      queriedAt: new Date().toISOString(),
      infocode: data?.infocode ?? null,
      info: data?.info ?? null,
    };
    if (data?.pois)
      sample.pois = data.pois.map((p) => ({
        id: p.id,
        name: p.name,
        address: p.address,
        location: p.location,
        type: p.type,
        typecode: p.typecode,
        adcode: p.adcode,
        citycode: p.citycode,
        cityname: p.cityname,
        business: p.business
          ? {
              opentime_today: p.business.opentime_today ?? null,
              opentime_week: p.business.opentime_week ?? null,
            }
          : null,
      }));
    if (data?.lives) sample.lives = data.lives;
    if (data?.forecasts) sample.forecasts = data.forecasts;
    if (data?.route)
      sample.route = {
        origin: data.route.origin,
        destination: data.route.destination,
        paths: data.route.paths?.map((p) => ({
          distance: p.distance,
          duration: p.duration,
          cost: p.cost ? { duration: p.cost.duration } : null,
        })),
      };
    if (error) sample.error = error;
    evidence.samples.push(sample);
    persist();
    console.log(
      JSON.stringify({
        name,
        status,
        count: evidence.amapRequests,
        pois: sample.pois?.length,
        hours: sample.pois?.filter(
          (p) => p.business?.opentime_today || p.business?.opentime_week,
        ).length,
        dates: sample.forecasts?.flatMap((f) => f.casts?.map((c) => c.date)),
      }),
    );
    return sample;
  }
  const v3 = await probe("大同华严寺-v3基线", "place", "/v3/place/text", {
    keywords: "华严寺",
    city: "大同",
    citylimit: "true",
    offset: "3",
    page: "1",
    extensions: "all",
  });
  const place = (name, keywords, region) =>
    probe(name, "place", "/v5/place/text", {
      keywords,
      region,
      city_limit: "true",
      page_size: "3",
      page_num: "1",
      show_fields: "business",
    });
  const huayan = await place("大同华严寺-v5", "华严寺", "大同");
  const shanhua = await place("大同善化寺-v5", "善化寺", "大同");
  const restaurant = await place("大同餐厅-v5", "龙聚祥烧麦馆", "大同");
  await place("大同酒店-v5", "大同宾馆", "大同");
  await place("大同公园-v5", "御河生态园", "大同");
  if (huayan.pois?.[0]?.id)
    await probe("华严寺-ID详情", "place", "/v5/place/detail", {
      id: huayan.pois[0].id,
      show_fields: "business",
    });
  if (restaurant.pois?.[0]?.id)
    await probe("餐厅-ID详情", "place", "/v5/place/detail", {
      id: restaurant.pois[0].id,
      show_fields: "business",
    });
  await probe("大同天气实况", "weather", "/v3/weather/weatherInfo", {
    city: "140200",
    extensions: "base",
    output: "JSON",
  });
  await probe("大同天气预报", "weather", "/v3/weather/weatherInfo", {
    city: "140200",
    extensions: "all",
    output: "JSON",
  });
  await probe("北京天气预报-区域对照", "weather", "/v3/weather/weatherInfo", {
    city: "110000",
    extensions: "all",
    output: "JSON",
  });
  const origin = huayan.pois?.[0]?.location,
    destination = shanhua.pois?.[0]?.location;
  if (typeof origin === "string" && typeof destination === "string") {
    await probe("华严寺至善化寺-步行", "route", "/v5/direction/walking", {
      origin,
      destination,
      show_fields: "cost",
    });
    await probe("华严寺至善化寺-驾车", "route", "/v5/direction/driving", {
      origin,
      destination,
      show_fields: "cost",
      strategy: "32",
    });
  }
  const after =
    await sql`SELECT id,state FROM travel_trips WHERE user_id=${login.user.id} ORDER BY id`;
  evidence.planAfter = { count: after.length, sha256: hash(after) };
  assert.equal(
    evidence.planAfter.sha256,
    evidence.planBefore.sha256,
    "用户计划发生意外变化",
  );
  evidence.usage =
    await sql`SELECT provider,status,count(*)::int AS count FROM travel_api_usage WHERE user_id=${login.user.id} AND session_id=${session} GROUP BY provider,status ORDER BY provider,status`;
  const logged = evidence.usage
    .filter((x) => x.provider === "amap")
    .reduce((n, x) => n + x.count, 0);
  assert.equal(logged, evidence.amapRequests);
  assert.equal(evidence.usage.filter((x) => x.provider === "model").length, 0);
  evidence.checks.push(
    { name: "请求账本与本次登录数据库日志一致", passed: true },
    { name: "计划状态及revision未改变", passed: true },
    { name: "零模型调用", passed: true },
  );
  evidence.status = "complete";
  persist();
} catch (e) {
  evidence.status = "failed";
  evidence.error = e instanceof Error ? e.message : "研究运行失败";
  persist();
  throw e;
} finally {
  await sql.end();
}
