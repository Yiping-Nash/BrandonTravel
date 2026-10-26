"""Portfolio persistence/state tests. Synthetic Agent outputs; no paid requests."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from apps.api.db import repository as repository_module
from apps.api.db.repository import Repository
from apps.api.domain.errors import DomainError
from apps.api.agent.research_contracts import context_hash
from packages.contracts import (
    Command, PlanGeneration, PlanRequest, ProposalDraft, ResearchAdopt, ResearchStart,
    SuggestionDraft, TripCreate,
)


@pytest.fixture
def repo(tmp_path):
    return Repository(tmp_path / "portfolio.sqlite3")


@pytest.fixture
def trip(repo):
    return repo.create_trip(TripCreate(title="合成杭州旅行", destination="杭州", startDate="2026-11-02", endDate="2026-11-06"))


def execute(repo, snapshot, kind, **values):
    return repo.execute(snapshot.trip.id, Command(expectedVersion=snapshot.version, command={"type": kind, **values}))


def generate(repo, snapshot, request_id="plan-1", actions=None):
    request = PlanRequest(requestId=request_id)
    captured, previous = repo.begin_plan(snapshot.trip.id, request)
    assert previous is None
    generation = PlanGeneration(proposal=ProposalDraft(kind="blueprint", title="合成方案", summary="未预约的测试安排",
        actions=actions or [{"type": "addActivity", "activity": {"title": "博物馆候选安排", "date": "2026-11-03"}},
                            {"type": "addIdea", "idea": {"title": "雨天备选", "sourceKind": "agent"}}]))
    return repo.finish_plan(snapshot.trip.id, request, generation), captured


def research_output(status="complete"):
    return {
        "result": {"summary": "固定研究测试结果，非真实来源验证", "status": status,
            "candidates": [{"title": "固定测试博物馆", "rationale": "与测试偏好相关，营业情况未知。",
                "preferenceMatches": ["文化"], "tradeoffs": ["请核对开放安排"], "placeEvidenceRef": "ev:poi",
                "claims": [{"text": "工具返回固定测试博物馆。", "kind": "fact", "evidenceRefs": ["ev:poi"]}]}]},
        "evidence": [{"id": "ev:poi", "sourceType": "poi", "title": "固定测试地点", "excerpt": "Fixture only",
            "contentHash": "fixture-only", "verification": "provider", "providerId": "fixture-poi",
            "place": {"name": "固定测试博物馆", "providerId": "fixture-poi"}}],
        "toolCalls": ["get_trip_snapshot", "search_places"], "traceUrl": None,
    }


def completed_run(repo, snapshot, request_id="research-1", status="complete"):
    run, created = repo.begin_research(snapshot.trip.id, ResearchStart(question="合成研究问题", requestId=request_id))
    assert created and repo.claim_research(snapshot.trip.id, run.id) is not None
    return repo.finish_research(snapshot.trip.id, run.id, research_output(status))


def test_blank_trip_and_ideas_persist_without_invented_destination_or_dates(repo):
    draft = repo.create_trip(TripCreate())
    assert draft.trip.destination == "" and draft.trip.startDate is None and draft.trip.endDate is None
    saved = execute(repo, draft, "addIdea", idea={"title": "以后想去的地方"})
    restored = Repository(repo.path).get_snapshot(draft.trip.id)
    assert restored == saved and restored.ideas[0].title == "以后想去的地方"
    assert restored.trip.startDate is None
    with pytest.raises(DomainError, match="补全旅行起止日期"):
        execute(repo, saved, "addActivity", activity={"title": "不能凭空安排", "date": "2026-11-03"})


def test_progressive_settings_preserve_unknowns_until_user_sets_dates(repo):
    draft = repo.create_trip(TripCreate(destination="杭州", startDate="2026-11-02"))
    assert draft.trip.endDate is None
    saved = execute(repo, draft, "updateTrip", trip={"title": "杭州亲子", "destination": "杭州",
        "startDate": "2026-11-02", "endDate": "2026-11-06", "companions": "两位成人、一位孩子"})
    assert saved.trip.id == draft.trip.id and saved.trip.createdAt == draft.trip.createdAt
    assert saved.trip.companions == "两位成人、一位孩子"


def test_update_trip_dates_never_drops_existing_activities(repo, trip):
    saved = execute(repo, trip, "addActivity", activity={"title": "已确认安排", "date": "2026-11-03"})
    before = saved.model_dump()
    for settings in ({"startDate": "2026-11-04", "endDate": "2026-11-06"}, {"startDate": None, "endDate": None}):
        with pytest.raises(DomainError) as failure:
            execute(repo, saved, "updateTrip", trip={"title": "新范围", "destination": "杭州", **settings})
        assert failure.value.code == "TRIP_DATE_CONFLICT"
        assert repo.get_snapshot(trip.trip.id).model_dump() == before
    expanded = execute(repo, saved, "updateTrip", trip={"title": "延长旅行", "destination": "杭州",
        "startDate": "2026-11-01", "endDate": "2026-11-08"})
    assert expanded.activities == saved.activities and expanded.trip.id == saved.trip.id


def test_pending_plan_does_not_change_snapshot_and_confirm_has_one_version(repo, trip):
    proposal, captured = generate(repo, trip)
    assert repo.get_snapshot(trip.trip.id) == trip == captured
    assert repo.list_proposals(trip.trip.id) == [proposal]
    saved = execute(repo, trip, "confirmProposal", proposalId=proposal.id)
    assert saved.version == trip.version + 1
    assert len(saved.activities) == 1 and len(saved.ideas) == 1
    assert repo.list_proposals(trip.trip.id)[0].status == "accepted"
    with pytest.raises(DomainError) as failure:
        execute(repo, saved, "confirmProposal", proposalId=proposal.id)
    assert failure.value.code == "PROPOSAL_RESOLVED"
    assert Repository(repo.path).get_snapshot(trip.trip.id) == saved


def test_dismissal_changes_only_proposal_bookkeeping(repo, trip):
    proposal, _ = generate(repo, trip)
    snapshot = execute(repo, trip, "dismissProposal", proposalId=proposal.id)
    assert snapshot == trip and repo.get_snapshot(trip.trip.id) == trip
    assert repo.list_proposals(trip.trip.id)[0].status == "dismissed"


def test_plan_context_stale_after_manual_edit_or_companion_change(repo, trip):
    proposal, _ = generate(repo, trip)
    edited = execute(repo, trip, "updateTrip", trip={**trip.trip.model_dump(include=set(TripCreate.model_fields)), "companions": "带长者同行"})
    assert context_hash(edited) != proposal.contextHash
    with pytest.raises(DomainError) as failure:
        execute(repo, edited, "confirmProposal", proposalId=proposal.id)
    assert failure.value.code == "PROPOSAL_STALE"
    assert repo.get_snapshot(trip.trip.id) == edited


def test_suggestion_bookkeeping_does_not_make_proposal_context_stale(repo, trip):
    proposal, _ = generate(repo, trip)
    repo.add_suggestions(trip.trip.id, [SuggestionDraft(title="旁支建议", rationale="未采纳")])
    current = repo.get_snapshot(trip.trip.id)
    assert current.version > trip.version and context_hash(current) == proposal.contextHash
    saved = execute(repo, current, "confirmProposal", proposalId=proposal.id)
    assert saved.version == current.version + 1


def test_cross_trip_proposal_and_action_access_is_rejected(repo, trip):
    other = repo.create_trip(TripCreate(title="另一趟", destination="杭州", startDate="2026-11-02", endDate="2026-11-06"))
    other = execute(repo, other, "addActivity", activity={"title": "其他旅行活动", "date": "2026-11-03"})
    proposal, _ = generate(repo, trip)
    with pytest.raises(DomainError) as failure:
        execute(repo, other, "confirmProposal", proposalId=proposal.id)
    assert failure.value.code == "PROPOSAL_NOT_FOUND"
    with pytest.raises(DomainError):
        generate(repo, trip, "cross-trip-action", actions=[{"type": "removeActivity", "activityId": other.activities[0].id}])
    assert repo.get_snapshot(other.trip.id) == other


def test_plan_request_idempotency_is_trip_scoped_and_payload_checked(repo, trip):
    proposal, _ = generate(repo, trip)
    _, existing = repo.begin_plan(trip.trip.id, PlanRequest(requestId="plan-1"))
    assert existing == proposal
    with pytest.raises(DomainError) as failure:
        repo.begin_plan(trip.trip.id, PlanRequest(requestId="plan-1", message="不同请求内容"))
    assert failure.value.code == "IDEMPOTENCY_CONFLICT"
    other = repo.create_trip(TripCreate(title="另一趟", destination="杭州", startDate="2026-11-02", endDate="2026-11-06"))
    _, existing = repo.begin_plan(other.trip.id, PlanRequest(requestId="plan-1"))
    assert existing is None


def test_pending_and_failed_plan_requests_do_not_rerun(repo, trip):
    request = PlanRequest(requestId="inflight")
    repo.begin_plan(trip.trip.id, request)
    with pytest.raises(DomainError) as failure:
        repo.begin_plan(trip.trip.id, request)
    assert failure.value.code == "REQUEST_IN_PROGRESS"
    repo.fail_plan(trip.trip.id, request.requestId)
    with pytest.raises(DomainError) as failure:
        repo.begin_plan(trip.trip.id, request)
    assert failure.value.code == "REQUEST_FAILED"


def test_failed_batch_rolls_back_actions_proposal_status_and_version(repo, trip, monkeypatch):
    proposal, _ = generate(repo, trip)
    original = repository_module.apply_command
    count = 0
    def fault(snapshot, action):
        nonlocal count
        count += 1
        if count == 2:
            raise DomainError(422, "INJECTED_FAILURE", "确定性故障测试")
        return original(snapshot, action)
    monkeypatch.setattr(repository_module, "apply_command", fault)
    with pytest.raises(DomainError):
        execute(repo, trip, "confirmProposal", proposalId=proposal.id)
    assert repo.get_snapshot(trip.trip.id) == trip
    assert repo.list_proposals(trip.trip.id)[0].status == "proposed"


def test_concurrent_confirm_has_one_atomic_winner(repo, trip):
    proposal, _ = generate(repo, trip)
    barrier = Barrier(2)
    def confirm(_):
        local = Repository(repo.path)
        barrier.wait(timeout=10)
        try:
            return execute(local, trip, "confirmProposal", proposalId=proposal.id).version
        except DomainError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(confirm, range(2)))
    assert sorted(map(str, results)) == [str(trip.version + 1), "VERSION_CONFLICT"]
    assert len(repo.get_snapshot(trip.trip.id).activities) == 1


def test_draft_ai_and_missing_day_are_rejected_without_reserved_work(repo, trip):
    draft = repo.create_trip(TripCreate())
    for begin in (lambda: repo.begin_plan(draft.trip.id, PlanRequest(requestId="draft-plan")),
                  lambda: repo.begin_research(draft.trip.id, ResearchStart(question="研究", requestId="draft-research"))):
        with pytest.raises(DomainError) as failure:
            begin()
        assert failure.value.code == "TRIP_DETAILS_REQUIRED"
    with pytest.raises(DomainError) as failure:
        repo.begin_plan(trip.trip.id, PlanRequest(kind="day", requestId="missing-day"))
    assert failure.value.code == "DATE_REQUIRED"
    assert repo.list_research(draft.trip.id) == []


def test_research_request_replay_and_one_active_run_are_atomic(repo, trip):
    request = ResearchStart(question="合成研究", requestId="same")
    run, created = repo.begin_research(trip.trip.id, request)
    replay, duplicate_created = repo.begin_research(trip.trip.id, request)
    assert created and not duplicate_created and replay == run
    with pytest.raises(DomainError) as failure:
        repo.begin_research(trip.trip.id, ResearchStart(question="不同内容", requestId="same"))
    assert failure.value.code == "IDEMPOTENCY_CONFLICT"
    with pytest.raises(DomainError) as failure:
        repo.begin_research(trip.trip.id, ResearchStart(question="另一项研究", requestId="different"))
    assert failure.value.code == "RESEARCH_ALREADY_ACTIVE"
    assert repo.get_snapshot(trip.trip.id) == trip


def test_concurrent_research_start_has_one_active_winner(repo, trip):
    barrier = Barrier(2)
    def start(index):
        local = Repository(repo.path)
        barrier.wait(timeout=10)
        try:
            return local.begin_research(trip.trip.id, ResearchStart(question="合成研究", requestId=f"r{index}"))[0].status
        except DomainError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(start, range(2)))
    assert sorted(results) == ["RESEARCH_ALREADY_ACTIVE", "queued"]
    assert len(repo.list_research(trip.trip.id)) == 1


def test_cancel_and_restart_win_over_late_completion(repo, trip):
    run, _ = repo.begin_research(trip.trip.id, ResearchStart(question="合成研究", requestId="cancel"))
    assert repo.claim_research(trip.trip.id, run.id) == trip
    cancelled = repo.cancel_research(trip.trip.id, run.id)
    assert cancelled.status == "cancelled"
    assert repo.finish_research(trip.trip.id, run.id, research_output()).status == "cancelled"
    assert repo.get_research(trip.trip.id, run.id).result is None
    next_run, _ = repo.begin_research(trip.trip.id, ResearchStart(question="合成研究", requestId="restart"))
    repo.claim_research(trip.trip.id, next_run.id)
    reopened = Repository(repo.path)
    assert reopened.get_research(trip.trip.id, next_run.id).status == "running"
    assert reopened.recover_interrupted() == 1
    failed = reopened.get_research(trip.trip.id, next_run.id)
    assert failed.status == "failed" and failed.error == "SERVICE_RESTARTED"
    assert reopened.finish_research(trip.trip.id, next_run.id, research_output()).status == "failed"


def test_research_freezes_context_but_does_not_block_manual_edits(repo, trip):
    run, _ = repo.begin_research(trip.trip.id, ResearchStart(question="合成研究", requestId="edit"))
    edited = execute(repo, trip, "setPreferences", preferences="现在要少走路")
    captured = repo.claim_research(trip.trip.id, run.id)
    assert captured == trip and captured != edited
    completed = repo.finish_research(trip.trip.id, run.id, research_output())
    assert completed.status == "completed" and completed.result is not None
    with pytest.raises(DomainError) as failure:
        repo.research_proposal(trip.trip.id, run.id, ResearchAdopt(candidateIndex=0, target="idea"))
    assert failure.value.code == "RESEARCH_STALE"
    assert repo.get_snapshot(trip.trip.id) == edited


@pytest.mark.parametrize("status", ["complete", "partial"])
def test_research_adoption_uses_stored_candidate_and_only_confirm_writes(repo, trip, status):
    value = completed_run(repo, trip, status=status)
    request = ResearchAdopt(candidateIndex=0, target="idea")
    proposal = repo.research_proposal(trip.trip.id, value.id, request)
    assert repo.get_snapshot(trip.trip.id) == trip
    assert proposal.actions[0].idea.title == value.result["candidates"][0]["title"]
    assert proposal.actions[0].idea.place.providerId == "fixture-poi"
    assert repo.research_proposal(trip.trip.id, value.id, request).id == proposal.id
    saved = execute(repo, trip, "confirmProposal", proposalId=proposal.id)
    assert saved.ideas[0].sourceKind == "agent" and f"research:{value.id}:0" in saved.ideas[0].evidence
    with pytest.raises(DomainError) as failure:
        repo.research_proposal(trip.trip.id, value.id, request)
    assert failure.value.code == "CANDIDATE_ALREADY_ADOPTED"


def test_research_activity_preview_requires_explicit_date_and_preserves_untimed(repo, trip):
    value = completed_run(repo, trip)
    with pytest.raises(DomainError) as failure:
        repo.research_proposal(trip.trip.id, value.id, ResearchAdopt(candidateIndex=0, target="activity"))
    assert failure.value.code == "DATE_REQUIRED"
    proposal = repo.research_proposal(trip.trip.id, value.id, ResearchAdopt(candidateIndex=0, target="activity", date="2026-11-04"))
    assert proposal.actions[0].activity.startAt is None
    saved = execute(repo, trip, "confirmProposal", proposalId=proposal.id)
    assert saved.activities[0].date.isoformat() == "2026-11-04" and saved.activities[0].startAt is None
    assert f"research:{value.id}:0" in saved.activities[0].notes


def test_invalid_research_evidence_cannot_be_persisted_as_success(repo, trip):
    run, _ = repo.begin_research(trip.trip.id, ResearchStart(question="合成研究", requestId="invalid"))
    repo.claim_research(trip.trip.id, run.id)
    bad = research_output()
    bad["result"]["candidates"][0]["claims"][0]["evidenceRefs"] = ["ev:invented"]
    with pytest.raises(DomainError) as failure:
        repo.finish_research(trip.trip.id, run.id, bad)
    assert failure.value.code == "RESEARCH_INVALID_RESULT"
    assert repo.get_research(trip.trip.id, run.id).result is None


@pytest.mark.parametrize("explicit_date,expected_date", [(None, "2026-11-03"), ("2026-11-04", "2026-11-04")])
def test_research_activity_uses_typed_candidate_date_unless_user_overrides(repo, trip, explicit_date, expected_date):
    run, _ = repo.begin_research(trip.trip.id, ResearchStart(question="合成研究", requestId="dated-candidate"))
    repo.claim_research(trip.trip.id, run.id)
    output = research_output()
    output["result"]["candidates"][0]["proposedDate"] = "2026-11-03"
    repo.finish_research(trip.trip.id, run.id, output)
    proposal = repo.research_proposal(trip.trip.id, run.id,
        ResearchAdopt(candidateIndex=0, target="activity", date=explicit_date))
    assert proposal.actions[0].activity.date.isoformat() == expected_date
    assert repo.get_snapshot(trip.trip.id) == trip
    saved = execute(repo, trip, "confirmProposal", proposalId=proposal.id)
    assert saved.activities[0].date.isoformat() == expected_date
    assert saved.version == trip.version + 1


def test_research_cross_trip_access_is_rejected(repo, trip):
    value = completed_run(repo, trip)
    other = repo.create_trip(TripCreate())
    for access in (lambda: repo.get_research(other.trip.id, value.id),
                   lambda: repo.cancel_research(other.trip.id, value.id),
                   lambda: repo.research_proposal(other.trip.id, value.id, ResearchAdopt(candidateIndex=0, target="idea"))):
        with pytest.raises(DomainError) as failure:
            access()
        assert failure.value.code == "RESEARCH_NOT_FOUND"


def test_research_pending_preview_conflict_and_stale_confirm_are_safe(repo, trip):
    value = completed_run(repo, trip)
    proposal = repo.research_proposal(trip.trip.id, value.id, ResearchAdopt(candidateIndex=0, target="idea"))
    with pytest.raises(DomainError) as failure:
        repo.research_proposal(trip.trip.id, value.id, ResearchAdopt(candidateIndex=0, target="activity", date="2026-11-03"))
    assert failure.value.code == "CANDIDATE_PROPOSAL_EXISTS"
    edited = execute(repo, trip, "addIdea", idea={"title": "人刚添加的新候选"})
    with pytest.raises(DomainError) as failure:
        execute(repo, edited, "confirmProposal", proposalId=proposal.id)
    assert failure.value.code == "PROPOSAL_STALE"
    assert len(repo.get_snapshot(trip.trip.id).ideas) == 1


def test_legacy_suggestion_preview_uses_stored_text_and_confirms_once(repo, trip):
    suggestion = repo.add_suggestions(trip.trip.id, [SuggestionDraft(title="存储的建议", rationale="存储的理由", evidenceRefs=["snapshot:1"])])[0]
    current = repo.get_snapshot(trip.trip.id)
    proposal = repo.suggestion_proposal(trip.trip.id, suggestion.id, "idea")
    assert proposal.actions[0].idea.title == "存储的建议"
    assert repo.get_snapshot(trip.trip.id) == current
    assert repo.suggestion_proposal(trip.trip.id, suggestion.id, "idea").id == proposal.id
    saved = execute(repo, current, "confirmProposal", proposalId=proposal.id)
    assert saved.version == current.version + 1
    assert saved.suggestions[0].status == "accepted"
    assert saved.ideas[0].evidence == [f"suggestion:{suggestion.id}", "snapshot:1"]
    with pytest.raises(DomainError) as failure:
        repo.suggestion_proposal(trip.trip.id, suggestion.id, "idea")
    assert failure.value.code == "SUGGESTION_RESOLVED"


def test_legacy_suggestion_resolution_invalidates_pending_preview(repo, trip):
    suggestion = repo.add_suggestions(trip.trip.id, [SuggestionDraft(title="建议", rationale="理由")])[0]
    current = repo.get_snapshot(trip.trip.id)
    proposal = repo.suggestion_proposal(trip.trip.id, suggestion.id, "idea")
    dismissed = execute(repo, current, "dismissSuggestion", suggestionId=suggestion.id)
    assert context_hash(dismissed) == proposal.contextHash
    with pytest.raises(DomainError) as failure:
        execute(repo, dismissed, "confirmProposal", proposalId=proposal.id)
    assert failure.value.code == "SUGGESTION_RESOLVED"
    assert not repo.get_snapshot(trip.trip.id).ideas


def test_legacy_suggestion_date_scope_and_preview_target_are_validated(repo, trip):
    suggestion = repo.add_suggestions(trip.trip.id, [SuggestionDraft(title="建议", rationale="理由")])[0]
    with pytest.raises(DomainError) as failure:
        repo.suggestion_proposal(trip.trip.id, suggestion.id, "activity")
    assert failure.value.code == "DATE_REQUIRED"
    with pytest.raises(DomainError) as failure:
        repo.suggestion_proposal(trip.trip.id, suggestion.id, "activity", "2026-12-01")
    assert failure.value.code == "DATE_OUTSIDE_TRIP"
    proposal = repo.suggestion_proposal(trip.trip.id, suggestion.id, "activity", "2026-11-03")
    with pytest.raises(DomainError) as failure:
        repo.suggestion_proposal(trip.trip.id, suggestion.id, "idea")
    assert failure.value.code == "SUGGESTION_PROPOSAL_EXISTS"
    assert proposal.actions[0].activity.startAt is None
    other = repo.create_trip(TripCreate())
    with pytest.raises(DomainError) as failure:
        repo.suggestion_proposal(other.trip.id, suggestion.id, "idea")
    assert failure.value.code == "SUGGESTION_NOT_FOUND"
