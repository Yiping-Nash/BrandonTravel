"""Pure, reproducible day checks; no model or network claims in this layer."""
from datetime import date, datetime
from math import asin, cos, radians, sin, sqrt
from urllib.parse import urlencode

from packages.contracts import DayCheck, DayContext, DayRoute, TripSnapshot


def ordered_day(snapshot: TripSnapshot, day: date):
    return sorted((a for a in snapshot.activities if a.date == day), key=lambda a: (a.sortKey, a.id))


def located(activity):
    return activity.place is not None and activity.place.latitude is not None and activity.place.longitude is not None


def summarize_day(snapshot: TripSnapshot, day: date | str) -> DayContext:
    day = date.fromisoformat(day) if isinstance(day, str) else day
    items = ordered_day(snapshot, day)
    checks, routes = [], []
    timed = sorted((a for a in items if a.startAt), key=lambda a: a.startAt)
    for i, a in enumerate(timed):
        for b in timed[i + 1:]:
            if b.startAt < a.endAt:
                checks.append(DayCheck(code="TIME_OVERLAP", severity="warning", message=f"{a.title} 与 {b.title} 的时间重叠。", activityIds=[a.id, b.id]))
    untimed = [a.id for a in items if not a.startAt]
    if untimed:
        checks.append(DayCheck(code="UNTIMED", severity="info", message=f"{len(untimed)} 项活动尚未确定时间，暂时无法完整判断当天负荷。", activityIds=untimed))
    missing = [a.id for a in items if not located(a)]
    if missing:
        checks.append(DayCheck(code="LOCATION_UNKNOWN", severity="info", message=f"{len(missing)} 项活动缺少地点坐标，移动时间未知。", activityIds=missing))
    total = sum((datetime.fromisoformat(a.endAt) - datetime.fromisoformat(a.startAt)).total_seconds() / 60 for a in timed)
    if total > 480:
        checks.append(DayCheck(code="LONG_DAY", severity="warning", message=f"已安排活动时长合计 {round(total / 60, 1)} 小时，尚未计入移动与休息（重叠时段会重复计入）。", activityIds=[a.id for a in timed]))
    # Located stops still have a spatial relationship when an intermediate stop
    # is unknown. Such a leg is explicitly incomplete, never a full route claim.
    known = [a for a in items if located(a)]
    positions = {a.id: index for index, a in enumerate(items)}
    for a, b in zip(known, known[1:]):
        p, q = a.place, b.place
        phi1, phi2 = radians(p.latitude), radians(q.latitude)
        delta_phi, delta_lambda = phi2 - phi1, radians(q.longitude - p.longitude)
        distance = 6371000 * 2 * asin(min(1, sqrt(sin(delta_phi / 2)**2 + cos(phi1) * cos(phi2) * sin(delta_lambda / 2)**2)))
        url = "https://uri.amap.com/navigation?" + urlencode({"from": f"{p.longitude},{p.latitude},{p.name}", "to": f"{q.longitude},{q.latitude},{q.name}", "mode": "car", "coordinate": "gaode", "callnative": "0"})
        missing_between = positions[b.id] - positions[a.id] > 1
        note = "两地点之间还有未定位活动；仅展示直线位置关系，不是完整移动路线，交通时间未知。" if missing_between else "直线距离仅用于空间参考；实际路线、交通时间与道路情况待确认。"
        routes.append(DayRoute(fromActivityId=a.id, toActivityId=b.id, distanceMeters=round(distance), source="straight_line", mapUrl=url, note=note))
        if distance > 30000:
            checks.append(DayCheck(code="DISTANT_PLACES", severity="warning", message=f"{a.title} 与 {b.title} 直线相距约 {distance / 1000:.1f} 公里，需单独预留移动时间；实际交通尚需核实。", activityIds=[a.id, b.id]))
        if a.startAt and b.startAt and b.startAt < a.startAt:
            checks.append(DayCheck(code="ORDER_TIME_MISMATCH", severity="warning", message=f"看板中 {a.title} 在 {b.title} 之前，但时间顺序相反；请核对路线顺序。", activityIds=[a.id, b.id]))
    return DayContext(date=day, checks=checks, routes=routes)
