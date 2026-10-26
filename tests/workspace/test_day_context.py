"""Deterministic map/route behavior. Mock provider tests are not live map evidence."""
from unittest.mock import AsyncMock

import httpx
from fastapi.testclient import TestClient

from apps.api.domain.day_context import summarize_day
from apps.api.main import create_app
from packages.contracts import Activity, TripSnapshot


def sample():
    values = dict(id="trip-map", title="地图检查", destination="太原", startDate="2026-11-02", endDate="2026-11-04", createdAt="t", updatedAt="t")
    snap = TripSnapshot(version=1, trip=values)
    for index, (start, end, lng) in enumerate([("09:00", "10:00", 112.5), ("09:30", "11:00", 112.51), (None, None, None)]):
        snap.activities.append(Activity(id=f"a{index}", tripId="trip-map", title=f"活动{index}", date="2026-11-02", sortKey=index,
            startAt=f"2026-11-02T{start}" if start else None, endAt=f"2026-11-02T{end}" if end else None,
            place={"name":"地点", "longitude":lng, "latitude":37.8} if lng else None, createdAt="t", updatedAt="t"))
    return snap


def test_pure_checks_do_not_invent_route_duration():
    context = summarize_day(sample(), "2026-11-02")
    assert {c.code for c in context.checks} == {"TIME_OVERLAP", "UNTIMED", "LOCATION_UNKNOWN"}
    assert len(context.routes) == 1  # Do not skip an unlocated stop.
    assert 800 < context.routes[0].distanceMeters < 1000
    assert context.routes[0].durationMinutes is None


def test_unknown_stop_preserves_spatial_warning_without_inventing_a_route():
    snap = sample()
    snap.activities[1].place = None
    snap.activities[2].place = snap.activities[0].place.model_copy(update={"latitude":38.4})
    context = summarize_day(snap, "2026-11-02")
    assert len(context.routes) == 1
    assert 66000 < context.routes[0].distanceMeters < 68000
    assert context.routes[0].durationMinutes is None
    assert "未定位" in context.routes[0].note
    assert "DISTANT_PLACES" in [c.code for c in context.checks]


def test_map_proxy_validates_scope_cache_and_keeps_key_server_side(tmp_path, monkeypatch):
    app = create_app(str(tmp_path / "maps.sqlite3"))
    snap = sample()
    monkeypatch.setattr(app.state.repo, "get_snapshot", lambda trip_id: snap)
    monkeypatch.setenv("AMAP_WEB_SERVICE_KEY", "private-test-key")
    png = b"\x89PNG\r\n\x1a\nfixture"
    fetch = AsyncMock(return_value=httpx.Response(200, headers={"content-type":"image/png"}, content=png, request=httpx.Request("GET", "https://restapi.amap.com")))
    monkeypatch.setattr(httpx.AsyncClient, "get", fetch)
    with TestClient(app) as client:
        url = "/api/trips/trip-map/day-map?date=2026-11-02"
        assert client.get(url + "&focus=other-trip-activity").status_code == 422
        assert client.get(url + "&zoom=18").status_code == 422
        response = client.get(url)
        assert response.status_code == 200 and response.content == png
        assert "private-test-key" not in str(response.headers)
        assert client.get(url).status_code == 200
        assert fetch.await_count == 1
        assert client.get("/api/trips/trip-map/day-map?date=2026-11-20").status_code == 422


def test_real_route_metrics_and_unknown_fallback(tmp_path, monkeypatch):
    app = create_app(str(tmp_path / "route.sqlite3"))
    snap = sample()
    snap.activities[1].startAt, snap.activities[1].endAt = "2026-11-02T10:05", "2026-11-02T11:00"
    monkeypatch.setattr(app.state.repo, "get_snapshot", lambda trip_id: snap)
    monkeypatch.setenv("AMAP_WEB_SERVICE_KEY", "private-test-key")
    fetch = AsyncMock(return_value=httpx.Response(200, json={"status":"1", "route":{"paths":[{"duration":"900", "distance":"2000"}]}}, request=httpx.Request("GET", "https://restapi.amap.com")))
    monkeypatch.setattr(httpx.AsyncClient, "get", fetch)
    with TestClient(app) as client:
        result = client.get("/api/trips/trip-map/day-context?date=2026-11-02").json()
        assert result["routes"][0]["durationMinutes"] == 15
        assert result["routes"][0]["source"] == "amap"
        assert "TRAVEL_GAP" in [c["code"] for c in result["checks"]]
    no_key_app = create_app(str(tmp_path / "no-key.sqlite3"))
    monkeypatch.setattr(no_key_app.state.repo, "get_snapshot", lambda trip_id: snap)
    monkeypatch.delenv("AMAP_WEB_SERVICE_KEY")
    with TestClient(no_key_app) as client:
        result = client.get("/api/trips/trip-map/day-context?date=2026-11-02").json()
        assert result["routes"][0]["source"] == "straight_line"
        assert result["routes"][0]["durationMinutes"] is None
