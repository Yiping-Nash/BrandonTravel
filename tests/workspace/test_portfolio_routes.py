"""HTTP/lifecycle tests with explicit synthetic Agent functions, no provider calls."""
import asyncio
from threading import Event
import time
import types
import sys

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from apps.api.agent.errors import AgentError
from apps.api.db.repository import Repository
from apps.api.domain.errors import DomainError
from apps.api.routes.portfolio import create_router as portfolio_router
from apps.api.routes.workspace import create_router as workspace_router
from packages.contracts import PlanGeneration, PlanRequest, ProposalDraft, ResearchStart, SuggestionDraft, TripCreate
from tests.workspace.test_portfolio import research_output


@pytest.fixture
def repo(tmp_path):
    return Repository(tmp_path / "http-portfolio.sqlite3")


@pytest.fixture
def trip(repo):
    return repo.create_trip(TripCreate(title="合成场景", destination="杭州", startDate="2026-11-02", endDate="2026-11-06"))


def app_for(repo):
    app = FastAPI()
    @app.exception_handler(DomainError)
    @app.exception_handler(AgentError)
    async def safe_error(_request, error):
        return JSONResponse(status_code=error.status, content={"error": {"code": error.code, "message": error.message}})
    app.include_router(workspace_router(repo))
    app.include_router(portfolio_router(repo))
    return app


def stub_agent(monkeypatch, *, generate=None, research=None):
    module = types.ModuleType("apps.api.agent.portfolio")
    async def default_generate(snapshot, request):
        return PlanGeneration(proposal=ProposalDraft(kind=request.kind, title="合成 API 方案", summary="测试中构造，非真实模型输出",
            actions=[{"type": "addActivity", "activity": {"title": "候选安排", "date": "2026-11-03"}}]))
    async def default_research(snapshot, question):
        return research_output()
    module.generate_proposal = generate or default_generate
    module.research_for_trip = research or default_research
    monkeypatch.setitem(sys.modules, "apps.api.agent.portfolio", module)


def wait_for_status(client, trip_id, run_id, status):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        response = client.get(f"/api/trips/{trip_id}/research-runs")
        assert response.status_code == 200
        run = next((r for r in response.json() if r["id"] == run_id), None)
        if run and run["status"] == status:
            return run
        time.sleep(.01)
    pytest.fail(f"Research did not reach {status}")


def test_generate_route_idempotency_and_human_confirmation(repo, trip, monkeypatch):
    calls = []
    async def generate(snapshot, request):
        calls.append(snapshot.trip.id)
        # Agent receives detached objects, never the repository or HTTP request.
        snapshot.trip.preferences = "Agent mutation must not change canonical state"
        request.requestId = "mutated-inside-agent"
        return PlanGeneration(proposal=ProposalDraft(kind="blueprint", title="合成方案", summary="等待用户确认",
            actions=[{"type": "addIdea", "idea": {"title": "人工测试候选"}}]))
    stub_agent(monkeypatch, generate=generate)
    with TestClient(app_for(repo)) as client:
        url = f"/api/trips/{trip.trip.id}/proposals/generate"
        response = client.post(url, json={"requestId": "request-1"})
        assert response.status_code == 200, response.text
        proposal = response.json()
        assert client.post(url, json={"requestId": "request-1"}).json()["id"] == proposal["id"]
        assert len(calls) == 1 and repo.get_snapshot(trip.trip.id) == trip
        conflict = client.post(url, json={"requestId": "request-1", "message": "different"})
        assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
        confirmed = client.post(f"/api/trips/{trip.trip.id}/commands", json={"expectedVersion": trip.version,
            "command": {"type": "confirmProposal", "proposalId": proposal["id"]}})
        assert confirmed.status_code == 200 and len(confirmed.json()["ideas"]) == 1
        assert client.get(f"/api/trips/{trip.trip.id}/proposals").json()[0]["status"] == "accepted"


def test_generate_failure_sanitizes_exceptions_and_does_not_repeat_request(repo, trip, monkeypatch):
    calls = []
    async def fail(snapshot, request):
        calls.append(1)
        raise RuntimeError("PRIVATE_PROVIDER_KEY_DO_NOT_EXPOSE")
    stub_agent(monkeypatch, generate=fail)
    with TestClient(app_for(repo)) as client:
        url = f"/api/trips/{trip.trip.id}/proposals/generate"
        response = client.post(url, json={"requestId": "failed-request"})
        assert response.status_code == 502 and response.json()["error"]["code"] == "PLAN_UNAVAILABLE"
        assert "PRIVATE_PROVIDER_KEY" not in response.text
        repeated = client.post(url, json={"requestId": "failed-request"})
        assert repeated.status_code == 409 and repeated.json()["error"]["code"] == "REQUEST_FAILED"
        assert len(calls) == 1 and repo.get_snapshot(trip.trip.id) == trip


def test_background_research_accepts_once_and_does_not_hold_workspace_lock(repo, trip, monkeypatch):
    started, release = Event(), Event()
    calls = []
    async def research(snapshot, question):
        calls.append(snapshot.model_copy(deep=True))
        started.set()
        while not release.is_set():
            await asyncio.sleep(.005)
        return research_output("partial")
    stub_agent(monkeypatch, research=research)
    with TestClient(app_for(repo)) as client:
        url = f"/api/trips/{trip.trip.id}/research-runs"
        response = client.post(url, json={"requestId": "r1", "question": "研究候选"})
        assert response.status_code == 202 and started.wait(2)
        run_id = response.json()["id"]
        repeated = client.post(url, json={"requestId": "r1", "question": "研究候选"})
        assert repeated.status_code == 202 and repeated.json()["id"] == run_id
        edit = client.post(f"/api/trips/{trip.trip.id}/commands", json={"expectedVersion": trip.version,
            "command": {"type": "setPreferences", "preferences": "手动调整：带孩子"}})
        assert edit.status_code == 200
        release.set()
        finished = wait_for_status(client, trip.trip.id, run_id, "partial")
        assert finished["result"] and len(calls) == 1 and calls[0] == trip
        stale = client.post(f"{url}/{run_id}/proposal", json={"candidateIndex": 0, "target": "idea"})
        assert stale.status_code == 409 and stale.json()["error"]["code"] == "RESEARCH_STALE"
        assert repo.get_snapshot(trip.trip.id).trip.preferences == "手动调整：带孩子"


def test_cancel_survives_late_provider_return_and_refresh(repo, trip, monkeypatch):
    started, release, cancellation_seen = Event(), Event(), Event()
    async def research(snapshot, question):
        started.set()
        try:
            while not release.is_set():
                await asyncio.sleep(.005)
        except asyncio.CancelledError:
            cancellation_seen.set()
            # Simulate an in-flight provider that finishes after cancellation.
            while not release.is_set():
                await asyncio.sleep(.005)
        return research_output()
    stub_agent(monkeypatch, research=research)
    with TestClient(app_for(repo)) as client:
        url = f"/api/trips/{trip.trip.id}/research-runs"
        value = client.post(url, json={"requestId": "cancel", "question": "研究"}).json()
        assert started.wait(2)
        cancelled = client.post(f"{url}/{value['id']}/cancel")
        assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
        assert cancellation_seen.wait(2)
        release.set()
        assert wait_for_status(client, trip.trip.id, value["id"], "cancelled")["result"] is None
    with TestClient(app_for(Repository(repo.path))) as client:
        saved = client.get(url).json()[0]
        assert saved["status"] == "cancelled" and saved["result"] is None


def test_background_invalid_result_fails_without_persisting_unvalidated_candidates(repo, trip, monkeypatch):
    async def invalid(snapshot, question):
        result = research_output()
        result["evidence"] = []
        return result
    stub_agent(monkeypatch, research=invalid)
    with TestClient(app_for(repo)) as client:
        response = client.post(f"/api/trips/{trip.trip.id}/research-runs", json={"requestId": "bad", "question": "研究"})
        assert response.status_code == 202
        value = wait_for_status(client, trip.trip.id, response.json()["id"], "failed")
        assert value["error"] == "RESEARCH_INVALID_RESULT" and value["result"] is None
        assert repo.get_snapshot(trip.trip.id) == trip


def test_startup_recovers_interrupted_work_and_replay_returns_failed_run(repo, trip, monkeypatch):
    run, _ = repo.begin_research(trip.trip.id, ResearchStart(question="研究", requestId="interrupted"))
    repo.claim_research(trip.trip.id, run.id)
    repo.begin_plan(trip.trip.id, PlanRequest(requestId="interrupted-plan"))
    stub_agent(monkeypatch)
    with TestClient(app_for(repo)) as client:
        response = client.post(f"/api/trips/{trip.trip.id}/research-runs", json={"requestId": "interrupted", "question": "研究"})
        assert response.status_code == 202
        assert response.json()["status"] == "failed" and response.json()["error"] == "SERVICE_RESTARTED"
        old_plan = client.post(f"/api/trips/{trip.trip.id}/proposals/generate", json={"requestId": "interrupted-plan"})
        assert old_plan.status_code == 409 and old_plan.json()["error"]["code"] == "REQUEST_FAILED"


def test_research_adoption_http_body_cannot_supply_candidate_text(repo, trip, monkeypatch):
    stub_agent(monkeypatch)
    with TestClient(app_for(repo)) as client:
        url = f"/api/trips/{trip.trip.id}/research-runs"
        value = client.post(url, json={"requestId": "adopt", "question": "研究"}).json()
        wait_for_status(client, trip.trip.id, value["id"], "completed")
        forbidden = client.post(f"{url}/{value['id']}/proposal", json={"candidateIndex": 0, "target": "idea", "title": "客户端伪造"})
        assert forbidden.status_code == 422
        allowed = client.post(f"{url}/{value['id']}/proposal", json={"candidateIndex": 0, "target": "idea"})
        assert allowed.status_code == 200
        assert allowed.json()["actions"][0]["idea"]["title"] == "固定测试博物馆"
        assert repo.get_snapshot(trip.trip.id) == trip


def test_legacy_chat_suggestion_preview_needs_no_agent_and_rejects_client_text(repo, trip):
    suggestion = repo.add_suggestions(trip.trip.id, [SuggestionDraft(title="旧聊天建议", rationale="已存储的内容")])[0]
    current = repo.get_snapshot(trip.trip.id)
    # No Agent stub is installed: this endpoint must never invoke/import Agent generation.
    with TestClient(app_for(repo)) as client:
        url = f"/api/trips/{trip.trip.id}/suggestions/{suggestion.id}/proposal"
        forbidden = client.post(url, json={"target": "idea", "title": "客户端篡改"})
        assert forbidden.status_code == 422
        preview = client.post(url, json={"target": "idea"})
        assert preview.status_code == 200, preview.text
        assert preview.json()["actions"][0]["idea"]["title"] == "旧聊天建议"
        assert repo.get_snapshot(trip.trip.id) == current
        confirmed = client.post(f"/api/trips/{trip.trip.id}/commands", json={"expectedVersion": current.version,
            "command": {"type": "confirmProposal", "proposalId": preview.json()["id"]}})
        assert confirmed.status_code == 200 and confirmed.json()["suggestions"][0]["status"] == "accepted"
        assert client.post(url, json={"target": "idea"}).status_code == 409
