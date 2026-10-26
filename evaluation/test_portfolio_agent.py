"""Offline Portfolio agent tests. Fake model/tool data never establishes live quality."""
import asyncio
from contextlib import nullcontext
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage

from apps.api.agent import portfolio, research_sources
from apps.api.agent.errors import AgentError
from apps.api.agent.research import RunBudget
from apps.api.agent.research_contracts import Candidate, Claim, ResearchResult, validate_result
from apps.api.agent.research_sources import Sources, authoritative_url
from evaluation.research_budget import BudgetLedger
from evaluation.research_fixtures import build_brief
from evaluation.research_models import metadata
from packages.contracts import PlanRequest, ProposalDraft, Place


@pytest.fixture(autouse=True)
def isolated_source_keys(monkeypatch):
    monkeypatch.setenv("AMAP_WEB_SERVICE_KEY", "offline-amap-not-real")
    monkeypatch.setenv("TAVILY_API_KEY", "offline-tavily-not-real")


def snapshot():
    return build_brief("shanghai_seniors", 1).snapshot.model_copy(deep=True)


def draft_for(snap, kind="blueprint"):
    first = snap.trip.startDate
    return ProposalDraft(kind=kind, title="可编辑的旅行初稿", summary="按天保留休息时间，地点与预约待核实。",
        actions=[{"type": "addActivity", "activity": {"title": "休息与周边漫步", "date": first,
                  "notes": "待用户确认，地点未定位"}},
                 {"type": "addActivity", "activity": {"title": "文化探索与自由活动", "date": first + timedelta(days=1),
                  "notes": "待用户确认，开放与预约未知"}}], assumptions=["具体地点和开放规则待核实"])


def make_sources(snap):
    return Sources(portfolio._brief(snap, "规划旅行", "offline-portfolio"), production=True)


class ToolFake(FakeMessagesListChatModel):
    model_name: str = "portfolio-offline-test"

    def bind_tools(self, tools, **kwargs):
        assert not {"execute", "task", "write_file", "edit_file"} & {getattr(t, "name", None) for t in tools}
        return self


def test_proposal_uses_official_graph_and_keeps_snapshot_immutable(monkeypatch):
    snap = snapshot(); before = snap.model_dump_json()
    expected = draft_for(snap)
    model = ToolFake(responses=[AIMessage(content="", tool_calls=[{"name": "get_trip_snapshot", "args": {}, "id": "read"}]),
        AIMessage(content="", tool_calls=[{"name": "ProposalDraft", "args": expected.model_dump(mode="json"), "id": "proposal"}])])
    monkeypatch.setattr(portfolio, "_model", lambda tokens: (model, metadata("deepseek-flash")))
    async def no_network_trace(kind, brief, budget, sources, info, output_tokens, invoke):
        assert sources.production and not sources.replay and output_tokens == 10000
        assert budget.max_input_bytes == 40000
        return await invoke(), "https://example.org/offline-trace"
    monkeypatch.setattr(portfolio, "_invoke_traced", no_network_trace)
    generated = asyncio.run(portfolio.generate_proposal(snap, PlanRequest(requestId="fake-component")))
    assert generated.proposal == expected and generated.toolCalls == ["get_trip_snapshot"]
    assert snap.model_dump_json() == before


@pytest.mark.parametrize("wrong_day", [False, True])
def test_day_proposal_requires_successful_selected_day_context(monkeypatch, wrong_day):
    snap = snapshot(); existing = snap.activities[0]
    activity = existing.model_dump(mode="json", exclude={"id", "tripId", "sortKey", "createdAt", "updatedAt"})
    activity["notes"] = "根据当天检查保留弹性休息"
    expected = ProposalDraft(kind="day", title="当天小调整", summary="只讨论选中当天", actions=[
        {"type": "updateActivity", "activityId": existing.id, "activity": activity}])
    day = existing.date + timedelta(days=1) if wrong_day else existing.date
    model = ToolFake(responses=[AIMessage(content="", tool_calls=[
        {"name": "get_trip_snapshot", "args": {}, "id": "read"},
        {"name": "get_day_context", "args": {"day": day.isoformat()}, "id": "checks"}]),
        AIMessage(content="", tool_calls=[{"name": "ProposalDraft", "args": expected.model_dump(mode="json"), "id": "proposal"}])])
    monkeypatch.setattr(portfolio, "_model", lambda tokens: (model, metadata("deepseek-flash")))
    async def no_network_trace(kind, brief, budget, sources, info, output_tokens, invoke):
        return await invoke(), None
    monkeypatch.setattr(portfolio, "_invoke_traced", no_network_trace)
    call = portfolio.generate_proposal(snap, PlanRequest(kind="day", date=existing.date, requestId="day-component"))
    if wrong_day:
        with pytest.raises(ValueError, match="Required context"): asyncio.run(call)
    else:
        result = asyncio.run(call)
        assert result.proposal == expected and "get_day_context" in result.toolCalls


@pytest.mark.parametrize("missing", ["destination", "startDate", "endDate"])
def test_unknown_trip_details_block_planning_before_model(monkeypatch, missing):
    snap = snapshot(); setattr(snap.trip, missing, "" if missing == "destination" else None)
    model = Mock(); monkeypatch.setattr(portfolio, "_model", model)
    with pytest.raises(AgentError) as raised:
        asyncio.run(portfolio.generate_proposal(snap, PlanRequest(requestId="missing")))
    assert raised.value.code == "TRIP_DETAILS_REQUIRED"
    model.assert_not_called()


def test_foreign_trip_snapshot_is_rejected():
    snap = snapshot(); snap.activities[0].tripId = "different-trip"
    with pytest.raises(ValueError, match="Cross-trip"):
        portfolio._brief(snap, "test", "scope")


@pytest.mark.parametrize("invalid", ["id", "date", "place", "evidence", "duplicate", "one-day"])
def test_proposal_rejects_forged_or_out_of_scope_actions(invalid):
    snap = snapshot(); draft = draft_for(snap); request = PlanRequest(requestId="validate")
    sources = make_sources(snap)
    if invalid == "id":
        draft = ProposalDraft(kind="changes", title="x", summary="x", actions=[{"type": "removeActivity", "activityId": "foreign"}])
        request.kind = "changes"
    elif invalid == "date": draft.actions[0].activity.date = snap.trip.endDate + timedelta(days=1)
    elif invalid == "place": draft.actions[0].activity.place = Place(name="Fabricated", providerId="invented", latitude=1, longitude=2)
    elif invalid == "evidence": draft.evidenceRefs = ["ev:unobserved"]
    elif invalid == "duplicate": draft.actions[1] = draft.actions[0].model_copy(deep=True)
    elif invalid == "one-day": draft.actions[1].activity.date = snap.trip.startDate
    with pytest.raises(ValueError): portfolio._validate_proposal(draft, snap, request, sources)


def test_observed_place_is_allowed_but_coordinate_mutation_is_not():
    snap = snapshot(); sources = make_sources(snap); draft = draft_for(snap)
    place = Place(name="Observed", providerId="poi-fixture", latitude=31, longitude=121)
    ev = sources.add("poi", place.name, place.model_dump_json(), "provider", place=place)
    draft.actions[0].activity.place = place.model_copy(deep=True); draft.evidenceRefs = [ev.id]
    portfolio._validate_proposal(draft, snap, PlanRequest(requestId="ok"), sources)
    draft.actions[0].activity.place.latitude = 30
    with pytest.raises(ValueError, match="Unobserved proposal place"):
        portfolio._validate_proposal(draft, snap, PlanRequest(requestId="bad"), sources)


def test_day_changes_cannot_remove_other_day():
    snap = snapshot(); activity = snap.activities[0]
    requested = activity.date + timedelta(days=1)
    draft = ProposalDraft(kind="day", title="x", summary="x", actions=[{"type": "removeActivity", "activityId": activity.id}])
    with pytest.raises(ValueError, match="another day"):
        portfolio._validate_proposal(draft, snap, PlanRequest(kind="day", date=requested, requestId="day"), make_sources(snap))


def test_production_snapshot_does_not_mislabel_user_as_synthetic():
    sources = make_sources(snapshot())
    value = sources.snapshot()
    assert "人工构造" not in value["notice"]
    assert next(iter(sources.evidence.values())).title == "Workspace Trip snapshot"


@pytest.mark.parametrize("url,allowed", [
    ("https://www.shanxi.gov.cn/tourism", True), ("https://news.cn/story", True),
    ("https://gov.cn.attacker.example/story", False), ("https://xiaohongshu.com/story", False),
    ("https://example.org/story", False)])
def test_authoritative_source_policy_has_host_boundaries(url, allowed):
    assert authoritative_url(url) is allowed


def test_authoritative_search_filters_provider_results_and_preserves_scope(monkeypatch):
    sources = Sources(portfolio._brief(snapshot(), "test", "web"), production=True, authoritative_only=True)
    fake = SimpleNamespace(search=AsyncMock(return_value={"results": [
        {"url": "https://www.shanxi.gov.cn/travel", "title": "政府资料", "content": "文化资料"},
        {"url": "https://xiaohongshu.com/note", "title": "社区资料", "content": "社区内容"}]}))
    monkeypatch.setattr(sources, "web_client", lambda: fake)
    result = asyncio.run(sources.web("古建旅行"))
    assert len(result["evidence"]) == 1 and result["evidence"][0]["url"].startswith("https://www.shanxi.gov.cn")
    assert "gov.cn" in fake.search.await_args.kwargs["include_domains"]
    assert sources.counts["web"] == 1 and sources.counts["credits"] == 1


@pytest.mark.parametrize("content", ["", "  \n", None, {"not": "text"}])
def test_empty_or_nontext_provider_content_never_becomes_evidence(monkeypatch, content):
    sources = Sources(portfolio._brief(snapshot(), "test", "empty"), production=True, authoritative_only=True)
    url = "https://www.shanxi.gov.cn/travel"
    fake = SimpleNamespace(search=AsyncMock(return_value={"results": [{"url": url, "title": "政府资料", "content": content}]}),
                           extract=AsyncMock(return_value={"results": [{"url": url, "raw_content": content}]}))
    monkeypatch.setattr(sources, "web_client", lambda: fake)
    assert asyncio.run(sources.web("test"))["evidence"] == []
    assert not sources.evidence and sources.events[-1]["results"] == 0
    sources.add("web", "Valid prior snippet", "非空的先前搜索摘录", "search_excerpt", url=url)
    extracted = asyncio.run(sources.extract([url]))
    assert extracted["evidence"] == [] and extracted["failedCount"] == 1
    assert sources.events[-1]["status"] == "PARTIAL"


def test_production_excerpts_are_bounded_with_exact_source_and_excerpt_hashes(monkeypatch):
    import hashlib
    sources = Sources(portfolio._brief(snapshot(), "test", "compact"), production=True, authoritative_only=True)
    text = "有来源的资料片段。" * 1000
    url = "https://www.shanxi.gov.cn/travel"
    fake = SimpleNamespace(search=AsyncMock(return_value={"results": [{"url": url, "title": "政府资料", "content": text}]}),
                           extract=AsyncMock(return_value={"results": [{"url": url, "raw_content": text}]}))
    monkeypatch.setattr(sources, "web_client", lambda: fake)
    first = asyncio.run(sources.web("test"))["evidence"][0]
    second = asyncio.run(sources.extract([url]))["evidence"][0]
    for evidence, limit in [(first, 350), (second, 800)]:
        assert evidence["excerpt"] == text[:limit]
        assert evidence["excerptTruncated"] is True
        assert "contentHash" not in evidence and "sourceContentHash" not in evidence
        stored = sources.evidence[evidence["id"]]
        assert stored.excerpt == text[:6000]
        assert stored.contentHash == hashlib.sha256(text[:6000].encode()).hexdigest()
        assert stored.sourceContentHash == hashlib.sha256(text.encode()).hexdigest()


def test_province_scope_is_preserved_instead_of_replaced_by_capital(monkeypatch):
    snap = snapshot(); snap.trip.destination = "山西"
    sources = Sources(portfolio._brief(snap, "古建", "province"), production=True, province_scope=portfolio._province_scope("山西"))
    search = AsyncMock(return_value=[Place(name="云冈石窟", providerId="fixture")])
    monkeypatch.setattr(research_sources, "search_places", search)
    asyncio.run(sources.amap("大同 云冈石窟"))
    search.assert_awaited_once_with("大同 云冈石窟", "山西", province="山西省")
    assert portfolio._province_scope("浙江省") == "浙江省"
    assert portfolio._province_scope("杭州") is None


def test_research_dates_remain_unknown_until_user_supplies_them():
    snap = snapshot(); snap.trip.startDate = snap.trip.endDate = None
    brief = portfolio._brief(snap, "研究地点", "undated")
    result = ResearchResult(summary="待定日期", status="partial", candidates=[Candidate(title="x", rationale="x",
        proposedDate="2026-11-01", claims=[Claim(text="待研究", kind="inference")])])
    with pytest.raises(ValueError, match="known trip dates"): validate_result(result, [], brief)


@pytest.mark.parametrize("cancel", [False, True])
@pytest.mark.parametrize("readback", [False, True])
def test_traced_invocation_uses_global_reservation_and_holds_unknown_usage(tmp_path, monkeypatch, cancel, readback):
    snap = snapshot(); sources = make_sources(snap); brief = sources.brief; budget = RunBudget(40000)
    ledger = BudgetLedger(tmp_path / "ledger.sqlite3")
    monkeypatch.setattr(portfolio, "BudgetLedger", lambda: ledger)
    monkeypatch.setattr(portfolio, "ROOT", tmp_path)
    monkeypatch.setenv("LANGSMITH_API_KEY", "offline-key-not-real")
    root = SimpleNamespace(trace_id="fixture-root", end=Mock())
    monkeypatch.setattr(portfolio, "trace", lambda *a, **kw: nullcontext(root))
    monkeypatch.setattr(portfolio, "tracing_context", lambda **kw: nullcontext())
    client = SimpleNamespace(flush=Mock(), read_run=Mock(return_value=root), get_run_url=Mock(return_value="https://example.org/trace"))
    if not readback: client.read_run.side_effect = RuntimeError("untrusted-provider-text")
    monkeypatch.setattr(portfolio, "trace_client", lambda: client)
    async def invoke():
        assert ledger.totals()["cnyConservativeBudgetCharge"] == 5
        budget.requests = 1
        if cancel: raise asyncio.CancelledError()
        budget.usage_requests = 1; budget.input_tokens = 1000; budget.output_tokens = 100
        return {"result": "offline"}
    call = portfolio._invoke_traced("test", brief, budget, sources, metadata("deepseek-flash"), 5000, invoke)
    if cancel:
        with pytest.raises(asyncio.CancelledError): asyncio.run(call)
        assert ledger.totals()["cnyConservativeBudgetCharge"] == 5
        client.flush.assert_not_called()
    else:
        result, url = asyncio.run(call)
        assert result == {"result": "offline"}
        assert url == ("https://example.org/trace" if readback else None)
        assert ledger.totals()["cnyConservativeBudgetCharge"] == pytest.approx(.4042)
        client.read_run.assert_called_once()
        if not readback: client.get_run_url.assert_not_called()
    assert ledger.totals()["traceSlotsReserved"] == 4
    assert len(list((tmp_path / "data/portfolio-agent-runs").glob("*.json"))) == 1


def test_input_size_excludes_unoffered_tool_schemas_but_still_denies_them():
    from langchain_core.tools import StructuredTool
    from langchain_core.messages import SystemMessage
    from apps.api.agent.research import ResearchBoundary
    budget = RunBudget(2000)
    boundary = ResearchBoundary({"get_trip_snapshot"}, budget)
    tools = [StructuredTool.from_function(lambda: None, name="get_trip_snapshot", description="Read fixture"),
             StructuredTool.from_function(lambda: None, name="execute", description="large unoffered schema " * 5000)]
    request = SimpleNamespace(tools=tools, messages=[], system_message=SystemMessage(content="policy"),
                              override=lambda **kw: SimpleNamespace(**kw))
    handler = AsyncMock(return_value=SimpleNamespace(result=[AIMessage(content="ok")]))
    asyncio.run(boundary.awrap_model_call(request, handler))
    assert [t.name for t in handler.await_args.args[0].tools] == ["get_trip_snapshot"]
    assert budget.input_sizes[0] < 2000
    denied_handler = AsyncMock()
    denied = asyncio.run(boundary.awrap_tool_call(SimpleNamespace(tool_call={"name": "execute", "args": {}, "id": "denied"}), denied_handler))
    assert denied.status == "error"
    denied_handler.assert_not_called()


def test_output_and_cash_caps_cover_large_proposals_without_pilot35_reservation():
    info = metadata("deepseek-flash")
    assert portfolio._reservation(info, 10000) == 6
    assert portfolio._reservation(info, 5000) == 5


def test_missing_research_sources_blocks_before_model(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY")
    model = Mock(); monkeypatch.setattr(portfolio, "_model", model)
    with pytest.raises(AgentError) as raised:
        asyncio.run(portfolio.research_for_trip(snapshot(), "请研究适合长辈的地点"))
    assert raised.value.code == "RESEARCH_SOURCES_NOT_CONFIGURED"
    model.assert_not_called()


def test_mixed_old_evidence_schema_blocks_before_model(monkeypatch):
    monkeypatch.setattr(research_sources, "Evidence", SimpleNamespace(model_fields={"contentHash": object()}))
    model = Mock(); monkeypatch.setattr(portfolio, "_model", model)
    with pytest.raises(AgentError) as raised:
        asyncio.run(portfolio.generate_proposal(snapshot(), PlanRequest(requestId="stale-server")))
    assert raised.value.code == "PORTFOLIO_RUNTIME_MISMATCH"
    model.assert_not_called()


def test_validation_diagnostics_never_echo_untrusted_exception_text():
    assert portfolio._validation_failure(ValueError("some-secret-provider-error")) == {"validationCode": "OUTPUT_VALIDATION_FAILED"}
    assert portfolio._validation_failure(ValueError("Multi-day blueprint must span multiple days")) == {"validationCode": "BLUEPRINT_NOT_MULTIDAY"}


def test_invalid_json_still_settles_known_usage_and_returns_specific_safe_error(tmp_path, monkeypatch):
    import json
    from langchain_core.messages import SystemMessage
    from apps.api.agent.research import ResearchBoundary
    sources = make_sources(snapshot()); budget = RunBudget(40000)
    ledger = BudgetLedger(tmp_path / "invalid-json.sqlite3")
    monkeypatch.setattr(portfolio, "BudgetLedger", lambda: ledger)
    monkeypatch.setattr(portfolio, "ROOT", tmp_path)
    monkeypatch.setenv("LANGSMITH_API_KEY", "offline-key-not-real")
    root = SimpleNamespace(end=Mock())
    monkeypatch.setattr(portfolio, "trace", lambda *a, **kw: nullcontext(root))
    monkeypatch.setattr(portfolio, "tracing_context", lambda **kw: nullcontext())
    monkeypatch.setattr(portfolio, "trace_client", lambda: SimpleNamespace(flush=Mock(), read_run=Mock(return_value=root),
        get_run_url=Mock(return_value="https://example.org/verified-offline")))
    message = AIMessage(content="", invalid_tool_calls=[{"name": "ProposalDraft", "args": '{"title":"private"quote"}',
        "id": "bad", "error": "private raw provider error"}],
        usage_metadata={"input_tokens": 123, "output_tokens": 45, "total_tokens": 168})
    handler = AsyncMock(return_value=SimpleNamespace(result=[message]))
    request = SimpleNamespace(tools=[], messages=[], system_message=SystemMessage(content="Fixture"), override=lambda **kw: SimpleNamespace(**kw))
    async def invoke():
        return await ResearchBoundary(set(), budget).awrap_model_call(request, handler)
    with pytest.raises(AgentError) as raised:
        asyncio.run(portfolio._invoke_traced("invalid-json", sources.brief, budget, sources,
            metadata("deepseek-flash"), 10000, invoke))
    assert raised.value.code == "INVALID_STRUCTURED_TOOL_JSON"
    handler.assert_awaited_once()
    assert ledger.totals()["cnyConservativeBudgetCharge"] == pytest.approx(.4009)
    record = json.loads(next((tmp_path / "data/portfolio-agent-runs").glob("*.json")).read_text(encoding="utf-8"))
    assert record["modelRequests"] == record["usageRequests"] == 1 and record["traceVerified"] is True
    assert record["diagnostics"]["invalidStructuredTools"][0]["toolName"] == "ProposalDraft"
    assert record["diagnostics"]["errorCode"] == "INVALID_STRUCTURED_TOOL_JSON"
    assert "private" not in str(record)


@pytest.mark.parametrize("web_supported,place_bound", [(True, True), (False, True), (True, False)])
def test_research_forwards_official_delegation_and_requires_poi_and_web(monkeypatch, web_supported, place_bound):
    snap = snapshot(); before = snap.model_dump_json()
    monkeypatch.setattr(portfolio, "_model", lambda tokens: (object(), metadata("deepseek-flash")))
    async def fake_run(brief, architecture, **kwargs):
        assert architecture == "B" and kwargs["model_is_live"] and kwargs["max_input_bytes"] == 40000
        assert kwargs["profile_provider"] == "deepseek"
        assert kwargs["response_schema"] is portfolio.ProductionResearchResult
        sources = kwargs["sources"]
        assert sources.production and sources.authoritative_only and not sources.replay
        place = Place(name="观察到的文化景点", providerId="offline-poi")
        poi = sources.add("poi", place.name, place.model_dump_json(), "provider", place=place)
        web = sources.add("web", "政府文化资料", "测试支持内容", "search_excerpt", url="https://www.shanxi.gov.cn/culture")
        result = ResearchResult(summary="真实工具模式的离线测试", status="partial", candidates=[Candidate(
            title=place.name, rationale="文化兴趣匹配", placeEvidenceRef=poi.id if place_bound else None,
            claims=[Claim(text="文化资料", kind="fact", evidenceRefs=[web.id if web_supported else poi.id])])],
            limitations=["开放与未来预约未核实"])
        return {"status": "Pass", "result": result.model_dump(mode="json"),
                "evidence": [e.model_dump(mode="json") for e in sources.evidence.values()], "toolCalls": ["task", "search_places", "web_search"]}
    monkeypatch.setattr(portfolio, "run_research", fake_run)
    async def no_network_trace(kind, brief, budget, sources, info, output_tokens, invoke):
        assert output_tokens == 5000
        return await invoke(), "https://example.org/offline-trace"
    monkeypatch.setattr(portfolio, "_invoke_traced", no_network_trace)
    if web_supported and place_bound:
        result = asyncio.run(portfolio.research_for_trip(snap, "研究文化景点"))
        assert len(result["result"]["candidates"]) == 1 and result["traceUrl"]
        assert result["toolCalls"][0] == "task"
    else:
        with pytest.raises(AgentError) as raised:
            asyncio.run(portfolio.research_for_trip(snap, "研究文化景点"))
        assert raised.value.code == ("RESEARCH_CANDIDATE_EVIDENCE_UNSUPPORTED" if place_bound else "RESEARCH_CANDIDATE_PLACE_UNBOUND")
    assert snap.model_dump_json() == before


@pytest.mark.parametrize("province", [None, "山西省"])
def test_amap_province_extension_filters_administrative_scope_and_preserves_city_default(monkeypatch, province):
    import httpx
    from apps.api.agent import places
    captured = {}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, params):
            captured.update(params)
            return httpx.Response(200, request=httpx.Request("GET", url), json={"status": "1", "pois": [
                {"id": "datong", "name": "云冈石窟", "pname": "山西省", "cityname": "大同市", "address": "云冈区", "location": "113.13,40.11"},
                {"id": "other", "name": "异省同名点", "pname": "陕西省", "location": "109,34"},
                {"id": "unknown", "name": "行政区缺失", "location": "113,40"}]})
    monkeypatch.setattr(places.httpx, "AsyncClient", Client)
    result = asyncio.run(places.search_places("大同 云冈石窟", "山西" if province else "大同", province=province))
    if province:
        assert [p.providerId for p in result] == ["datong"]
        assert "大同市" in result[0].address
        assert captured["citylimit"] == "false" and "city" not in captured
        assert captured["keywords"].startswith("山西省 ")
    else:
        assert captured["city"] == "大同" and captured["citylimit"] == "true"
        assert result[0].address == "云冈区"


def test_official_delegation_with_large_source_payloads_stays_inside_context_cap(monkeypatch):
    from apps.api.agent.research import run_research
    class ResearchFake(ToolFake):
        def bind_tools(self, tools, **kwargs):
            assert "execute" not in {getattr(t, "name", None) for t in tools}
            return self
    snap = snapshot(); brief = portfolio._brief(snap, "文化研究", "compact-official-graph")
    sources = Sources(brief, production=True, authoritative_only=True)
    known = Sources(brief, production=True, authoritative_only=True)
    text = "明确标记的离线来源内容，不代表真实旅行知识。" * 600
    place = Place(name="离线测试景点", providerId="offline-scoped-poi", latitude=31, longitude=121)
    poi = known.add("poi", place.name, place.model_dump_json(), "provider", providerId=place.providerId, place=place)
    web = known.add("web", "测试资料", text, "search_excerpt", excerpt_limit=6000,
        url="https://www.shanxi.gov.cn/one/0", publisher="www.shanxi.gov.cn")
    async def search(**kwargs):
        return {"results": [{"url": f"https://www.shanxi.gov.cn/{kwargs['query']}/{i}",
                              "title": "测试资料", "content": text} for i in range(4)]}
    fake_web = SimpleNamespace(search=search, extract=AsyncMock(return_value={"results": [
        {"url": web.url, "raw_content": text}]}))
    monkeypatch.setattr(sources, "web_client", lambda: fake_web)
    monkeypatch.setattr(research_sources, "search_places", AsyncMock(return_value=[place]))
    result = ResearchResult(summary="离线图运行测试", status="partial", candidates=[Candidate(title=place.name,
        rationale="测试偏好匹配", placeEvidenceRef=poi.id, claims=[Claim(text="测试内容", kind="fact", evidenceRefs=[web.id])])])
    def call(name, args, ident):
        return {"name": name, "args": args, "id": ident}
    model = ResearchFake(responses=[
        AIMessage(content="", tool_calls=[call("get_trip_snapshot", {}, "main-snapshot")]),
        AIMessage(content="", tool_calls=[call("task", {"subagent_type": "research", "description": "研究用户问题；自己读取相同快照。"}, "delegate")]),
        AIMessage(content="", tool_calls=[call("get_trip_snapshot", {}, "child-snapshot")]),
        AIMessage(content="", tool_calls=[call("search_places", {"query": "测试地点"}, "poi"), call("web_search", {"query": "one"}, "web1")]),
        AIMessage(content="", tool_calls=[call("web_search", {"query": "two"}, "web2"), call("read_pages", {"evidence_id": web.id}, "page")]),
        AIMessage(content="", tool_calls=[call("ResearchResult", result.model_dump(mode="json"), "research-result")]),
        AIMessage(content="", tool_calls=[call("ResearchSelection", {"useResearchResult": True, "explanation": "采用已校验结果"}, "main-result")]),
    ])
    budget = RunBudget(40000)
    record = asyncio.run(run_research(brief, "B", model=model, sources=sources, budget=budget,
        max_input_bytes=40000, profile_provider="openai", policy=portfolio.RESEARCH_POLICY,
        response_schema=portfolio.ProductionResearchResult,
        coordinator_policy="简短委派，子代理自己读取快照。"))
    assert record["status"] == "Pass", record
    assert record["modelRequests"] == 7 and len(record["result"]["candidates"]) == 1
    assert max(record["inputBytesPerAttempt"]) < 40000
    assert sources.counts == {"amap": 1, "web": 2, "extract": 1, "credits": 3}
    assert len([e for e in sources.evidence.values() if e.sourceType == "web"]) == 5


def test_production_schema_requires_place_but_preserves_r1_and_no_results():
    from pydantic import ValidationError
    from langchain.agents.structured_output import ToolStrategy
    base = {"title": "候选", "rationale": "推断", "claims": [{"text": "推断", "kind": "inference"}]}
    assert Candidate.model_validate(base).placeEvidenceRef is None
    assert Candidate.model_validate({**base, "placeEvidenceRef": None}).placeEvidenceRef is None
    for value in ({}, {"placeEvidenceRef": None}, {"placeEvidenceRef": ""}, {"placeEvidenceRef": "  "}):
        with pytest.raises(ValidationError): portfolio.ProductionCandidate.model_validate({**base, **value})
    accepted = portfolio.ProductionCandidate.model_validate({**base, "placeEvidenceRef": "ev:observed"})
    assert accepted.placeEvidenceRef == "ev:observed"
    assert portfolio.ProductionResearchResult.model_validate({"summary": "暂无足够证据", "status": "no_results", "candidates": []}).candidates == []
    schema = portfolio.ProductionCandidate.model_json_schema()
    assert "placeEvidenceRef" in schema["required"]
    assert schema["properties"]["placeEvidenceRef"]["type"] == "string"
    assert schema["properties"]["placeEvidenceRef"]["minLength"] == 1
    assert ToolStrategy(portfolio.ProductionResearchResult).schema_specs[0].name == "ResearchResult"


@pytest.mark.parametrize("invalid_place", ["missing", None, ""])
@pytest.mark.parametrize("repeat_invalid", [False, True])
def test_required_production_place_uses_official_single_schema_repair(monkeypatch, invalid_place, repeat_invalid):
    import copy
    from pydantic import Field
    from langchain_core.messages import ToolMessage
    from apps.api.agent.research import run_research
    class ResearchFake(ToolFake):
        repair_messages: list[str] = Field(default_factory=list)
        def bind_tools(self, tools, **kwargs):
            assert "execute" not in {getattr(t, "name", None) for t in tools}
            return self
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self.repair_messages.extend(str(m.content) for m in messages if isinstance(m, ToolMessage)
                                        and "格式错误" in str(m.content))
            return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    brief = build_brief("shanghai_seniors", 1)
    observed = asyncio.run(Sources(brief, replay=True).amap("fixture"))["evidence"][0]["id"]
    invalid = {"summary": "离线schema测试", "status": "partial", "candidates": [{"title": "固定测试地点",
        "rationale": "推断：匹配用户兴趣", "claims": [{"text": "测试推断", "kind": "inference", "evidenceRefs": [observed]}]}]}
    if invalid_place != "missing": invalid["candidates"][0]["placeEvidenceRef"] = invalid_place
    corrected = copy.deepcopy(invalid); corrected["candidates"][0]["placeEvidenceRef"] = observed
    def call(name, args, ident):
        return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": ident}])
    model = ResearchFake(responses=[call("get_trip_snapshot", {}, "main-s"),
        call("task", {"subagent_type": "research", "description": "Run offline schema test"}, "task"),
        call("get_trip_snapshot", {}, "child-s"), call("search_places", {"query": "fixture"}, "poi"),
        call("ResearchResult", invalid, "invalid"),
        call("ResearchResult", invalid if repeat_invalid else corrected, "repair"),
        call("ResearchSelection", {"useResearchResult": True, "explanation": "采用子代理结果"}, "selection")])
    record = asyncio.run(run_research(brief, "B", replay=True, model=model,
        response_schema=portfolio.ProductionResearchResult))
    assert record["schemaRepairs"] == 1
    assert any("placeEvidenceRef必填且为非空字符串" in text for text in model.repair_messages)
    if repeat_invalid:
        assert record["status"] == "Fail" and record["errorType"] == "StructuredOutputValidationError"
        assert record["modelRequests"] == 6 and "result" not in record
    else:
        assert record["status"] == "Pass" and record["modelRequests"] == 7
        assert record["result"]["candidates"][0]["placeEvidenceRef"] == observed
