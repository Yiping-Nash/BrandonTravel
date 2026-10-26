"""Official AMap server-side map/route adapters; no key in client URLs or errors."""
import asyncio
import math
import os
import time
from collections import OrderedDict
from datetime import date, datetime

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import Response

from apps.api.domain.day_context import located, ordered_day, summarize_day
from apps.api.domain.errors import DomainError
from packages.contracts import DayCheck, DayContext


def create_router(repo):
    router = APIRouter(prefix="/api", tags=["Maps"])
    cache = OrderedDict()
    locks = [asyncio.Lock() for _ in range(32)]

    async def provider(path, params, *, binary=False):
        key = os.getenv("AMAP_WEB_SERVICE_KEY", "").strip()
        if not key:
            raise DomainError(503, "MAP_NOT_CONFIGURED", "地图服务尚未配置，仍可手动编辑行程。")
        signature = (path, tuple(sorted(params.items())))
        async with locks[hash(signature) % len(locks)]:
            cached = cache.get(signature)
            if cached and time.monotonic() - cached[0] < 1800:
                cache.move_to_end(signature)
                return cached[1]
            try:
                async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
                    res = await client.get("https://restapi.amap.com/v3/" + path, params={**params, "key": key})
                    res.raise_for_status()
                if binary:
                    if not res.headers.get("content-type", "").startswith("image/png") or not res.content.startswith(b"\x89PNG\r\n\x1a\n") or len(res.content) > 8_000_000:
                        raise ValueError("Invalid image")
                    value = res.content
                else:
                    value = res.json()
                    if not isinstance(value, dict) or value.get("status") != "1":
                        raise ValueError("Invalid route")
            except (httpx.HTTPError, ValueError):
                raise DomainError(502, "MAP_UNAVAILABLE", "高德地图或路线暂时不可用，请稍后重试；行程内容已保留。") from None
            cache[signature] = (time.monotonic(), value)
            while len(cache) > 128:
                cache.popitem(last=False)
            return value

    def snapshot_for_day(trip_id, day):
        snapshot = repo.get_snapshot(trip_id)
        if not snapshot.trip.startDate or not snapshot.trip.endDate:
            raise DomainError(422, "DATES_REQUIRED", "请先补充旅行日期。")
        if not snapshot.trip.startDate <= day <= snapshot.trip.endDate:
            raise DomainError(422, "DATE_OUTSIDE_TRIP", "日期不在当前旅行范围内。")
        return snapshot

    @router.get("/trips/{trip_id}/day-map")
    async def day_map(trip_id: str, date: date, zoom: int | None = Query(default=None, ge=1, le=17), focus: str | None = Query(default=None, max_length=160)):
        snapshot = snapshot_for_day(trip_id, date)
        items = ordered_day(snapshot, date)
        points = [(index + 1, a) for index, a in enumerate(items) if located(a)]
        if not points:
            raise DomainError(404, "NO_LOCATIONS", "当天尚无可定位的地点，请先为活动选择地点。")
        selected = next((a for _, a in points if a.id == focus), None)
        if focus and not selected:
            raise DomainError(422, "INVALID_MAP_FOCUS", "所选地点不属于当前旅行当天。")
        # AMap static API supports at most 10 markers. UI labels this limit.
        shown = points[:10]
        if selected and selected not in [a for _, a in shown]:
            shown[-1] = next(pair for pair in points if pair[1].id == focus)
        lngs = [a.place.longitude for _, a in shown]
        lats = [a.place.latitude for _, a in shown]
        center = (selected.place.longitude, selected.place.latitude) if selected else ((min(lngs) + max(lngs)) / 2, (min(lats) + max(lats)) / 2)
        span = max(max(lngs) - min(lngs), (max(lats) - min(lats)) * 1.5, .006)
        fit = max(3, min(15, int(math.log2(360 * 600 / (256 * span))) - 1))
        markers = "|".join(f"mid,0x31766E,{index if index <= 99 else 'P'}:{a.place.longitude},{a.place.latitude}" for index, a in shown)
        image = await provider("staticmap", {"location": f"{center[0]},{center[1]}", "zoom": zoom or fit, "size": "600*440", "scale": "2", "markers": markers}, binary=True)
        return Response(image, media_type="image/png", headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})

    @router.get("/trips/{trip_id}/day-context", response_model=DayContext)
    async def day_context(trip_id: str, date: date):
        snapshot = snapshot_for_day(trip_id, date)
        context = summarize_day(snapshot, date)
        activities = {a.id: a for a in snapshot.activities}
        positions = {a.id: index for index, a in enumerate(ordered_day(snapshot, date))}
        for leg in context.routes[:8]:
            a, b = activities[leg.fromActivityId], activities[leg.toActivityId]
            if positions[b.id] - positions[a.id] > 1:
                continue  # Unknown intervening stop: do not present a direct route as the complete journey.
            try:
                data = await provider("direction/driving", {"origin": f"{a.place.longitude},{a.place.latitude}", "destination": f"{b.place.longitude},{b.place.latitude}", "strategy": "0", "extensions": "base"})
                path = data["route"]["paths"][0]
                duration, distance = float(path["duration"]) / 60, float(path["distance"])
                if not (math.isfinite(duration) and math.isfinite(distance) and 0 <= duration <= 10080 and 0 <= distance <= 10_000_000):
                    raise ValueError("Invalid route metrics")
                leg.source, leg.distanceMeters, leg.durationMinutes = "amap", distance, round(duration, 1)
                leg.note = "高德驾车路线参考（缓存最多30分钟），不含停车、步行与休息；请按实际交通方式复核。"
                if a.endAt and b.startAt:
                    gap = (datetime.fromisoformat(b.startAt) - datetime.fromisoformat(a.endAt)).total_seconds() / 60
                    if 0 <= gap < duration:
                        context.checks.append(DayCheck(code="TRAVEL_GAP", severity="warning", message=f"{a.title} → {b.title} 仅预留 {round(gap)} 分钟；高德驾车参考约 {round(duration)} 分钟，移动时间可能不足。", activityIds=[a.id, b.id]))
            except (DomainError, KeyError, IndexError, TypeError, ValueError):
                leg.note = "实际路线暂不可用；仅展示直线距离，交通时间未知。"
        return context

    return router
