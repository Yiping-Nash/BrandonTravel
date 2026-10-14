import type {
  FactView,
  OperationalFact,
  KernelSource,
} from "@open-sunsama/types";
export const placeUrl = (poiId: string, native = false) =>
  "https://uri.amap.com/poidetail?" +
  new URLSearchParams({
    poiid: poiId,
    src: "BrandonTravel",
    callnative: native ? "1" : "0",
  });
export function PlaceLink({ poiId }: { poiId: string }) {
  return (
    <span className="inline-flex flex-wrap gap-3">
      <a
        href={placeUrl(poiId)}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        在高德查看
      </a>
      <a
        href={placeUrl(poiId, true)}
        target="_blank"
        rel="noopener noreferrer"
        className="underline md:hidden"
      >
        尝试打开高德App
      </a>
    </span>
  );
}
export function FactEvidence({
  fact: f,
  source,
}: {
  fact: FactView | OperationalFact;
  source?: KernelSource;
}) {
  const stale = "freshness" in f && f.freshness === "stale",
    v = f.value;
  const state =
    "unknownReason" in f && f.unknownReason === "WEATHER_SOURCE_RETIRED"
      ? "历史高德天气（已停用，不参与当前判断）"
      : f.status === "failed"
        ? "查询失败"
        : f.status === "missing"
          ? "供应商未提供"
          : stale
            ? "资料已过期"
            : "已取得资料";
  return (
    <div
      className="rounded border p-2 text-xs space-y-1 break-words"
      data-fact-id={f.id}
    >
      <p>
        {source?.displayName ?? "现实资料"} · {state} · 资料版本{f.version}
      </p>
      <p>
        来源：
        {v?.kind === "weather" && v.providerId
          ? "Open-Meteo / " + v.model
          : (source?.providerId ?? "高德采集记录")}{" "}
        · 查询：
        {new Date(f.retrievedAt).toLocaleString()}
      </p>
      <p>
        有效期至：{new Date(f.expiresAt).toLocaleString()}
        {!f.sourcePublishedAt &&
          v?.kind === "weather" &&
          " · 模型发布时间未提供"}
        {f.sourcePublishedAt &&
          " · 发布：" + new Date(f.sourcePublishedAt).toLocaleString()}
      </p>
      {f.retryAfter && (
        <p>失败冷却至：{new Date(f.retryAfter).toLocaleString()}</p>
      )}
      {f.error && <p>资料状态码：{f.error.code}</p>}
      {v?.kind === "place" && (
        <>
          <p>
            {v.name} · {v.address}
          </p>
          <p>
            类别：
            {
              {
                attraction: "景点",
                restaurant: "餐厅",
                hotel: "酒店",
                other: "其他",
              }[v.category]
            }{" "}
            · 电话：{v.telephone ?? "未提供"}
          </p>
        </>
      )}
      {v?.kind === "opening_hours" && (
        <>
          <p>今日营业原文：{v.today ?? "未提供"}</p>
          <p>每周营业原文：{v.weekly ?? "未提供"}</p>
          <p>原文有资料不代表适用于计划日期；可解释判断见计划检查。</p>
        </>
      )}
      {v?.kind === "route_estimate" && (
        <p>
          当前估计：{Math.round(v.distanceMeters)}米／
          {Math.ceil(v.durationSeconds / 60)}分钟，
          {v.mode === "driving" ? "驾车" : "步行"}
        </p>
      )}
      {v?.kind === "weather" && (
        <>
          <p>
            {v.regionName}（区域{v.regionCode}） ·{" "}
            {v.dataKind === "outlook"
              ? "远期趋势（不确定）"
              : v.dataKind === "daily_forecast"
                ? "日级预报"
                : "历史实况"}
          </p>
          <p>
            覆盖：{f.appliesTo.dates[0]} 至 {f.appliesTo.dates.at(-1)}
          </p>
          {v.providerId && (
            <p>
              数据署名：Open-Meteo；模型 {v.model}。
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                查看数据源
              </a>
            </p>
          )}
          {v.days.map((d) => (
            <p key={d.date}>
              {d.date}：
              {v.dataKind === "outlook" && d.temperatureDistribution
                ? "日均温度成员P10–P90 " +
                  d.temperatureDistribution.p10.toFixed(1) +
                  "–" +
                  d.temperatureDistribution.p90.toFixed(1) +
                  "℃"
                : (v.providerId ? "日级" : "日间") +
                  (d.dayCondition ?? "未知") +
                  " · " +
                  (d.lowTemperature ?? "?") +
                  "–" +
                  (d.highTemperature ?? "?") +
                  "℃"}
            </p>
          ))}
          {v.observation && (
            <p>
              {v.observation.condition ?? "未知"} ·{" "}
              {v.observation.temperature ?? "?"}℃
            </p>
          )}
        </>
      )}
      {v?.kind !== "weather" &&
        source?.providerId === "amap" &&
        source.kind === "place" && <PlaceLink poiId={source.externalId} />}
    </div>
  );
}
