"""R1 deterministic sources and official-graph component tests; never live APIs."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import Field
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool

from apps.api.agent import research, research_sources
from apps.api.agent.research import ResearchBoundary, RunBudget
from apps.api.agent.research_contracts import ResearchResult
from apps.api.agent.research_sources import Sources, safe_public_url
from evaluation.research_fixtures import build_brief


class ToolFake(FakeMessagesListChatModel):
    model_name: str = "research-component-test"

    def bind_tools(self, tools, **kwargs):
        names = {getattr(t, "name", None) for t in tools}
        assert "execute" not in names
        return self


def call(name, args, ident):
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": ident}])


def payload(ref, status="complete"):
    return {"summary": "固定组件测试：行程包含未定时活动。", "status": status,
            "claims": [{"text": "快照含用户安排。", "kind": "fact", "evidenceRefs": [ref]}],
            "candidates": [], "coverage": ["snapshot"], "limitations": ["固定测试不验证真实旅行来源。"]}


def run(coro):
    return asyncio.run(coro)


def test_boundary_denies_fabricated_write_tool_without_executing_handler():
    boundary = ResearchBoundary({"get_trip_snapshot"}, RunBudget())
    handler = AsyncMock()
    request = SimpleNamespace(tool_call={"name": "write_trip", "args": {}, "id": "bad"})
    output = run(boundary.awrap_tool_call(request, handler))
    assert output.status == "error" and output.content == "PERMISSION_DENIED"
    handler.assert_not_called()


def test_boundary_allows_read_tool_and_records_call():
    budget = RunBudget()
    boundary = ResearchBoundary({"get_trip_snapshot"}, budget)
    request = SimpleNamespace(tool_call={"name": "get_trip_snapshot", "args": {}, "id": "read"})
    handler = AsyncMock(return_value=ToolMessage(content="fixture", tool_call_id="read"))
    output = run(boundary.awrap_tool_call(request, handler))
    assert output.content == "fixture" and budget.tool_calls == ["get_trip_snapshot"]
    handler.assert_awaited_once_with(request)


def test_near_budget_reminds_model_without_silently_removing_valid_tools():
    budget=RunBudget();budget.requests=8
    boundary=ResearchBoundary({'get_trip_snapshot'},budget)
    read=StructuredTool.from_function(lambda: None,name='get_trip_snapshot',description='Fixture')
    original=SystemMessage(content='Original policy')
    request=SimpleNamespace(tools=[read],messages=[],system_message=original,
        override=lambda **kw:SimpleNamespace(**kw))
    handler=AsyncMock(return_value=SimpleNamespace(result=[AIMessage(content='done')]))
    run(boundary.awrap_model_call(request,handler))
    actual=handler.await_args.args[0]
    assert actual.tools==[read]
    assert '仅剩4次' in actual.system_message.content
    assert original.content=='Original policy'
    assert budget.requests==9


def test_shared_model_budget_filters_tools_and_counts_usage():
    budget = RunBudget()
    first, second = ResearchBoundary({"get_trip_snapshot"}, budget), ResearchBoundary({"web_search"}, budget)
    offered = [StructuredTool.from_function(lambda: None, name=name, description="Fixture tool")
               for name in ("get_trip_snapshot", "execute")]
    request = SimpleNamespace(tools=offered, messages=[], system_message=SystemMessage(content="Fixture"),
                              override=lambda **kw: SimpleNamespace(**kw))
    handler = AsyncMock(return_value=SimpleNamespace(result=[AIMessage(content="ok",
        usage_metadata={"input_tokens": 3, "output_tokens": 2, "total_tokens": 5})]))
    for _ in range(11): run(first.awrap_model_call(request, handler))
    run(second.awrap_model_call(request, handler))
    assert budget.requests == 12 and budget.input_tokens == 36 and budget.output_tokens == 24
    assert handler.await_args_list[0].args[0].tools == [offered[0]]
    assert handler.await_args_list[-1].args[0].tools == []
    with pytest.raises(RuntimeError, match="MODEL_BUDGET_EXCEEDED"):
        run(first.awrap_model_call(request, handler))
    assert handler.await_count == 12


def test_failed_model_attempt_consumes_budget():
    budget = RunBudget()
    request = SimpleNamespace(tools=[], messages=[], system_message=SystemMessage(content="Fixture"),
                              override=lambda **kw: SimpleNamespace(**kw))
    with pytest.raises(RuntimeError, match="provider failure"):
        run(ResearchBoundary(set(), budget).awrap_model_call(request, AsyncMock(side_effect=RuntimeError("provider failure"))))
    assert budget.requests == 1


@pytest.mark.parametrize("tool_name", ["ResearchResult", "ResearchSelection", "ProposalDraft"])
def test_invalid_structured_json_fails_after_usage_accounting_without_raw_arguments(tool_name):
    budget = RunBudget()
    request = SimpleNamespace(tools=[], messages=[], system_message=SystemMessage(content="Fixture"),
                              override=lambda **kw: SimpleNamespace(**kw))
    raw = '{"rationale":"PRIVATE_INPUT"unescaped quote""}'
    message = AIMessage(content="", invalid_tool_calls=[{"name": tool_name, "args": raw,
        "id": "bad-json", "error": "PRIVATE_PROVIDER_ERROR"}],
        usage_metadata={"input_tokens": 123, "output_tokens": 45, "total_tokens": 168})
    handler = AsyncMock(return_value=SimpleNamespace(result=[message]))
    with pytest.raises(RuntimeError, match="^INVALID_STRUCTURED_TOOL_JSON$"):
        run(ResearchBoundary(set(), budget).awrap_model_call(request, handler))
    assert budget.requests == budget.usage_requests == 1
    assert (budget.input_tokens, budget.output_tokens, budget.invalid_tool_calls) == (123, 45, 1)
    assert budget.schema_repairs == 0
    handler.assert_awaited_once()
    details = budget.diagnostics["invalidStructuredTools"]
    assert details[0]["toolName"] == tool_name and details[0]["column"] > 0
    assert "PRIVATE" not in str(details) and "args" not in details[0]


def test_official_parser_rejects_unescaped_quotes_and_accepts_valid_json():
    import json
    from langchain_core.output_parsers.openai_tools import parse_tool_call
    from langchain_core.exceptions import OutputParserException
    raw = '{"rationale":"符合长者"城市建筑+博物馆"偏好"}'
    with pytest.raises(OutputParserException):
        parse_tool_call({"id": "test", "function": {"name": "ResearchResult", "arguments": raw}})
    escaped = json.dumps({"rationale": '符合长者"城市建筑+博物馆"偏好'}, ensure_ascii=False)
    assert parse_tool_call({"id": "test", "function": {"name": "ResearchResult", "arguments": escaped}})["args"]["rationale"] == '符合长者"城市建筑+博物馆"偏好'


def test_official_child_invalid_json_stops_before_parent_selection(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    brief = build_brief("shanghai_seniors", 1)
    messages = [call("get_trip_snapshot", {}, "main-s"),
        call("task", {"subagent_type": "research", "description": "Offline research"}, "task"),
        call("get_trip_snapshot", {}, "child-s"),
        AIMessage(content="", invalid_tool_calls=[{"name": "ResearchResult", "args": '{"summary":"bad"quote"}',
            "id": "bad", "error": "fixture parser error"}]),
        call("ResearchSelection", {"useResearchResult": True, "explanation": "Must not run"}, "parent-unused")]
    for message in messages:
        message.usage_metadata = {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    model = ToolFake(responses=messages)
    record = run(research.run_research(brief, architecture="B", replay=True, model=model))
    assert record["status"] == "Fail" and record["errorCode"] == "INVALID_STRUCTURED_TOOL_JSON"
    assert record["modelRequests"] == record["usageRequests"] == 4
    assert record["inputTokens"] == 40 and record["outputTokens"] == 20
    assert record["schemaRepairs"] == 0 and record["malformedToolCallCount"] == 1
    assert "ResearchSelection" not in record["modelToolCalls"] and "result" not in record
    assert record["invalidStructuredTools"][0]["toolName"] == "ResearchResult"


@pytest.mark.parametrize("component", ["message", "system", "tool_schema"])
def test_oversized_input_is_rejected_before_model_call_or_request_charge(component):
    budget = RunBudget()
    # 50,001 Chinese characters are below 150K characters but above 150K UTF-8 bytes.
    # This catches accidental character counting and omitted system/tool payloads.
    oversized = "旅" * 50_001
    request = SimpleNamespace(messages=[HumanMessage(content=oversized if component == "message" else "fixture")],
        system_message=SystemMessage(content=oversized if component == "system" else "fixture"),
        tools=[StructuredTool.from_function(lambda: None, name="get_trip_snapshot",
            description=oversized if component == "tool_schema" else "Fixture tool")],
        override=lambda **kw: SimpleNamespace(**kw))
    handler = AsyncMock()
    with pytest.raises(RuntimeError, match="MODEL_INPUT_BUDGET_EXCEEDED"):
        run(ResearchBoundary({"get_trip_snapshot"}, budget).awrap_model_call(request, handler))
    handler.assert_not_called()
    assert budget.requests == 0 and budget.input_tokens == 0 and budget.output_tokens == 0


def test_delegation_is_one_total_and_only_to_research():
    budget = RunBudget()
    boundary = ResearchBoundary({"task"}, budget)
    handler = AsyncMock(return_value=ToolMessage(content="structured fixture", tool_call_id="task1"))
    wrong = SimpleNamespace(tool_call={"name": "task", "args": {"subagent_type": "general-purpose"}, "id": "wrong"})
    assert run(boundary.awrap_tool_call(wrong, handler)).status == "error"
    assert budget.delegations == 0
    allowed = SimpleNamespace(tool_call={"name": "task", "args": {"subagent_type": "research"}, "id": "task1"})
    run(boundary.awrap_tool_call(allowed, handler))
    assert run(boundary.awrap_tool_call(allowed, handler)).status == "error"
    assert budget.delegations == 1 and handler.await_count == 1
    assert budget.delegated_results == ["structured fixture"]


@pytest.mark.parametrize("url", ["file:///etc/passwd", "http://localhost/x", "http://127.0.0.1/x",
    "http://169.254.169.254/x", "http://10.0.0.1/x", "https://u:p@example.com/x", "https://service.internal/x"])
def test_public_url_filter_rejects_obvious_unsafe_targets(url):
    assert not safe_public_url(url)


def test_snapshot_result_is_detached_from_bound_trip():
    brief = build_brief("xian")
    sources = Sources(brief, replay=True)
    result = sources.snapshot()
    result["snapshot"]["trip"]["preferences"] = "Injected changed preferences"
    result["snapshot"]["activities"].clear()
    assert brief.snapshot.activities and brief.snapshot.trip.preferences != "Injected changed preferences"
    assert sources.snapshot()["evidenceRef"] == result["evidenceRef"]


def test_unobserved_extract_url_is_rejected_without_client_or_budget(monkeypatch):
    sources = Sources(build_brief("beijing", 1))
    client = AsyncMock()
    monkeypatch.setattr(sources, "web_client", client)
    result = run(sources.extract(["https://example.org/not-observed"]))
    assert result["error"] == "UNOBSERVED_OR_INVALID_URL"
    assert not sources.evidence and sources.counts["extract"] == 0
    client.assert_not_called()


def test_source_quota_blocks_before_network_and_credits_share_limit():
    sources = Sources(build_brief("beijing", 1), replay=True)
    for _ in range(3): assert run(sources.amap("博物馆"))["evidence"]
    assert run(sources.amap("博物馆"))["error"] == "BUDGET_EXCEEDED"
    assert sources.counts["amap"] == 3
    for _ in range(4): assert run(sources.web("官方开放规则"))["evidence"]
    assert run(sources.web("官方开放规则"))["error"] == "BUDGET_EXCEEDED"
    url = next(e.url for e in sources.evidence.values() if e.sourceType == "web")
    assert run(sources.extract([url]))["evidence"]
    assert run(sources.extract([url]))["evidence"]
    assert run(sources.extract([url]))["error"] == "BUDGET_EXCEEDED"
    assert sources.counts["credits"] == 6
    assert all(e["mode"] == "fixture" for e in sources.events)


def test_actual_adapter_injected_failure_stays_error_and_hides_exception(monkeypatch):
    sources = Sources(build_brief("shanxi", 1))
    provider = AsyncMock(side_effect=RuntimeError("PRIVATE_KEY_MUST_NOT_ESCAPE"))
    monkeypatch.setattr(research_sources, "search_places", provider)
    result = run(sources.amap("古建筑"))
    assert result == {"error": "AMAP_UNAVAILABLE", "evidence": []}
    assert sources.events[-1]["status"] == "ERROR"
    assert "PRIVATE_KEY" not in str(sources.events)
    provider.assert_awaited_once_with("古建筑", "太原")


def test_extract_partial_failure_retains_only_requested_observed_sources(monkeypatch):
    sources = Sources(build_brief("beijing", 1))
    urls = ["https://example.org/one", "https://example.org/two"]
    for url in urls: sources.add("web", "test", "fixture", "search_excerpt", url=url)
    client = SimpleNamespace(extract=AsyncMock(return_value={"results": [
        {"url": urls[0], "raw_content": "Observed page"},
        {"url": "https://other.example/ignored", "raw_content": "Not requested"}]}))
    monkeypatch.setattr(sources, "web_client", lambda: client)
    result = run(sources.extract(urls))
    assert len(result["evidence"]) == 1 and result["failedCount"] == 1
    assert result["evidence"][0]["url"] == urls[0]
    assert sources.events[-1]["status"] == "PARTIAL"


def test_official_single_agent_graph_returns_valid_structured_result_without_writes(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    brief = build_brief("hangzhou")
    ref = Sources(brief, replay=True).snapshot()["evidenceRef"]
    model = ToolFake(responses=[call("get_trip_snapshot", {}, "s"), call("ResearchResult", payload(ref), "r")])
    record = run(research.run_research(brief, architecture="A", replay=True, model=model))
    assert record["status"] == "Pass"
    assert record["toolCalls"] == ["get_trip_snapshot"]
    assert record["modelRequests"] == 2
    assert record["noWorkspaceWrites"] and record["contextUnchanged"]
    assert record["llmMode"] == "fake" and record["toolMode"] == "fixture"
    assert record["humanReview"] == "Pending"


def test_official_task_delegation_with_child_and_parent_structured_outputs(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    brief = build_brief("shanxi", 1)
    ref = Sources(brief, replay=True).snapshot()["evidenceRef"]
    child_result = payload(ref)
    child_result["candidates"] = [{"title": "子代理原始候选", "rationale": "保留原始取舍与证据，不由父代理重写。",
        "preferenceMatches": ["古建摄影"], "tradeoffs": ["现场条件未知"],
        "claims": [{"text": "以本次快照为依据的候选。", "kind": "inference", "evidenceRefs": [ref]}]}]
    model = ToolFake(responses=[call("get_trip_snapshot", {}, "main-s"),
        call("task", {"subagent_type": "research", "description": "Read snapshot and return fixture result."}, "task"),
        call("get_trip_snapshot", {}, "child-s"), call("ResearchResult", child_result, "child-r"),
        call("ResearchSelection", {"useResearchResult": True, "explanation": "选择子代理结果；这不是新的研究摘要。"}, "main-r")])
    record = run(research.run_research(brief, architecture="B", replay=True, model=model))
    assert record["status"] == "Pass", record
    assert record["toolCalls"] == ["get_trip_snapshot", "task", "get_trip_snapshot"]
    assert record["modelRequests"] == 5 and record["noWorkspaceWrites"]
    assert record["result"] == ResearchResult.model_validate(child_result).model_dump(mode="json")
    assert record["result"]["candidates"][0]["claims"][0]["evidenceRefs"] == [ref]
    assert record["mainSelection"]["useResearchResult"] is True


@pytest.mark.parametrize("repeat_invalid", [False, True])
def test_candidate_limitations_repair_names_extra_path_and_keeps_single_retry(monkeypatch, repeat_invalid):
    import copy
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    class RepairFake(ToolFake):
        repair_messages: list[str] = Field(default_factory=list)
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self.repair_messages.extend(str(m.content) for m in messages if isinstance(m, ToolMessage)
                                        and "extra_forbidden" in str(m.content))
            return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
    brief = build_brief("shanghai_seniors", 1)
    ref = Sources(brief, replay=True).snapshot()["evidenceRef"]
    invalid = payload(ref)
    invalid["candidates"] = [{"title": "离线测试候选", "rationale": "推断：与文化偏好相关，尚需核实现场条件。",
        "claims": [{"text": "基于用户偏好的推断。", "kind": "inference", "evidenceRefs": [ref]}],
        "limitations": ["开放规则未知"]}]
    repaired = copy.deepcopy(invalid)
    repaired["limitations"].append("离线测试候选：开放规则未知")
    del repaired["candidates"][0]["limitations"]
    model = RepairFake(responses=[call("get_trip_snapshot", {}, "main-s"),
        call("task", {"subagent_type": "research", "description": "Read snapshot and return fixture result."}, "task"),
        call("get_trip_snapshot", {}, "child-s"), call("ResearchResult", invalid, "bad-r"),
        call("ResearchResult", invalid if repeat_invalid else repaired, "repair-r"),
        call("ResearchSelection", {"useResearchResult": True, "explanation": "采用子代理结果"}, "main-r")])
    record = run(research.run_research(brief, architecture="B", replay=True, model=model))
    assert record["schemaRepairs"] == 1
    assert any("candidates[0].limitations" in text and "删除候选内limitations字段" in text
               and "title,rationale,preferenceMatches,tradeoffs,claims,proposedDate,placeEvidenceRef" in text
               for text in model.repair_messages)
    if repeat_invalid:
        assert record["status"] == "Fail" and record["errorType"] == "StructuredOutputValidationError"
        assert record["modelRequests"] == 5 and "result" not in record
    else:
        assert record["status"] == "Pass" and record["modelRequests"] == 6
        assert record["result"]["limitations"][-1] == "离线测试候选：开放规则未知"
        assert "limitations" not in record["result"]["candidates"][0]


def test_parent_refusal_does_not_publish_child_result(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    brief = build_brief("shanxi", 1)
    ref = Sources(brief, replay=True).snapshot()["evidenceRef"]
    model = ToolFake(responses=[call("get_trip_snapshot", {}, "main-s"),
        call("task", {"subagent_type": "research", "description": "Run fixture research."}, "task"),
        call("get_trip_snapshot", {}, "child-s"), call("ResearchResult", payload(ref), "child-r"),
        call("ResearchSelection", {"useResearchResult": False, "explanation": "不采用此结果。"}, "main-r")])
    record = run(research.run_research(brief, architecture="B", replay=True, model=model))
    assert record["status"] == "Fail" and record["errorCode"] == "MISSING_DELEGATION"
    assert "result" not in record


def test_parent_cannot_select_a_child_result_that_does_not_exist(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    brief = build_brief("shanxi", 1)
    model = ToolFake(responses=[call("get_trip_snapshot", {}, "main-s"),
        call("ResearchSelection", {"useResearchResult": True, "explanation": "没有实际子代理结果。"}, "main-r")])
    record = run(research.run_research(brief, architecture="B", replay=True, model=model))
    assert record["status"] == "Fail" and record["errorCode"] == "MISSING_DELEGATION"
    assert "result" not in record and "task" not in record["toolCalls"]


def test_child_schema_capture_does_not_bypass_evidence_validation(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    brief = build_brief("shanxi", 1)
    model = ToolFake(responses=[call("get_trip_snapshot", {}, "main-s"),
        call("task", {"subagent_type": "research", "description": "Run fixture research."}, "task"),
        call("get_trip_snapshot", {}, "child-s"), call("ResearchResult", payload("ev:invented"), "child-r"),
        call("ResearchSelection", {"useResearchResult": True, "explanation": "采用。"}, "main-r")])
    record = run(research.run_research(brief, architecture="B", replay=True, model=model))
    assert record["status"] == "Fail" and record["errorCode"] == "Unobserved evidence reference"
    assert "result" not in record


def test_capture_keeps_detached_copy_of_child_structured_response():
    budget = RunBudget()
    original = ResearchResult.model_validate(payload("ev:fixture"))
    capture = research.CaptureResearch(budget)
    run(capture.aafter_agent({"structured_response": original}, None))
    original.claims[0].evidenceRefs.append("ev:later-mutation")
    original.summary = "Changed after capture"
    assert budget.research_result.claims[0].evidenceRefs == ["ev:fixture"]
    assert budget.research_result.summary != original.summary


def test_missing_snapshot_is_rejected_even_when_schema_is_valid(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    brief = build_brief("hangzhou")
    model = ToolFake(responses=[call("ResearchResult", {"summary": "No evidence", "status": "no_results"}, "r")])
    record = run(research.run_research(brief, architecture="A", replay=True, model=model))
    assert record["status"] == "Fail" and record["errorType"] == "ValueError"


def test_c_official_skills_files_permissions_and_planning(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    brief = build_brief("beijing", 1)
    ref = Sources(brief, replay=True).snapshot()["evidenceRef"]
    observed = {"skill_disclosed": False, "permission_denied": False, "note_read": False}

    class ObservingFake(ToolFake):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            observed["skill_disclosed"] |= any(m.type == "system" and "travel-research" in str(m.content) for m in messages)
            for message in messages:
                if isinstance(message, ToolMessage):
                    if message.tool_call_id == "deny":
                        observed["permission_denied"] |= "permission denied" in str(message.content).lower()
                    if message.tool_call_id == "note-read":
                        observed["note_read"] |= "Preserve evidence IDs" in str(message.content)
            return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    model = ObservingFake(responses=[call("get_trip_snapshot", {}, "main-s"),
        call("task", {"subagent_type": "research", "description": "Use skill and notes for the fixture check."}, "task"),
        call("get_trip_snapshot", {}, "child-s"),
        call("read_file", {"file_path": "/skills/travel-research/SKILL.md"}, "skill-read"),
        call("write_file", {"file_path": "/skills/overwrite.txt", "content": "forbidden"}, "deny"),
        call("write_file", {"file_path": "/scratch/note.txt", "content": "Preserve evidence IDs"}, "note-write"),
        call("read_file", {"file_path": "/scratch/note.txt"}, "note-read"),
        call("write_todos", {"todos": [{"content": "Verify fixture", "status": "completed"}]}, "todo"),
        call("ResearchResult", payload(ref), "child-r"),
        call("ResearchSelection", {"useResearchResult": True, "explanation": "采用保留的原始子代理结果。"}, "main-r")])
    record = run(research.run_research(brief, architecture="C", replay=True, model=model))
    assert record["status"] == "Pass", record
    assert all(observed.values()), observed
    assert "write_todos" in record["toolCalls"] and record["modelRequests"] == 10
    assert record["noWorkspaceWrites"] and record["contextUnchanged"]
    assert record["result"] == ResearchResult.model_validate(payload(ref)).model_dump(mode="json")


def test_changed_bound_context_cannot_be_reported_as_pass(monkeypatch):
    brief = build_brief("hangzhou")
    class ChangingGraph:
        async def ainvoke(self, state, config):
            brief.snapshot.trip.preferences += " Changed during run"
            return {"structured_response": ResearchResult(summary="Untrusted context", status="no_results")}
    budget = RunBudget()
    budget.tool_calls.append("get_trip_snapshot")
    monkeypatch.setattr(research, "build_research_graph", lambda *a, **kw: (ChangingGraph(), budget, False))
    record = run(research.run_research(brief, architecture="A", replay=True, model=object()))
    assert record["status"] == "Fail"
    assert not record["noWorkspaceWrites"] and not record["contextUnchanged"]
