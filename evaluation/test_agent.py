import asyncio
import os
from unittest.mock import AsyncMock
import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from packages.contracts import TripSnapshot, Trip, Activity, ChatRequest, Place
from apps.api.agent import service
from apps.api.agent.errors import AgentError
from apps.api.agent import places as poi


@pytest.fixture
def snapshot():
    stamp="2026-10-26T00:00:00Z"
    trip=Trip(id="trip1",title="杭州",destination="杭州",startDate="2026-11-02",endDate="2026-11-06",createdAt=stamp,updatedAt=stamp)
    return TripSnapshot(version=4,trip=trip,activities=[Activity(id="a1",tripId=trip.id,title="散步",date="2026-11-02",sortKey=0,createdAt=stamp,updatedAt=stamp)])


class ToolFake(FakeMessagesListChatModel):
    model_name: str = "unit-test-model"
    def bind_tools(self, tools, **kwargs):
        names=[getattr(t,"name",None) or t.get("function",{}).get("name", t.get("name")) for t in tools]
        assert not set(names) & {"execute","task","write_file","read_file"}
        return self


def fake(*responses): return ToolFake(responses=list(responses))
def call(name,args,id): return AIMessage(content="",tool_calls=[{"name":name,"args":args,"id":id}])


def test_demo_uses_latest_snapshot_no_model_or_poi(snapshot,monkeypatch):
    monkeypatch.setattr(service,"_make_model",lambda:pytest.fail("Demo called model"))
    search=AsyncMock()
    result=asyncio.run(service.run_chat("trip1",ChatRequest(message="第一天太满吗",mode="demo"),lambda _:snapshot,search,[]))
    assert result.snapshotVersion==4 and result.mode=="demo" and result.traceUrl is None
    assert "演示" in result.reply and "1 项" in result.reply
    assert len(snapshot.ideas)==0 and len(snapshot.activities)==1 and snapshot.version==4
    search.assert_not_called()


def test_real_missing_key_never_falls_back(snapshot,monkeypatch):
    monkeypatch.delenv("DASHSCOPE_API_KEY",raising=False)
    with pytest.raises(AgentError) as exc:
        asyncio.run(service.run_chat("trip1",ChatRequest(message="hi"),lambda _:snapshot,AsyncMock(),[]))
    assert exc.value.status==503 and exc.value.code=="AGENT_NOT_CONFIGURED"


def test_actual_deepagents_graph_calls_tools_and_validates_schema(snapshot,monkeypatch):
    place=Place(name="西湖",providerId="P1",latitude=30.24,longitude=120.14,address="杭州")
    model=fake(call("get_trip_snapshot",{},"read1"),call("search_places",{"query":"西湖"},"search1"),
               call("AgentOutput",{"reply":"当前只有一项未定时安排。","suggestions":[{"title":"西湖","rationale":"高德检索地点", "place":place.model_dump(),"evidenceRefs":["amap:P1"]}],"uncertainty":["交通未验证"]},"answer1"))
    monkeypatch.setattr(service,"_make_model",lambda:model)
    monkeypatch.setattr(service,"_trace_client",lambda:None)
    seen=[]
    def get(id): seen.append(id); return snapshot
    search=AsyncMock(return_value=[place])
    result=asyncio.run(service.run_chat("trip1",ChatRequest(message="找西湖"),get,search,[]))
    assert result.mode=="real" and result.toolCalls==["get_trip_snapshot","search_places"]
    assert result.suggestions[0].status=="proposed" and result.suggestions[0].place==place
    assert seen==["trip1","trip1"] and snapshot.version==4 and not snapshot.ideas
    search.assert_awaited_once_with("西湖","杭州")


def test_model_without_snapshot_is_rejected(snapshot,monkeypatch):
    monkeypatch.setattr(service,"_make_model",lambda:fake(call("AgentOutput",{"reply":"done"},"answer")))
    monkeypatch.setattr(service,"_trace_client",lambda:None)
    with pytest.raises(AgentError,match="最新旅行"):
        asyncio.run(service.run_chat("trip1",ChatRequest(message="hi"),lambda _:snapshot,AsyncMock(),[]))


def test_fabricated_place_is_rejected(snapshot,monkeypatch):
    monkeypatch.setattr(service,"_make_model",lambda:fake(call("get_trip_snapshot",{},"read"),call("AgentOutput",{"reply":"done","suggestions":[{"title":"Fake","rationale":"x","place":{"name":"Fake","providerId":"fake"}}]},"answer")))
    monkeypatch.setattr(service,"_trace_client",lambda:None)
    with pytest.raises(AgentError) as exc:
        asyncio.run(service.run_chat("trip1",ChatRequest(message="hi"),lambda _:snapshot,AsyncMock(),[]))
    assert exc.value.code=="AGENT_UNVERIFIED_PLACE"


def test_poi_missing_key_no_network(monkeypatch):
    monkeypatch.delenv("AMAP_WEB_SERVICE_KEY",raising=False)
    with pytest.raises(AgentError) as exc: asyncio.run(poi.search_places("西湖","杭州"))
    assert exc.value.status==503


def test_poi_parsing_and_provider_error_are_safe(monkeypatch):
    monkeypatch.setenv("AMAP_WEB_SERVICE_KEY","unit-secret-not-real")
    class Response:
        def raise_for_status(self): pass
        def json(self): return {"status":"1","pois":[{"id":"P1","name":"西湖","location":"120.14,30.24","address":[]}]}
    class Client:
        def __init__(self,**kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def get(self,*args,**kwargs): return Response()
    monkeypatch.setattr(poi.httpx,"AsyncClient",Client)
    result=asyncio.run(poi.search_places("西湖","杭州"))
    assert result[0].latitude==30.24 and result[0].address is None
    monkeypatch.setattr(Response,"json",lambda self:{"status":"0","infocode":"10001","info":"unit-secret-not-real"})
    with pytest.raises(AgentError) as exc: asyncio.run(poi.search_places("西湖","杭州"))
    assert "unit-secret" not in str(exc.value) and exc.value.status==502


def test_tool_permission_boundary_blocks_unoffered_tool():
    from types import SimpleNamespace
    request=SimpleNamespace(tool_call={"name":"read_file","id":"forged-call","args":{"file_path":".env"}})
    handler=AsyncMock()
    result=asyncio.run(service.ToolBoundary().awrap_tool_call(request,handler))
    assert result.status=="error" and "not permitted" in result.content
    handler.assert_not_called()


def test_trace_redaction_hides_secrets_and_payloads(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING","true")
    monkeypatch.setenv("LANGSMITH_API_KEY","trace-test-secret")
    monkeypatch.setenv("AMAP_WEB_SERVICE_KEY","poi-test-secret")
    monkeypatch.setenv("DASHSCOPE_API_KEY","model-test-secret")
    monkeypatch.setattr(service,"Client",lambda **kwargs:kwargs)
    config=service._trace_client()
    assert config["hide_inputs"] is True and config["hide_outputs"] is True
    scrub=config["process_buffered_run_ops"]
    safe=scrub([{"name":"search_places","extra":{"api_key":"trace-test-secret","model":"qwen3.8-flash"},"error":"private user message", "request":"https://example?key=poi-test-secret&x=1"}])
    assert "test-secret" not in str(safe) and "private user" not in str(safe)
    assert safe[0]["name"]=="search_places" and safe[0]["extra"]["model"]=="qwen3.8-flash"


def test_latest_snapshot_is_read_at_tool_time(snapshot,monkeypatch):
    model=fake(call("get_trip_snapshot",{},"read"),call("AgentOutput",{"reply":"latest"},"answer"))
    monkeypatch.setattr(service,"_make_model",lambda:model)
    monkeypatch.setattr(service,"_trace_client",lambda:None)
    versions=iter([snapshot,snapshot.model_copy(update={"version":5})])
    result=asyncio.run(service.run_chat("trip1",ChatRequest(message="hi"),lambda _:next(versions),AsyncMock(),[]))
    assert result.snapshotVersion==5


def test_out_of_range_suggestion_date_rejected(snapshot,monkeypatch):
    monkeypatch.setattr(service,"_make_model",lambda:fake(call("get_trip_snapshot",{},"read"),call("AgentOutput",{"reply":"done","suggestions":[{"title":"x","rationale":"x","proposedDate":"2026-12-01"}]},"answer")))
    monkeypatch.setattr(service,"_trace_client",lambda:None)
    with pytest.raises(AgentError) as exc:
        asyncio.run(service.run_chat("trip1",ChatRequest(message="hi"),lambda _:snapshot,AsyncMock(),[]))
    assert exc.value.code=="AGENT_INVALID_DATE"


def test_snapshot_tool_exposes_trip_local_today_across_utc_boundary(snapshot,monkeypatch):
    import json
    from datetime import datetime, timezone
    from langchain_core.messages import ToolMessage
    from pydantic import Field

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026,11,2,3,0,tzinfo=timezone.utc).astimezone(tz)

    class InspectTimeFake(ToolFake):
        tool_results: list[dict] = Field(default_factory=list)
        def _generate(self,messages,*args,**kwargs):
            for message in messages:
                if isinstance(message,ToolMessage) and message.name=="get_trip_snapshot":
                    self.tool_results.append(json.loads(message.content))
            return super()._generate(messages,*args,**kwargs)

    snapshot.trip.timezone="Pacific/Honolulu"
    model=InspectTimeFake(responses=[call("get_trip_snapshot",{},"read"),call("AgentOutput",{"reply":"今天不在旅行日期内"},"answer")])
    monkeypatch.setattr(service,"datetime",FixedDatetime)
    monkeypatch.setattr(service,"_make_model",lambda:model)
    monkeypatch.setattr(service,"_trace_client",lambda:None)
    asyncio.run(service.run_chat("trip1",ChatRequest(message="今天日程是不是太满"),lambda _:snapshot,AsyncMock(),[]))
    clock=model.tool_results[-1]
    assert clock["currentLocalDate"]=="2026-11-01"
    assert clock["currentLocalTime"]=="2026-11-01T17:00:00-10:00"
    assert clock["timezone"]=="Pacific/Honolulu" and clock["todayWithinTrip"] is False


def test_demo_distinguishes_today_from_first_trip_day(snapshot,monkeypatch):
    monkeypatch.setattr(service,"_local_clock",lambda _:{"currentLocalDate":"2026-10-26","timezone":"Asia/Shanghai","todayWithinTrip":False})
    result=asyncio.run(service.run_chat("trip1",ChatRequest(message="今天日程是不是太满",mode="demo"),lambda _:snapshot,AsyncMock(),[]))
    assert "今天是 2026-10-26" in result.reply and "不在旅行日期内" in result.reply
    assert "另外评估旅行第一天" in result.reply and "2026-11-02" in result.reply


def test_trace_readback_retries_eventual_ingest():
    from unittest.mock import Mock
    client=Mock()
    recorded=object()
    client.read_run.side_effect=[LookupError("pending"),LookupError("pending"),recorded]
    client.get_run_url.return_value="https://example.test/verified-run"
    assert asyncio.run(service._verified_trace_url(client,"run-id"))=="https://example.test/verified-run"
    assert client.read_run.call_count==3
    client.flush.assert_called_once_with(timeout=3)
    client.get_run_url.assert_called_once_with(run=recorded)


def test_trace_readback_never_invents_url_after_failed_retries():
    from unittest.mock import Mock
    client=Mock()
    client.read_run.side_effect=LookupError("pending")
    assert asyncio.run(service._verified_trace_url(client,"run-id")) is None
    assert client.read_run.call_count==3
    client.get_run_url.assert_not_called()
