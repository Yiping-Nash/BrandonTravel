import { useMemo, useRef, useState, useEffect } from "react";
import type { TravelTrip, TravelTransition } from "@open-sunsama/types";
import { mapPoints } from "./map-points";
import { Button } from "@/components/ui";
export function DirectionMap({
  trip,
  date,
  rows,
  selected,
  onSelect,
}: {
  trip: TravelTrip;
  date: string;
  rows: TravelTransition[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [compact, setCompact] = useState(window.innerWidth < 768);
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 768);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const pointer = useRef<
    { x: number; y: number; pan: { x: number; y: number } } | undefined
  >(undefined);
  const points = useMemo(() => {
    const projected = mapPoints(trip, date);
    const activities = projected.items.map((p) => p.activity);
    const entities = projected.items.map((p) => p.entity);
    const located = entities.filter((e) => !!e);
    if (!located.length)
      return { items: [], missing: projected.missing, scale: 1, span: 0 };
    const lat = located.reduce((s, e) => s + e.latitude, 0) / located.length,
      lon = located.reduce((s, e) => s + e.longitude, 0) / located.length;
    const metric = (e: (typeof located)[number]) => ({
      x: (e.longitude - lon) * 111320 * Math.cos((lat * Math.PI) / 180),
      y: -(e.latitude - lat) * 111320,
    });
    const raw = located.map(metric),
      minX = Math.min(...raw.map((p) => p.x)),
      maxX = Math.max(...raw.map((p) => p.x)),
      minY = Math.min(...raw.map((p) => p.y)),
      maxY = Math.max(...raw.map((p) => p.y));
    const scale = Math.min(
      510 / Math.max(200, maxX - minX),
      235 / Math.max(200, maxY - minY),
    );
    const used: { x: number; y: number }[] = [];
    return {
      missing: projected.missing,
      scale,
      span: Math.max(maxX - minX, maxY - minY),
      items: activities.flatMap((a, i) => {
        const e = entities[i];
        if (!e) return [];
        const p = metric(e),
          x = 320 + (p.x - (minX + maxX) / 2) * scale,
          y = 190 + (p.y - (minY + maxY) / 2) * scale;
        let labelY = y - 35;
        const labelX = Math.min(
          compact ? 530 : 540,
          Math.max(compact ? 110 : 85, x),
        );
        for (
          let n = 0;
          n < 12 &&
          used.some(
            (p) => Math.abs(p.x - labelX) < 130 && Math.abs(p.y - labelY) < 23,
          );
          n++
        )
          labelY += 24;
        labelY = Math.min(335, Math.max(45, labelY));
        used.push({ x: labelX, y: labelY });
        return [
          {
            activity: a,
            entity: e,
            x,
            y,
            labelX,
            labelY,
            number: projected.items[i]!.number,
          },
        ];
      }),
    };
  }, [trip, date, compact]);
  function reset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }
  const active = points.items.find((p) => p.activity.id === selected);
  const eFrom = active?.entity;
  return (
    <div className="travel-direction">
      <div className="travel-map-controls">
        <span>
          {points.items.length}个已定位活动
          {points.missing ? ` · ${points.missing}个待确认地点` : ""}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setZoom((z) => Math.min(4, z * 1.3))}
          aria-label="放大方位图"
        >
          ＋
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setZoom((z) => Math.max(0.7, z / 1.3))}
          aria-label="缩小方位图"
        >
          −
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          适应画面
        </Button>
      </div>
      <svg
        viewBox="0 0 640 380"
        role="img"
        aria-label="旅行地点方位示意图，北向上"
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-map-point]")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointer.current = { x: e.clientX, y: e.clientY, pan };
        }}
        onPointerMove={(e) => {
          if (!pointer.current) return;
          const scale = 640 / e.currentTarget.getBoundingClientRect().width;
          setPan({
            x: pointer.current.pan.x + (e.clientX - pointer.current.x) * scale,
            y: pointer.current.pan.y + (e.clientY - pointer.current.y) * scale,
          });
        }}
        onPointerUp={() => (pointer.current = undefined)}
        onPointerCancel={() => (pointer.current = undefined)}
        style={{ touchAction: "none" }}
      >
        <defs>
          <pattern
            id="travel-map-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M40 0H0V40"
              fill="none"
              stroke="currentColor"
              strokeOpacity=".06"
            />
          </pattern>
          <marker
            id="travel-map-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0 0L7 3.5L0 7" fill="context-stroke" />
          </marker>
        </defs>
        <rect width="640" height="380" rx="16" fill="url(#travel-map-grid)" />
        <text x="25" y="30" className="travel-map-kicker">
          TRIP ORIENTATION
        </text>
        <g transform="translate(600 45)">
          <path d="M0 -23L-7 -6H7Z" fill="#2f7661" />
          <path d="M0 23L-7 6H7Z" fill="#9ca3af" />
          <text x="0" y="-29" textAnchor="middle" fontSize={compact ? 19 : 12}>
            N
          </text>
        </g>
        <g
          transform={`translate(${pan.x} ${pan.y}) translate(320 190) scale(${zoom}) translate(-320 -190)`}
        >
          {rows.map((t) => {
            const a = points.items.find((p) => p.activity.id === t.fromId),
              b = points.items.find((p) => p.activity.id === t.toId);
            if (!a || !b) return null;
            const isSelected = selected === t.fromId || selected === t.toId;
            return (
              <path
                key={t.id}
                d={`M${a.x} ${a.y}L${b.x} ${b.y}`}
                stroke={
                  t.freshness !== "fresh"
                    ? "#94a3b8"
                    : (t.shortageMinutes ?? 0) > 0
                      ? "#c45b3b"
                      : isSelected
                        ? "#2f7661"
                        : "#94a3b8"
                }
                strokeWidth={isSelected ? 3 : 2}
                strokeDasharray={t.freshness === "fresh" ? undefined : "6 5"}
                markerEnd="url(#travel-map-arrow)"
                fill="none"
                opacity={selected && !isSelected ? 0.4 : 0.9}
              />
            );
          })}
          {points.items.map((p) => (
            <g
              key={p.activity.id}
              data-map-point="true"
              role="button"
              tabIndex={0}
              aria-label={`方位 ${p.activity.title}`}
              onClick={() => onSelect(p.activity.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.activity.id);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <title>
                {p.number}. {p.activity.title} · {p.entity.address}
              </title>
              <path
                d={`M${p.x} ${p.y}L${p.labelX} ${p.labelY}`}
                stroke="#94a3b8"
                strokeWidth="1"
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={selected === p.activity.id ? 20 : 15}
                fill={selected === p.activity.id ? "#e3efe9" : "#fff"}
                stroke="#2f7661"
                strokeWidth={selected === p.activity.id ? 3 : 2}
              />
              <text
                x={p.x}
                y={p.y + 4}
                textAnchor="middle"
                fill="#215442"
                fontSize={compact ? 19 : 12}
                fontWeight="700"
              >
                {p.number}
              </text>
              <rect
                x={p.labelX - (compact ? 105 : 80)}
                y={p.labelY - (compact ? 22 : 17)}
                width={compact ? 210 : 160}
                height={compact ? 32 : 26}
                rx="6"
                className="travel-map-label-bg"
              />
              <text
                x={p.labelX}
                y={p.labelY + 1}
                textAnchor="middle"
                fontSize={compact ? 20 : 13}
                fontWeight="600"
              >
                {p.activity.title.length > (compact ? 9 : 13)
                  ? p.activity.title.slice(0, compact ? 9 : 13) + "…"
                  : p.activity.title}
              </text>
            </g>
          ))}
        </g>
        {!points.items.length && (
          <text x="320" y="185" textAnchor="middle" fontSize="15">
            为活动选择真实地点后，显示大致方位
          </text>
        )}
        <g transform="translate(25 352)">
          <path d="M0 -4V0H80V-4" stroke="currentColor" fill="none" />
          <text y="-9" fontSize={compact ? 16 : 10}>
            约{(80 / points.scale / zoom / 1000).toFixed(1)} km
          </text>
        </g>
        <text x="615" y="353" textAnchor="end" fontSize={compact ? 16 : 10}>
          GCJ-02 · 方位示意 · 非导航底图
        </text>
      </svg>
      <div className="travel-map-legend">
        <span>○ 活动地点</span>
        <span>→ 同日连接</span>
        <span>┄ 未知或过期</span>
        <span className="travel-map-risk">橙色：时间不足</span>
        {points.span > 50000 && <span>跨度较大，可选择单日查看细节</span>}
      </div>
      <div className="travel-map-point-list">
        {points.items.map((p) => (
          <button
            key={p.activity.id}
            className={selected === p.activity.id ? "selected" : ""}
            onClick={() => onSelect(p.activity.id)}
          >
            {p.number} · {p.activity.title}
          </button>
        ))}
      </div>
      {active && (
        <div className="travel-map-selected">
          <strong>
            {active.number}. {active.activity.title}
          </strong>
          <span>
            {active.entity.name} · {active.entity.address}
          </span>
          {eFrom && (
            <a
              target="_blank"
              rel="noreferrer"
              href={`https://uri.amap.com/marker?position=${eFrom.longitude},${eFrom.latitude}&name=${encodeURIComponent(eFrom.name)}`}
            >
              在高德查看地点 ↗
            </a>
          )}
          {rows
            .filter(
              (t) =>
                t.fromId === active.activity.id ||
                t.toId === active.activity.id,
            )
            .map((t) => {
              const a = points.items.find((p) => p.activity.id === t.fromId),
                b = points.items.find((p) => p.activity.id === t.toId);
              return a && b ? (
                <a
                  key={t.id}
                  target="_blank"
                  rel="noreferrer"
                  href={`https://uri.amap.com/navigation?from=${a.entity.longitude},${a.entity.latitude},${encodeURIComponent(a.entity.name)}&to=${b.entity.longitude},${b.entity.latitude},${encodeURIComponent(b.entity.name)}&mode=${t.mode === "walking" ? "walk" : "car"}&coordinate=gaode`}
                >
                  查看{a.number} → {b.number}真实路线 ↗
                </a>
              ) : null;
            })}
        </div>
      )}
    </div>
  );
}
