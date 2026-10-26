"""AMap Web Service POI adapter. Credentials remain on the server."""
import os
import httpx
from pydantic import ValidationError

from packages.contracts import Place
from .errors import AgentError

AMAP_ENDPOINT = "https://restapi.amap.com/v3/place/text"


async def search_places(query: str, city: str, *, province: str | None = None) -> list[Place]:
    query, city = query.strip(), city.strip()
    if not query or len(query) > 200 or not city or len(city) > 100:
        raise AgentError(422, "INVALID_SEARCH", "请填写地点关键词（200 字以内）和目的地。")
    if province is not None:
        province = province.strip()
        if not province or len(province) > 100:
            raise AgentError(422, "INVALID_SEARCH", "省级搜索范围无效。")
    key = os.getenv("AMAP_WEB_SERVICE_KEY", "").strip()
    if not key:
        raise AgentError(503, "POI_NOT_CONFIGURED", "高德地点搜索尚未配置，请在 .env 填写 AMAP_WEB_SERVICE_KEY。")
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            params = {
                "key": key, "keywords": query, "city": city, "citylimit": "true",
                "offset": 10, "page": 1, "extensions": "base", "output": "JSON",
            }
            if province:
                # AMap documents city/citylimit as city/district selectors. Do not
                # turn a province into its capital; search explicit region keywords
                # and verify the returned administrative pname before accepting POIs.
                params.pop("city")
                params.update(keywords=f"{province} {query}", citylimit="false")
            response = await client.get(AMAP_ENDPOINT, params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        raise AgentError(502, "POI_UNAVAILABLE", "高德地点服务暂时不可用，请稍后重试。") from None
    if not isinstance(payload, dict) or payload.get("status") != "1":
        code = payload.get("infocode", "") if isinstance(payload, dict) else ""
        message = ("高德配额或访问权限不足，请检查 Web 服务 Key 的配置。"
                   if str(code).startswith("100") else "高德未返回有效的地点结果。")
        raise AgentError(502, "POI_PROVIDER_ERROR", message)
    if not isinstance(payload.get("pois"), list):
        raise AgentError(502, "POI_INVALID_RESPONSE", "高德返回的数据格式不符合要求。")
    places = []
    for item in payload["pois"][:10]:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            continue
        if province and item.get("pname") != province:
            continue  # Reject out-of-province and missing-scope provider results.
        try:
            coordinates = str(item.get("location", "")).split(",")
            longitude, latitude = (float(coordinates[0]), float(coordinates[1])) if len(coordinates) == 2 else (None, None)
            address = item.get("address")
            if province:
                address = " ".join(dict.fromkeys(value for value in
                    (item.get("pname"), item.get("cityname"), item.get("adname"), address)
                    if isinstance(value, str) and value))
            places.append(Place(provider="amap", providerId=str(item["id"]) if item.get("id") else None,
                                name=item["name"], address=address if isinstance(address, str) else None,
                                latitude=latitude, longitude=longitude))
        except (ValueError, TypeError, ValidationError):
            continue
    return places

