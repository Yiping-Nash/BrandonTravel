import { useEffect, useState, useRef } from "react";
import type {
  TravelTrip,
  TravelTransition,
  TravelOperation,
  IntelligenceConnection,
} from "@open-sunsama/types";
import { travelApi } from "./api";
import { Button } from "@/components/ui";
import { AmapMap } from "./amap-map";
import { DirectionMap } from "./direction-map";
export function TransitionPanel({
  trip,
  mapPreferenceKey,
  connections,
  preferenceKey,
  selected,
  onSelect,
  onMutate,
  onTransitions,
  focusRequest,
}: {
  mapPreferenceKey?: string;
  focusRequest?: { activityId: string; nonce: number };
  trip: TravelTrip;
  connections?: IntelligenceConnection[];
  preferenceKey: string;
  selected: string;
  onSelect: (id: string) => void;
  onMutate: (ops: TravelOperation[]) => Promise<void>;
  onTransitions: (ts: TravelTransition[]) => void;
}) {
  const [mapMode, setMapMode] = useState<"simple" | "amap">(() =>
    mapPreferenceKey &&
    localStorage.getItem(mapPreferenceKey + ":mode") === "amap"
      ? "amap"
      : "simple",
  );
  const changeMode = (mode: "simple" | "amap") => {
    setMapMode(mode);
    if (mapPreferenceKey)
      localStorage.setItem(mapPreferenceKey + ":mode", mode);
  };
  const viewKey = trip.id + ":" + trip.revision;
  const currentView = useRef(viewKey);
  currentView.current = viewKey;
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(preferenceKey) === "expanded",
  );
  const [rows, setRows] = useState<TravelTransition[]>([]),
    [date, setDate] = useState(trip.startDate),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      generation = 0;
    setLoading(false);
    setError("");
    setRows([]);
    const load = async () => {
      const request = ++generation;
      try {
        const data = await travelApi<TravelTransition[]>(
          `/trips/${trip.id}/transitions`,
        );

        if (alive && request === generation) {
          setRows(data);
          onTransitions(data);
        }
      } catch (e) {
        if (alive && request === generation)
          setError(e instanceof Error ? e.message : "路程查询失败");
      }
    };
    void load();
    const updated = () => void load();
    window.addEventListener("travel-facts-updated", updated);
    const poll = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      alive = false;
      window.removeEventListener("travel-facts-updated", updated);
      clearInterval(poll);
    };
  }, [trip.id, trip.revision]);
  useEffect(() => {
    const activity = trip.activities.find((a) => a.id === selected);
    if (activity?.date && date !== "all") setDate(activity.date);
  }, [selected, trip.id, trip.revision]);
  async function refresh() {
    const capturedView = viewKey;
    setLoading(true);
    setError("");
    try {
      const data = await travelApi<TravelTransition[]>(
        `/trips/${trip.id}/transitions/refresh`,
        "POST",
        { force: true },
      );
      window.dispatchEvent(new Event("travel-facts-updated"));
      if (currentView.current === capturedView) {
        setRows(data);
        onTransitions(data);
      }
    } catch (e) {
      if (currentView.current === capturedView)
        setError(e instanceof Error ? e.message : "刷新失败");
    } finally {
      if (currentView.current === capturedView) setLoading(false);
    }
  }
  useEffect(() => {
    if (!focusRequest) return;
    const activity = trip.activities.find(
      (a) => a.id === focusRequest.activityId,
    );
    if (activity?.date) setDate(activity.date);
    setExpanded(true);
  }, [focusRequest?.nonce]);
  const dates = [
    ...new Set(trip.activities.flatMap((a) => (a.date ? [a.date] : []))),
  ].sort();
  const shown = rows.filter((t) => date === "all" || t.date === date);
  return (
    <section className="travel-route-panel">
      <div className="travel-route-heading">
        <div>
          <h2>方位与路程</h2>
          <p>
            {rows.length}段连接 ·{" "}
            {connections?.filter((r) => (r.shortageMinutes ?? 0) > 0).length ??
              0}
            处时间不足 ·{" "}
            {mapMode === "amap" && mapPreferenceKey ? "高德底图" : "北向上示意"}
          </p>
        </div>
        <Button
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            localStorage.setItem(
              preferenceKey,
              next ? "expanded" : "collapsed",
            );
          }}
        >
          {expanded ? "收起" : "展开方位与路程"}
        </Button>
        {expanded && (
          <>
            <select
              aria-label="方位图日期"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            >
              <option value="all">全行程概览</option>
              {dates.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void refresh()}
            >
              {loading ? "查询中…" : "刷新高德路程"}
            </Button>
          </>
        )}
      </div>
      {expanded && (
        <>
          {mapPreferenceKey && (
            <label className="travel-map-switch">
              地图{" "}
              <select
                aria-label="地图模式"
                value={mapMode}
                onChange={(e) =>
                  changeMode(e.target.value as "simple" | "amap")
                }
              >
                <option value="simple">简易图</option>
                <option value="amap">高德地图</option>
              </select>
            </label>
          )}
          {mapPreferenceKey && mapMode === "amap" ? (
            <AmapMap
              trip={trip}
              date={date}
              rows={shown}
              connections={connections}
              selected={selected}
              onSelect={onSelect}
              onFallback={() => changeMode("simple")}
              preferenceKey={mapPreferenceKey}
            />
          ) : (
            <DirectionMap
              trip={trip}
              date={date}
              rows={shown}
              selected={selected}
              onSelect={onSelect}
            />
          )}

          <div className="travel-route-list">
            {shown.map((t) => {
              const from = trip.activities.find((a) => a.id === t.fromId)!,
                to = trip.activities.find((a) => a.id === t.toId)!,
                check = connections?.find((c) => c.id === t.id);
              return (
                <article
                  key={t.id}
                  className={
                    (check?.shortageMinutes ?? 0) > 0
                      ? "travel-route-short"
                      : ""
                  }
                >
                  <button
                    className="travel-route-pair"
                    onClick={() => onSelect(from.id)}
                  >
                    {from.title} <span>→</span> {to.title}
                  </button>
                  <select
                    aria-label={`交通方式 ${from.title} 到 ${to.title}`}
                    value={t.mode}
                    onChange={(e) =>
                      void onMutate([
                        {
                          type: "transition_mode",
                          fromId: t.fromId,
                          toId: t.toId,
                          mode: e.target.value as "walking" | "driving",
                        },
                      ]).catch(() => {})
                    }
                  >
                    <option value="driving">驾车</option>
                    <option value="walking">步行</option>
                  </select>
                  <strong>
                    {check?.durationSeconds !== null &&
                    check?.durationSeconds !== undefined
                      ? `${check.distanceMeters === null ? "距离未知" : (check.distanceMeters / 1000).toFixed(1) + "公里"} · 约${Math.ceil(check.durationSeconds / 60)}分钟`
                      : check?.reasonCode === "FACT_STALE"
                        ? "路程未知（估计已过期）"
                        : check?.reasonCode === "FACT_MISSING"
                          ? "路程未查询"
                          : check
                            ? "路程未知，查看来源"
                            : "检查正在读取"}
                  </strong>
                  <span>
                    空档
                    {check?.gapSeconds === null ||
                    check?.gapSeconds === undefined
                      ? "待检查"
                      : check.gapSeconds / 60}
                    分钟
                    {(check?.shortageMinutes ?? 0) > 0
                      ? ` · 少${check?.shortageMinutes}分钟`
                      : ""}
                  </span>
                  <details>
                    <summary>
                      来源与详情 {t.freshness === "stale" ? "· 已过期" : ""}
                    </summary>
                    <p>
                      {t.fingerprint
                        ? (t.estimate?.error ?? "高德预计值，非实际到达保证")
                        : "两端地点尚未完整确认"}
                    </p>
                    {t.estimate && (
                      <time>
                        {new Date(t.estimate.queriedAt).toLocaleString()}
                      </time>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {!expanded && rows.some((r) => (r.shortageMinutes ?? 0) > 0) && (
        <p className="travel-route-short">
          有连接时间不足，请查看时间表提示或展开详情。
        </p>
      )}
      {expanded && !shown.length && (
        <p>
          同一天至少安排两个活动后显示连接。未确认地点的连接会保留并显示未知。
        </p>
      )}
    </section>
  );
}
