import { useEffect, useMemo, useRef, useState } from "react";
import type {
  TravelTrip,
  TravelTransition,
  IntelligenceConnection,
} from "@open-sunsama/types";
import { Button } from "@/components/ui";
import { travelApi } from "./api";
import { mapPoints } from "./map-points";
import {
  loadAMap,
  type AMapAPI,
  type MapInstance,
  type Overlay,
  type MapConfig,
} from "./amap-loader";
export type MapStyle = "whitesmoke" | "normal" | "light" | "grey";
export type BaseMap = "simple" | "satellite";
const styles: Record<MapStyle, string> = {
  whitesmoke: "远山黛",
  normal: "标准",
  light: "月光银",
  grey: "雅士灰",
};
function event(
  event: "loader_started" | "initialized" | "load_failed" | "destroyed",
  elapsedMs = 0,
) {
  void travelApi("/map/events", "POST", {
    event,
    elapsedMs: Math.min(120000, Math.max(0, Math.round(elapsedMs))),
  }).catch(() => {});
}
export function AmapMap({
  trip,
  date,
  rows,
  connections,
  selected,
  onSelect,
  onFallback,
  preferenceKey,
}: {
  trip: TravelTrip;
  date: string;
  rows: TravelTransition[];
  connections?: IntelligenceConnection[];
  selected: string;
  onSelect: (id: string) => void;
  onFallback: () => void;
  preferenceKey: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<{ api: AMapAPI; map: MapInstance } | null>(null),
    overlays = useRef<Overlay[]>([]),
    markers = useRef<Overlay[]>([]),
    lastFit = useRef("");
  const [attempt, setAttempt] = useState(0),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [style, setStyle] = useState<MapStyle>(() => {
    const saved = localStorage.getItem(preferenceKey + ":style");
    return saved && Object.hasOwn(styles, saved)
      ? (saved as MapStyle)
      : "whitesmoke";
  });
  const [base, setBase] = useState<BaseMap>(() =>
    localStorage.getItem(preferenceKey + ":base") === "satellite"
      ? "satellite"
      : "simple",
  );
  const points = useMemo(() => mapPoints(trip, date), [trip, date]);
  const [overlap, setOverlap] = useState<string | null>(null);
  const groups = useMemo(() => {
    const values = new Map<string, typeof points.items>();
    for (const item of points.items) {
      const key = item.entity.longitude + "," + item.entity.latitude;
      values.set(key, [...(values.get(key) ?? []), item]);
    }
    return values;
  }, [points]);
  const choose = useRef(onSelect);
  choose.current = onSelect;
  useEffect(() => {
    let alive = true,
      instance: MapInstance | null = null,
      timeout: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController(),
      started = performance.now();
    setReady(false);
    setError("");
    lastFit.current = "";
    const init = async () => {
      event("loader_started");
      try {
        const config = await travelApi<MapConfig>(
          "/map/config",
          "GET",
          undefined,
          controller.signal,
        );
        const api = await loadAMap(config);
        if (!alive || !host.current) return;
        instance = new api.Map(host.current, {
          viewMode: "2D",
          zoom: 11,
          mapStyle: "amap://styles/whitesmoke",
          features: ["bg", "road", "building"],
          showIndoorMap: false,
        });
        engine.current = { api, map: instance };
        instance.addControl(new api.Scale());
        instance.addControl(new api.ToolBar());
        const complete = () => {
          if (alive) {
            clearTimeout(timeout);
            setReady(true);
            event("initialized", performance.now() - started);
          }
        };
        instance.on("complete", complete);
        timeout = setTimeout(() => {
          if (alive) {
            setError("高德底图加载超时，请重试或使用简易图");
            event("load_failed", performance.now() - started);
          }
        }, 15000);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "地图加载失败");
          event("load_failed", performance.now() - started);
        }
      }
    };
    void init();
    const renew = setInterval(() => {
      if (!document.hidden) void travelApi("/map/config").catch(() => {});
    }, 10 * 60000);
    const resume = () => {
      if (!document.hidden) void travelApi("/map/config").catch(() => {});
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(renew);
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", resume);
      instance?.destroy();
      engine.current = null;
      overlays.current = [];
      markers.current = [];
      if (instance) event("destroyed");
    };
  }, [trip.id, attempt]);
  useEffect(() => {
    if (!ready || !engine.current) return;
    const { api, map } = engine.current;
    map.setLayers(
      base === "satellite"
        ? [new api.TileLayer.Satellite(), new api.TileLayer.RoadNet()]
        : [new api.TileLayer()],
    );
    if (base === "simple") map.setMapStyle("amap://styles/" + style);
  }, [ready, base, style]);
  useEffect(() => {
    setOverlap(null);
    if (!ready || !engine.current) return;
    const { api, map } = engine.current;
    map.remove(overlays.current);
    const pins: Overlay[] = [];
    for (const [key, items] of groups) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "travel-amap-marker";
      button.dataset.selected = String(
        items.some((i) => i.activity.id === selected),
      );
      button.textContent = items.map((i) => i.number).join("·");
      button.setAttribute(
        "aria-label",
        items.map((i) => `方位 ${i.activity.title}`).join("，"),
      );
      button.title = items.map((i) => i.activity.title).join(" / ");
      button.onclick = (e) => {
        e.stopPropagation();
        if (items.length > 1) setOverlap(key);
        else choose.current(items[0]!.activity.id);
      };
      pins.push(
        new api.Marker({
          position: [items[0]!.entity.longitude, items[0]!.entity.latitude],
          content: button,
          anchor: "center",
        }),
      );
    }
    const lines: Overlay[] = rows.flatMap((row) => {
      const from = points.items.find((p) => p.activity.id === row.fromId),
        to = points.items.find((p) => p.activity.id === row.toId);
      if (!from || !to) return [];
      const check = connections?.find((c) => c.id === row.id);
      return [
        new api.Polyline({
          path: [
            [from.entity.longitude, from.entity.latitude],
            [to.entity.longitude, to.entity.latitude],
          ],
          strokeColor:
            check?.state === "CONFLICT"
              ? "#b94c31"
              : check?.state === "UNKNOWN" || !check
                ? "#87939b"
                : "#438879",
          strokeWeight: 3,
          strokeStyle: "dashed",
          bubble: true,
          clickable: false,
        }),
      ];
    });
    overlays.current = [...lines, ...pins];
    markers.current = pins;
    map.add(overlays.current);
    const fitKey =
      trip.id +
      ":" +
      date +
      ":" +
      points.items
        .map((i) =>
          [i.activity.id, i.entity.longitude, i.entity.latitude].join(","),
        )
        .join(";");
    if (fitKey !== lastFit.current) {
      lastFit.current = fitKey;
      if (pins.length) map.setFitView(pins, true, [40, 40, 40, 40], 16);
    }
  }, [ready, points, groups, rows, connections, selected, date, trip.id]);
  useEffect(() => {
    const item = points.items.find((p) => p.activity.id === selected);
    if (ready && item)
      engine.current?.map.setCenter([
        item.entity.longitude,
        item.entity.latitude,
      ]);
  }, [ready, selected]);
  return (
    <div className="travel-amap">
      <div className="travel-map-controls">
        <span>
          {points.items.length}个已定位活动
          {points.missing ? ` · ${points.missing}个待确认地点` : ""}
        </span>
        <label>
          底图{" "}
          <select
            aria-label="高德底图"
            value={base}
            onChange={(e) => {
              const value = e.target.value as BaseMap;
              setBase(value);
              localStorage.setItem(preferenceKey + ":base", value);
            }}
          >
            <option value="simple">简洁地图</option>
            <option value="satellite">卫星图＋路网</option>
          </select>
        </label>
        {base === "simple" && (
          <label>
            样式{" "}
            <select
              aria-label="高德地图样式"
              value={style}
              onChange={(e) => {
                const value = e.target.value as MapStyle;
                setStyle(value);
                localStorage.setItem(preferenceKey + ":style", value);
              }}
            >
              {Object.entries(styles).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!ready}
          aria-label="放大高德地图"
          onClick={() => {
            const map = engine.current?.map;
            if (map) map.setZoom(map.getZoom() + 1);
          }}
        >
          ＋
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!ready}
          aria-label="缩小高德地图"
          onClick={() => {
            const map = engine.current?.map;
            if (map) map.setZoom(map.getZoom() - 1);
          }}
        >
          −
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!ready || !points.items.length}
          onClick={() =>
            engine.current?.map.setFitView(
              markers.current,
              true,
              [40, 40, 40, 40],
              16,
            )
          }
        >
          适配全部地点
        </Button>
      </div>
      {!ready && !error && <p role="status">正在加载高德地图…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>重试高德地图</Button>
          <Button onClick={onFallback}>切回简易图</Button>
        </div>
      )}
      <div
        ref={host}
        className="travel-amap-canvas"
        aria-label="高德真实底图，活动连接为直线示意"
        style={{ display: error ? "none" : "block" }}
      />
      {!!overlap && groups.has(overlap) && (
        <div
          className="travel-amap-overlap"
          role="group"
          aria-label="同地点活动"
        >
          {groups.get(overlap)!.map((p) => (
            <Button
              key={p.activity.id}
              variant="outline"
              onClick={() => {
                choose.current(p.activity.id);
                setOverlap(null);
              }}
            >
              {p.number} · {p.activity.title}
            </Button>
          ))}
        </div>
      )}
      {!points.items.length && (
        <p>暂无已确认地点，可先绑定活动地点；不自动猜测位置。</p>
      )}
      <p className="travel-map-disclaimer">
        直线示意，非实际道路路线。路程与耗时来自已保存资料，不根据地图线长计算。
      </p>
    </div>
  );
}
