"""Read-only source adapters. Official Tavily SDK, existing AMap adapter."""
import asyncio
import hashlib
import ipaddress
import json
import os
from urllib.parse import urlsplit

from .places import search_places
from .research_contracts import Evidence, ResearchBrief

AUTHORITATIVE_DOMAINS = ("gov.cn", "news.cn", "xinhuanet.com", "people.com.cn", "cctv.com", "cctv.cn",
                         "dpm.org.cn", "chnmuseum.cn")


def authoritative_url(url: str) -> bool:
    """Publisher boundary, not a guarantee that a dated claim is true."""
    if not safe_public_url(url):
        return False
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    return any(host == domain or host.endswith("." + domain) for domain in AUTHORITATIVE_DOMAINS)


def safe_public_url(url: str) -> bool:
    try:
        p = urlsplit(url)
        if p.scheme not in {"http", "https"} or not p.hostname or p.username or p.password:
            return False
        host = p.hostname.lower().rstrip(".")
        if host in {"localhost", "metadata.google.internal"} or "." not in host or host.endswith((".local", ".internal")):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return True
    except ValueError:
        return False


class Sources:
    def __init__(self, brief: ResearchBrief, *, replay: bool = False, production: bool = False,
                 authoritative_only: bool = False, province_scope: str | None = None):
        self.brief = brief
        self.replay = replay
        self.production = production
        self.authoritative_only = authoritative_only
        self.province_scope = province_scope
        self.evidence: dict[str, Evidence] = {}
        self.events: list[dict] = []
        self.counts = {"amap": 0, "web": 0, "extract": 0, "credits": 0}
        self._web = None

    def add(self, source_type, title, excerpt, verification, *, excerpt_limit=6000, **fields) -> Evidence:
        original_digest = hashlib.sha256(excerpt.encode()).hexdigest()
        truncated = len(excerpt) > excerpt_limit
        excerpt = excerpt[:min(excerpt_limit, 6000)]
        digest = hashlib.sha256(excerpt.encode()).hexdigest()
        identity_fields = [source_type, fields.get("url"), fields.get("providerId"), digest]
        # A page extraction and search snippet remain distinct observations even
        # when their text matches. Keep historical R1 fixture identities intact.
        if self.production: identity_fields.append(verification)
        identity = json.dumps(identity_fields, sort_keys=True)
        ident = "ev:" + hashlib.sha256(identity.encode()).hexdigest()[:24]
        if ident not in self.evidence:
            self.evidence[ident] = Evidence(id=ident, sourceType=source_type, title=title[:300], excerpt=excerpt,
                                           contentHash=digest, sourceContentHash=original_digest if self.production else None,
                                           excerptTruncated=truncated, verification=verification, **fields)
        return self.evidence[ident]

    def event(self, tool, status, **kwargs):
        self.events.append({"tool": tool, "status": status, "mode": "fixture" if self.replay else "live", **kwargs})

    def model_view(self, evidence: Evidence) -> dict:
        """Compact projection for the model; full typed evidence remains server-side."""
        if not self.production:
            return evidence.model_dump(mode="json")
        limit = 800 if evidence.verification == "page_extract" else 350
        value = {"id": evidence.id, "sourceType": evidence.sourceType, "title": evidence.title,
                 "verification": evidence.verification}
        if evidence.place is not None:
            value["place"] = evidence.place.model_dump(mode="json")
        else:
            value.update(excerpt=evidence.excerpt[:limit],
                         excerptTruncated=evidence.excerptTruncated or len(evidence.excerpt) > limit)
        if evidence.url: value["url"] = evidence.url
        return value

    def reserve(self, kind, count=1, credits=0):
        limit = {"amap": 3, "web": 4, "extract": 5}[kind]
        if self.counts[kind] + count > limit or self.counts["credits"] + credits > 6:
            self.event(kind, "BUDGET_EXCEEDED")
            return False
        self.counts[kind] += count
        self.counts["credits"] += credits
        return True

    def snapshot(self):
        payload = self.brief.snapshot.model_dump(mode="json", exclude={"suggestions"})
        e = self.add("snapshot", "Workspace Trip snapshot" if self.production else "Synthetic evaluation Trip snapshot",
                     json.dumps(payload, ensure_ascii=False), "snapshot")
        self.event("get_trip_snapshot", "OK")
        return {"snapshot": payload, "contextHash": self.brief.contextHash, "evidenceRef": e.id,
                "notice": ("当前用户工作区快照；计划不代表预订。未定时活动仍属于当天安排。" if self.production
                           else "人工构造测试行程，不代表真实预订。未定时活动仍属于当天安排。")}

    async def amap(self, query: str):
        if not query.strip() or len(query) > 200:
            return {"error": "INVALID_QUERY"}
        if not self.reserve("amap"):
            return {"error": "BUDGET_EXCEEDED"}
        try:
            if self.replay:
                from packages.contracts import Place
                places = [Place(name="测试公园（固定数据）", providerId="fixture-poi", address="测试地址")]
            else:
                if self.province_scope:
                    places = await search_places(query, self.brief.snapshot.trip.destination, province=self.province_scope)
                else:
                    places = await search_places(query, self.brief.snapshot.trip.destination)
            result = []
            for p in places[:3]:
                e = self.add("poi", p.name, p.model_dump_json(), "provider", providerId=p.providerId, place=p)
                result.append(self.model_view(e))
            self.event("search_places", "OK", results=len(result))
            return {"evidence": result, "limits": "POI只验证地点资料，不验证开放、预约、体验或交通时间。"}
        except Exception as exc:
            self.event("search_places", "ERROR", errorType=type(exc).__name__)
            return {"error": "AMAP_UNAVAILABLE", "evidence": []}

    def web_client(self):
        if not os.getenv("TAVILY_API_KEY", "").strip():
            raise RuntimeError("TAVILY_NOT_CONFIGURED")
        if self._web is None:
            from tavily import AsyncTavilyClient
            proxy = os.getenv("RESEARCH_HTTPS_PROXY")
            self._web = AsyncTavilyClient(api_key=os.environ["TAVILY_API_KEY"], proxies={"http": proxy, "https": proxy} if proxy else None)
        return self._web

    async def web(self, query: str):
        if not query.strip() or len(query) > 400:
            return {"error": "INVALID_QUERY"}
        if not self.reserve("web", credits=1):
            return {"error": "BUDGET_EXCEEDED"}
        try:
            if self.replay:
                payload = {"results": [{"url": "https://example.org/fixture", "title": "固定测试资料",
                                        "content": "这是测试资料，不是实时景点信息。开放和无障碍情况需另行核实。"}]}
            else:
                options = {"include_domains": list(AUTHORITATIVE_DOMAINS)} if self.authoritative_only else {}
                payload = await asyncio.wait_for(self.web_client().search(query=query, search_depth="basic", max_results=4,
                    include_answer=False, include_raw_content=False, auto_parameters=False, **options), timeout=25)
            result = []
            for r in payload.get("results", [])[:4]:
                url = str(r.get("url", ""))
                if not safe_public_url(url) or (self.authoritative_only and not authoritative_url(url)):
                    continue
                content = r.get("content")
                if not isinstance(content, str) or not content.strip():
                    continue
                e = self.add("web", str(r.get("title", url)), content, "search_excerpt",
                             excerpt_limit=6000 if self.production else 1200,
                             url=url, publisher=urlsplit(url).hostname)
                result.append(self.model_view(e))
                if self.production and len(result) >= 2: break
            self.event("web_search", "OK", results=len(result))
            return {"evidence": result, "limits": "搜索摘录不等于完整官网规则；不得凭搜索排名声称是官方或非商业内容。"}
        except Exception as exc:
            self.event("web_search", "ERROR", errorType=type(exc).__name__)
            return {"error": "WEB_UNAVAILABLE", "evidence": []}

    async def extract(self, urls: list[str]):
        known = {e.url for e in self.evidence.values() if e.sourceType == "web"}
        if not 1 <= len(urls) <= 5 or any(u not in known or not safe_public_url(u) for u in urls):
            return {"error": "UNOBSERVED_OR_INVALID_URL"}
        urls = list(dict.fromkeys(urls))
        if not self.reserve("extract", len(urls), credits=1):
            return {"error": "BUDGET_EXCEEDED"}
        try:
            if self.replay:
                payload = {"results": [{"url": u, "raw_content": "固定网页回放，仅用于框架测试；不能当作实时旅行证据。"} for u in urls]}
            else:
                payload = await asyncio.wait_for(self.web_client().extract(urls=urls, extract_depth="basic", format="text"), timeout=25)
            result = []
            for r in payload.get("results", []):
                url = r.get("url", "")
                if url not in urls:
                    continue
                text = r.get("raw_content")
                if not isinstance(text, str) or not text.strip():
                    continue
                e = self.add("web", urlsplit(url).hostname or url, text, "page_extract",
                             excerpt_limit=6000 if self.production else 3500, url=url, publisher=urlsplit(url).hostname)
                result.append(self.model_view(e))
            self.event("read_pages", "OK" if len(result) == len(urls) else "PARTIAL", results=len(result), requested=len(urls))
            return {"evidence": result, "failedCount": len(urls) - len(result)}
        except Exception as exc:
            self.event("read_pages", "ERROR", errorType=type(exc).__name__)
            return {"error": "EXTRACT_UNAVAILABLE", "evidence": []}
