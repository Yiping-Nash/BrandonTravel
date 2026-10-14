import { readFileSync } from "node:fs";
import type {
  TravelTrip,
  TravelEntity,
  TravelMode,
  TravelEstimate,
} from "@open-sunsama/types";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./store.js";
import { TravelError } from "./domain.js";
export type UsageContext = { user: string; session?: string; purpose?: string };
type AmapResponse = {
  status: string;
  info?: string;
  infocode?: string;
  pois?: Record<string, unknown>[];
  route?: {
    paths?: {
      distance?: string;
      duration?: string;
      cost?: { duration?: string };
    }[];
  };
};
export async function amapRequest(
  endpoint: string,
  params: Record<string, string>,
  ctx: UsageContext,
  fetcher: typeof fetch = fetch,
): Promise<AmapResponse> {
  let apiKey: string;
  try {
    apiKey = JSON.parse(
      readFileSync(process.env.TRAVEL_AMAP_CONFIG!, "utf8").replace(
        /^\uFEFF/,
        "",
      ),
    ).apiKey;
  } catch {
    throw new TravelError("未配置高德Web服务Key", 503);
  }
  if (!apiKey) throw new TravelError("未配置高德Web服务Key", 503);
  const provider =
    process.env.TRAVEL_MOCK_PROVIDERS === "true" ? "amap-mock" : "amap";
  const id = randomUUID(),
    started = Date.now();
  await db()`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status) VALUES(${id},${ctx.user},${ctx.session ?? "acceptance"},${provider},${endpoint},${ctx.purpose ?? "interactive"},'running')`;
  try {
    const url = new URL("https://restapi.amap.com" + endpoint);
    url.search = new URLSearchParams({ ...params, key: apiKey }).toString();
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new TravelError("高德服务暂不可用", 502);
    const data = (await response.json()) as AmapResponse;
    if (data.status !== "1")
      throw new TravelError(
        `高德查询失败（${data.infocode ?? "unknown"}）：${data.info ?? "未知错误"}`,
        502,
      );
    await db()`UPDATE travel_api_usage SET status='success',elapsed_ms=${Date.now() - started} WHERE id=${id}`;
    return data;
  } catch (error) {
    const message =
      error instanceof TravelError ? error.message : "高德请求超时或网络失败";
    await db()`UPDATE travel_api_usage SET status='failed',elapsed_ms=${Date.now() - started},error=${message} WHERE id=${id}`;
    throw new TravelError(message, 502);
  }
}
function selectionProof(user: string, entity: TravelEntity) {
  const { selectionProof: _proof, ...data } = entity;
  return createHmac("sha256", process.env.JWT_SECRET!)
    .update(JSON.stringify([user, data]))
    .digest("hex");
}
export function verifyPlaceSelection(
  user: string,
  entity: TravelEntity,
  trip: TravelTrip,
) {
  if (
    trip.entities?.some(
      (e) =>
        e.id === entity.id &&
        e.poiId === entity.poiId &&
        e.longitude === entity.longitude &&
        e.latitude === entity.latitude &&
        e.name === entity.name &&
        e.address === entity.address,
    )
  )
    return;
  const expected = selectionProof(user, entity),
    received = entity.selectionProof;
  if (
    !received ||
    received.length !== 64 ||
    !timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(received, "hex"),
    ) ||
    Date.now() - Date.parse(entity.selectedAt) > 30 * 60 * 1000
  )
    throw new TravelError("地点候选已过期或未经查询确认，请重新搜索", 422);
}
export async function searchPlaces(
  query: string,
  city: string,
  ctx: UsageContext,
): Promise<TravelEntity[]> {
  const data = await amapRequest(
    "/v3/place/text",
    {
      keywords: query,
      city,
      citylimit: "true",
      offset: "10",
      page: "1",
      extensions: "base",
    },
    ctx,
  );
  const places: TravelEntity[] = (data.pois ?? []).flatMap((p) => {
    const [longitude, latitude] = String(p.location ?? "")
      .split(",")
      .map(Number);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    return [
      {
        id: randomUUID(),
        provider: "amap" as const,
        poiId: String(p.id),
        name: String(p.name),
        address: typeof p.address === "string" ? p.address : "",
        city: typeof p.cityname === "string" ? p.cityname : city,
        longitude: longitude!,
        latitude: latitude!,
        coordinateSystem: "GCJ-02" as const,
        selectedAt: new Date().toISOString(),
      },
    ];
  });
  return places.map((e) => ({
    ...e,
    selectionProof: selectionProof(ctx.user, e),
  }));
}
export function parseRoute(
  data: AmapResponse,
  fingerprint: string,
): TravelEstimate {
  const path = data.route?.paths?.[0];
  if (
    !path ||
    typeof path.distance !== "string" ||
    !path.distance.trim() ||
    typeof (path.cost?.duration ?? path.duration) !== "string" ||
    !String(path.cost?.duration ?? path.duration).trim()
  )
    throw new TravelError("高德未返回可用路线", 502);
  const distance = Number(path?.distance),
    duration = Number(path?.cost?.duration ?? path?.duration);
  if (
    !path ||
    !Number.isFinite(distance) ||
    !Number.isFinite(duration) ||
    distance < 0 ||
    duration < 0
  )
    throw new TravelError("高德未返回可用路线", 502);
  return {
    fingerprint,
    status: "ready",
    distanceMeters: distance,
    durationSeconds: duration,
    queriedAt: new Date().toISOString(),
    source: "amap",
  };
}
export async function estimateRoute(
  from: TravelEntity,
  to: TravelEntity,
  mode: TravelMode,
  fingerprint: string,
  ctx: UsageContext,
): Promise<TravelEstimate> {
  const params: Record<string, string> = {
    origin: `${from.longitude},${from.latitude}`,
    destination: `${to.longitude},${to.latitude}`,
    show_fields: "cost",
  };
  if (mode === "driving") params.strategy = "32";
  return parseRoute(
    await amapRequest(`/v5/direction/${mode}`, params, ctx),
    fingerprint,
  );
}
