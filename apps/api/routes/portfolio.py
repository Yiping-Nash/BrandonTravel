"""Portfolio proposals and bounded async research; no agent receives a repository."""
import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter

from apps.api.agent.errors import AgentError
from apps.api.db.repository import Repository
from apps.api.domain.errors import DomainError
from packages.contracts import PlanGeneration, PlanRequest, Proposal, ResearchAdopt, ResearchRun, ResearchStart, SuggestionPreview


def create_router(repo: Repository) -> APIRouter:
    tasks: dict[str, asyncio.Task] = {}

    @asynccontextmanager
    async def lifespan(_app):
        repo.recover_interrupted()
        try:
            yield
        finally:
            remaining = list(tasks.values())
            for task in remaining:
                task.cancel()
            if remaining:
                await asyncio.gather(*remaining, return_exceptions=True)

    router = APIRouter(prefix="/api", tags=["Portfolio"], lifespan=lifespan)

    @router.get("/trips/{trip_id}/proposals", response_model=list[Proposal])
    def proposals(trip_id: str):
        return repo.list_proposals(trip_id)

    @router.post("/trips/{trip_id}/proposals/generate", response_model=Proposal)
    async def generate(trip_id: str, body: PlanRequest):
        snapshot, previous = repo.begin_plan(trip_id, body)
        if previous is not None:
            return previous
        try:
            from apps.api.agent.portfolio import generate_proposal
            generated = await asyncio.wait_for(generate_proposal(snapshot.model_copy(deep=True), body.model_copy(deep=True)), timeout=190)
            return repo.finish_plan(trip_id, body, PlanGeneration.model_validate(generated))
        except asyncio.CancelledError:
            repo.fail_plan(trip_id, body.requestId)
            raise
        except (DomainError, AgentError):
            repo.fail_plan(trip_id, body.requestId)
            raise
        except TimeoutError:
            repo.fail_plan(trip_id, body.requestId)
            raise DomainError(504, "PLAN_TIMEOUT", "AI 方案生成超时，未改写行程，请重新发起。") from None
        except Exception:
            repo.fail_plan(trip_id, body.requestId)
            raise DomainError(502, "PLAN_UNAVAILABLE", "AI 暂时无法生成有效方案，未改写行程。") from None

    async def research_worker(trip_id: str, run_id: str):
        try:
            snapshot = repo.claim_research(trip_id, run_id)
            if snapshot is None:
                return
            from apps.api.agent.portfolio import research_for_trip
            value = repo.get_research(trip_id, run_id)
            output = await asyncio.wait_for(research_for_trip(snapshot.model_copy(deep=True), value.question), timeout=190)
            repo.finish_research(trip_id, run_id, output)
        except asyncio.CancelledError:
            repo.fail_research(trip_id, run_id, "SERVICE_STOPPED")
            raise
        except TimeoutError:
            repo.fail_research(trip_id, run_id, "RESEARCH_TIMEOUT")
        except (DomainError, AgentError) as exc:
            repo.fail_research(trip_id, run_id, exc.code)
        except Exception:
            repo.fail_research(trip_id, run_id, "RESEARCH_UNAVAILABLE")

    @router.get("/trips/{trip_id}/research-runs", response_model=list[ResearchRun])
    def research_runs(trip_id: str):
        return repo.list_research(trip_id)

    @router.post("/trips/{trip_id}/research-runs", response_model=ResearchRun, status_code=202)
    async def start_research(trip_id: str, body: ResearchStart):
        value, created = repo.begin_research(trip_id, body)
        if created:
            task = asyncio.create_task(research_worker(trip_id, value.id), name=f"research:{value.id}")
            tasks[value.id] = task
            task.add_done_callback(lambda _done, run_id=value.id: tasks.pop(run_id, None))
        return value

    @router.post("/trips/{trip_id}/research-runs/{run_id}/cancel", response_model=ResearchRun)
    async def cancel_research(trip_id: str, run_id: str):
        value = repo.cancel_research(trip_id, run_id)
        task = tasks.get(run_id)
        if task is not None:
            task.cancel()
        return value

    @router.post("/trips/{trip_id}/research-runs/{run_id}/proposal", response_model=Proposal)
    def research_proposal(trip_id: str, run_id: str, body: ResearchAdopt):
        return repo.research_proposal(trip_id, run_id, body)

    @router.post("/trips/{trip_id}/suggestions/{suggestion_id}/proposal", response_model=Proposal)
    def suggestion_proposal(trip_id: str, suggestion_id: str, body: SuggestionPreview):
        return repo.suggestion_proposal(trip_id, suggestion_id, body.target, body.date)

    return router
