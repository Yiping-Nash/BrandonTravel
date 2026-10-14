import { useState } from "react";
import { format } from "date-fns";
import type { TravelEntity, IntelligenceSnapshot } from "@open-sunsama/types";
import { weatherLocation } from "@open-sunsama/utils/travel-weather-location";
import { wall } from "../use-travel-workspace";
import { FactEvidence } from "../fact-evidence";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
export function WeatherHeader({
  date,
  snapshot,
  entities,
  theme = "sand",
}: {
  date: string;
  snapshot: IntelligenceSnapshot | null;
  entities: TravelEntity[];
  theme?: string;
}) {
  const [open, setOpen] = useState(false);
  const day = snapshot?.days?.find((d) => d.date === date);
  const cities = new Map(
    entities
      .filter((e) => e.city && !/^\d+$/.test(e.city))
      .map((e) => [weatherLocation(e).key, e.city]),
  );
  const groups = new Map<string, NonNullable<typeof day>["regions"]>();
  for (const r of day?.regions ?? []) {
    const city =
      cities.get(r.id) ||
      [...(day?.cities ?? [])]
        .sort((a, b) => b.length - a.length)
        .find((c) => r.name === c || r.name.startsWith(c + " · ")) ||
      r.name;
    groups.set(city, [...(groups.get(city) ?? []), r]);
  }
  const rows = [...groups].map(([city, regions]) => ({
    city,
    region: regions.find((r) => r.status === "AVAILABLE"),
    regions,
  }));
  const shortReason = (status?: string) =>
    ({
      STALE: "天气已过期",
      OUT_OF_RANGE: "暂无预报",
      FAILED: "天气查询失败",
      NOT_PROVIDED: "暂无天气资料",
      MISMATCH: "天气待更新",
    })[status ?? ""] ?? "天气未查询";
  const condition = (r: NonNullable<(typeof rows)[number]["region"]>) =>
    r.forecastKind === "outlook" ? "远期趋势" : (r.dayCondition ?? "天气未知");
  const icon = (text: string) =>
    /趋势/.test(text)
      ? "◌"
      : /雷/.test(text)
        ? "⛈"
        : /雪/.test(text)
          ? "❄"
          : /雨/.test(text)
            ? "☂"
            : /雾|霾/.test(text)
              ? "≋"
              : /云|阴/.test(text)
                ? "☁"
                : /晴/.test(text)
                  ? "☀"
                  : "◌";
  return (
    <div className="bt-day-weather">
      <strong>
        <span data-weekday>
          {
            ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
              wall(date, 0).getDay()
            ]
          }
        </span>{" "}
        · <span data-date>{format(wall(date, 0), "M月d日")}</span>
      </strong>
      {!!day?.activityIds.length && (
        <button
          type="button"
          className="bt-weather-summary"
          aria-label={date + " 天气详情"}
          onClick={() => setOpen(true)}
        >
          <span className="bt-weather-inline">
            {rows.slice(0, 3).map(({ city, region, regions }, i) => (
              <span className="bt-weather-city" key={city}>
                {i > 0 && <span aria-hidden="true"> ／ </span>}
                {region && (
                  <span className="bt-weather-icon" aria-hidden="true">
                    {icon(condition(region))}
                  </span>
                )}{" "}
                {city}{" "}
                {region?.lowTemperature !== null &&
                region?.highTemperature !== null &&
                region
                  ? `${region.lowTemperature}–${region.highTemperature}°`
                  : "—"}
                {!region && <small> {shortReason(regions[0]?.status)}</small>}
              </span>
            ))}
            {rows.length > 3 && <span> ／ 另{rows.length - 3}城</span>}
            {!rows.length && "地点待确认"}
          </span>
          <span className="bt-weather-description">
            {[
              ...new Set(
                rows
                  .slice(0, 3)
                  .flatMap((r) => (r.region ? [condition(r.region)] : [])),
              ),
            ].join(" ／ ")}
          </span>
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="bt-v2 bt-modal bt-weather-dialog"
          data-theme={theme}
        >
          <DialogHeader>
            <DialogTitle>{date} 天气资料</DialogTitle>
          </DialogHeader>
          <p>{day?.weatherQuery?.message ?? "尚未取得资料"}</p>
          <p>日级资料，不代表活动时段预报或官方预警；远期趋势存在不确定性。</p>
          {day?.regions.map((r) => (
            <p key={r.id}>
              {r.name} ·{" "}
              {r.dayCondition ??
                (r.forecastKind === "outlook" ? "远期趋势" : "天气未知")}{" "}
              {r.lowTemperature !== null && r.highTemperature !== null
                ? `${r.lowTemperature}–${r.highTemperature}℃`
                : ""}{" "}
              · {r.reason}
            </p>
          ))}
          {day?.regions
            .flatMap((r) => r.factRefs)
            .filter((r, i, all) => all.findIndex((f) => f.id === r.id) === i)
            .map((ref) => {
              const fact = snapshot?.facts.find((f) => f.id === ref.id);
              return fact ? (
                <FactEvidence
                  key={ref.id}
                  fact={fact}
                  source={snapshot?.sources.find(
                    (s) => s.id === fact.sourceRefId,
                  )}
                />
              ) : null;
            })}
        </DialogContent>
      </Dialog>
    </div>
  );
}
