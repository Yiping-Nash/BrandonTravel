import type { IntelligenceSnapshot } from "@open-sunsama/types";
import { FactEvidence } from "./fact-evidence";
import { RefreshFactsButton } from "./refresh-facts-button";
export function DayWeather({
  data,
  dates,
  tripId,
  onOpen,
}: {
  data: IntelligenceSnapshot | null;
  dates: string[];
  tripId: string;
  onOpen: (id: string) => void;
}) {
  const names = (ids: string[]) =>
    ids
      .map((id) => data?.activities.find((a) => a.id === id)?.title ?? "活动")
      .join("、");
  return (
    <div className="flex flex-wrap gap-2 my-2" aria-label="每日天气">
      {dates.map((date) => {
        const day = data?.days?.find((d) => d.date === date);
        const query = day?.weatherQuery;
        const results =
          data?.evaluation.results.filter(
            (r) =>
              r.activityIds.some((id) => day?.activityIds.includes(id)) &&
              (r.state === "CONFLICT" || r.state === "WARNING"),
          ) ?? [];
        return (
          <section
            key={date}
            className="rounded border p-2 text-sm max-w-full space-y-2"
            data-weather-date={date}
          >
            <div className="font-medium">
              {date} ·{" "}
              {day?.cities.join("／") ||
                (day?.activityIds.length ? "地点待确认" : "尚无地点安排")}
            </div>
            <div>
              {day?.regions
                .filter((r) => r.status === "AVAILABLE")
                .map((r) => (
                  <p key={r.id}>
                    {r.name} ·{" "}
                    {r.forecastKind === "outlook"
                      ? "远期趋势"
                      : (r.dayCondition ?? "天气描述未知")}{" "}
                    {r.lowTemperature !== null && r.highTemperature !== null
                      ? r.lowTemperature + "–" + r.highTemperature + "℃"
                      : ""}
                    {r.trend && (
                      <span>
                        {" "}
                        · 日均温度集合P10–P90{" "}
                        {r.trend.temperature.p10.toFixed(1)}–
                        {r.trend.temperature.p90.toFixed(1)}℃ · 日降水{" "}
                        {r.trend.precipitation.p10.toFixed(1)}–
                        {r.trend.precipitation.p90.toFixed(1)}毫米
                      </span>
                    )}
                  </p>
                ))}
            </div>
            <p>
              {query?.message ??
                (data ? "正在准备日期资料" : "天气与路程检查正在读取")}
            </p>
            {query?.canQuery && (
              <RefreshFactsButton
                tripId={tripId}
                date={date}
                kinds={["weather"]}
                label="获取当天天气"
              />
            )}
            {!!query?.locateActivityIds.length && (
              <ButtonLink onClick={() => onOpen(query.locateActivityIds[0]!)}>
                为未定位活动绑定地点
              </ButtonLink>
            )}
            {day?.activityIds.length ? (
              <details>
                <summary>天气来源与详情</summary>
                <div className="max-h-60 overflow-auto space-y-2">
                  <p>
                    日级预报或远期集合趋势，不表示活动时段天气或官方预警。
                    {day.regions.length}
                    个天气区域
                  </p>
                  {!!day.unlocatedCount && (
                    <p>
                      {day.unlocatedCount}
                      项活动尚未确认地点；不影响其他区域已取得的天气。
                    </p>
                  )}
                  {day.regions.map((r) => (
                    <article key={r.id}>
                      <p>
                        {r.name}：{r.reason}
                        {r.trend && (
                          <span>
                            {" "}
                            · ECMWF EC46，{r.trend.members}个成员，约
                            {r.trend.resolutionKm}
                            公里区域尺度，未做偏差校正；P10–P90是成员分布而非保证范围。
                          </span>
                        )}
                      </p>
                      {r.factRefs.map((ref) => {
                        const f = data?.facts.find(
                          (f) => f.id === ref.id && f.version === ref.version,
                        );
                        return (
                          f && (
                            <FactEvidence
                              key={ref.id}
                              fact={f}
                              source={data?.sources.find(
                                (s) => s.id === f.sourceRefId,
                              )}
                            />
                          )
                        );
                      })}
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
            {!!day?.activityIds.length && (
              <details>
                <summary>
                  当天注意事项
                  {results.length
                    ? " · " + results.length + "项冲突或提醒"
                    : ""}
                </summary>
                <div className="space-y-2 max-h-60 overflow-auto">
                  {results.map((r) => (
                    <p
                      key={r.id}
                      className={
                        r.state === "CONFLICT"
                          ? "text-red-700"
                          : "text-amber-700"
                      }
                    >
                      {r.state === "CONFLICT" ? "冲突" : "提醒"} ·{" "}
                      {names(r.activityIds)} ·{" "}
                      {r.rule === "OVERLAP"
                        ? "重叠" + r.details.overlapMinutes + "分钟"
                        : r.rule === "TRANSITION_GAP"
                          ? "路程不足" + r.details.shortageMinutes + "分钟"
                          : r.rule === "OPENING_COVERAGE"
                            ? "营业时间不覆盖安排"
                            : "日级强降雨提醒"}
                      <ButtonLink onClick={() => onOpen(r.activityIds[0]!)}>
                        查看活动
                      </ButtonLink>
                    </p>
                  ))}
                  {day.informationGaps?.map((g) => (
                    <div
                      key={g.kind + g.action}
                      className="text-muted-foreground"
                    >
                      <p>
                        {
                          {
                            place: "地点待绑定",
                            weather: "天气资料待取得或核实",
                            hours: "营业资料待取得或核实",
                            route: "路程资料待取得或核实",
                            environment: "天气影响检查需指定室内／户外",
                          }[g.kind]
                        }{" "}
                        · {g.activityIds.length}项活动
                      </p>
                      {g.action === "QUERY" && g.kind === "route" ? (
                        <RefreshFactsButton
                          tripId={tripId}
                          date={date}
                          kinds={["route_estimate"]}
                          label="获取当天路程"
                        />
                      ) : g.action === "QUERY" && g.kind === "hours" ? (
                        <RefreshFactsButton
                          tripId={tripId}
                          date={date}
                          kinds={["opening_hours"]}
                          label="获取当天营业资料"
                        />
                      ) : g.action === "QUERY" &&
                        g.kind === "weather" ? null : (
                        <ButtonLink onClick={() => onOpen(g.activityIds[0]!)}>
                          {g.action === "LOCATE"
                            ? "绑定地点"
                            : g.action === "ENVIRONMENT"
                              ? "指定环境（不影响查看预报）"
                              : "查看资料来源"}
                        </ButtonLink>
                      )}
                    </div>
                  ))}
                  {!results.length && !day.informationGaps?.length && (
                    <p>当前检查没有需处理事项；具体检查范围见计划状态。</p>
                  )}
                </div>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
function ButtonLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="underline ml-1" onClick={onClick}>
      {children}
    </button>
  );
}
