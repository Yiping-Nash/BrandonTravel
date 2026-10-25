from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from apps.api.db.repository import Repository
from apps.api.domain.errors import DomainError
from apps.api.routes.workspace import create_router
from packages.contracts import ChatMessage, ChatResponse, ChatSession, Command, Suggestion, SuggestionDraft, TripCreate


@pytest.fixture
def repo(tmp_path):
    return Repository(tmp_path / "workspace.sqlite")


@pytest.fixture
def trip(repo):
    return repo.create_trip(TripCreate(title="杭州五日", destination="杭州", startDate="2026-11-02", endDate="2026-11-06"))


def execute(repo, snapshot, kind, **values):
    return repo.execute(snapshot.trip.id, Command(expectedVersion=snapshot.version, command={"type": kind, **values}))


def add(repo, snapshot, title="散步", day="2026-11-02", **values):
    return execute(repo, snapshot, "addActivity", activity={"title": title, "date": day, **values})


def test_persistent_trip_custom_activity_and_idea(repo, trip):
    snapshot = execute(repo, trip, "addIdea", idea={"title": "咖啡"})
    snapshot = add(repo, snapshot)
    read = Repository(repo.path).get_snapshot(trip.trip.id)
    assert read == snapshot
    assert len(repo.list_trips()) == 1
    assert read.activities[0].place is None
    assert read.activities[0].startAt is None
    assert read.ideas[0].sourceKind == "manual"


def test_idea_adopt_preserves_candidate_and_delete_only_unlinks(repo, trip):
    snapshot = execute(repo, trip, "addIdea", idea={"title": "咖啡", "description": "喝一杯"})
    idea = snapshot.ideas[0]
    snapshot = execute(repo, snapshot, "adoptIdea", ideaId=idea.id, date="2026-11-03")
    assert snapshot.ideas == [idea]
    assert snapshot.activities[0].ideaId == idea.id
    snapshot = execute(repo, snapshot, "deleteIdea", ideaId=idea.id)
    assert not snapshot.ideas
    assert snapshot.activities[0].ideaId is None
    assert snapshot.activities[0].title == "咖啡"


def test_board_move_reorder_and_calendar_edit_roundtrip(repo, trip):
    snapshot = add(repo, trip, "散步", startAt="2026-11-02T09:00", endAt="2026-11-02T10:30")
    timed_id = snapshot.activities[0].id
    snapshot = add(repo, snapshot, "午餐")
    lunch_id = snapshot.activities[1].id
    snapshot = add(repo, snapshot, "展览", day="2026-11-03")
    snapshot = execute(repo, snapshot, "moveActivity", activityId=timed_id, date="2026-11-03", index=0)
    moved = next(a for a in snapshot.activities if a.id == timed_id)
    assert moved.startAt == "2026-11-03T09:00"
    assert moved.endAt == "2026-11-03T10:30"
    assert moved.sortKey == 0
    snapshot = execute(repo, snapshot, "moveActivity", activityId=timed_id, date="2026-11-03", index=1)
    assert next(a for a in snapshot.activities if a.id == timed_id).sortKey == 1
    snapshot = execute(repo, snapshot, "updateActivity", activityId=timed_id, activity={
        "title": "散步", "date": "2026-11-04", "startAt": "2026-11-04T14:00", "endAt": "2026-11-04T15:30"})
    restored = Repository(repo.path).get_snapshot(trip.trip.id)
    assert restored == snapshot
    assert next(a for a in restored.activities if a.id == timed_id).date.isoformat() == "2026-11-04"
    assert next(a for a in restored.activities if a.id == lunch_id).startAt is None
    assert all(a.sortKey == 0 for a in restored.activities)


def test_remove_reindexes_and_preferences_persist(repo, trip):
    snapshot = add(repo, trip, "one")
    first = snapshot.activities[0].id
    snapshot = add(repo, snapshot, "two")
    snapshot = execute(repo, snapshot, "removeActivity", activityId=first)
    assert snapshot.activities[0].sortKey == 0
    snapshot = execute(repo, snapshot, "setPreferences", preferences="少走路")
    assert Repository(repo.path).get_snapshot(trip.trip.id).trip.preferences == "少走路"


def test_stale_write_rejected_and_does_not_mutate(repo, trip):
    saved = add(repo, trip, "one")
    with pytest.raises(DomainError) as error:
        add(repo, trip, "stale")
    assert error.value.status == 409
    assert repo.get_snapshot(trip.trip.id) == saved


def test_concurrent_same_version_has_exactly_one_winner(repo, trip):
    barrier = Barrier(2)
    def writer(title):
        other = Repository(repo.path)
        barrier.wait()
        try:
            add(other, trip, title)
            return 200
        except DomainError as error:
            return error.status
    with ThreadPoolExecutor(max_workers=2) as executor:
        result = list(executor.map(writer, ["a", "b"]))
    assert sorted(result) == [200, 409]
    assert len(repo.get_snapshot(trip.trip.id).activities) == 1


@pytest.mark.parametrize("command", [
    {"type": "addActivity", "activity": {"title": "bad date", "date": "2026-11-09"}},
    {"type": "addActivity", "activity": {"title": "bad ref", "date": "2026-11-02", "ideaId": "unknown"}},
    {"type": "removeActivity", "activityId": "unknown"},
    {"type": "addIdea", "idea": {"title": "   "}},
])
def test_invalid_command_has_no_partial_write(repo, trip, command):
    with pytest.raises(DomainError):
        repo.execute(trip.trip.id, Command(expectedVersion=1, command=command))
    assert repo.get_snapshot(trip.trip.id) == trip


def test_invalid_move_rolls_back_removal(repo, trip):
    snapshot = add(repo, trip)
    with pytest.raises(DomainError):
        execute(repo, snapshot, "moveActivity", activityId=snapshot.activities[0].id, date="2026-11-03", index=100)
    assert repo.get_snapshot(trip.trip.id) == snapshot


@pytest.mark.parametrize("day,start,end,code", [
    ("2026-03-08", "02:15", "03:15", "NONEXISTENT_LOCAL_TIME"),
    ("2026-11-01", "01:15", "02:15", "AMBIGUOUS_LOCAL_TIME"),
])
def test_dst_invalid_local_times(repo, day, start, end, code):
    snapshot = repo.create_trip(TripCreate(title="NY", destination="NY", startDate=day, endDate=day, timezone="America/New_York"))
    with pytest.raises(DomainError) as error:
        add(repo, snapshot, day=day, startAt=f"{day}T{start}", endAt=f"{day}T{end}")
    assert error.value.code == code
    assert not repo.get_snapshot(snapshot.trip.id).activities


def test_move_revalidates_dst(repo):
    trip = repo.create_trip(TripCreate(title="NY", destination="NY", startDate="2026-03-07", endDate="2026-03-08", timezone="America/New_York"))
    snapshot = add(repo, trip, day="2026-03-07", startAt="2026-03-07T02:15", endAt="2026-03-07T03:15")
    with pytest.raises(DomainError) as error:
        execute(repo, snapshot, "moveActivity", activityId=snapshot.activities[0].id, date="2026-03-08", index=0)
    assert error.value.code == "NONEXISTENT_LOCAL_TIME"
    assert repo.get_snapshot(trip.trip.id) == snapshot


def test_suggestions_do_not_write_without_confirmation_and_adopt_once(repo, trip):
    proposals = repo.add_suggestions(trip.trip.id, [SuggestionDraft(title="湖边散步", rationale="留一点空白")])
    snapshot = repo.get_snapshot(trip.trip.id)
    assert snapshot.version == 2
    assert not snapshot.ideas and not snapshot.activities
    assert snapshot.suggestions == proposals
    snapshot = execute(repo, snapshot, "adoptSuggestion", suggestionId=proposals[0].id, target="idea")
    assert snapshot.ideas[0].sourceKind == "agent"
    assert f"suggestion:{proposals[0].id}" in snapshot.ideas[0].evidence
    assert snapshot.suggestions[0].status == "accepted"
    with pytest.raises(DomainError) as error:
        execute(repo, snapshot, "adoptSuggestion", suggestionId=proposals[0].id, target="idea")
    assert error.value.status == 409
    assert len(repo.get_snapshot(trip.trip.id).ideas) == 1


def test_suggestion_activity_confirmation_date_and_dismissal(repo, trip):
    proposals = repo.add_suggestions(trip.trip.id, [SuggestionDraft(title="午后休息", rationale="r" * 4000), SuggestionDraft(title="另一条", rationale="x")])
    snapshot = repo.get_snapshot(trip.trip.id)
    with pytest.raises(DomainError) as error:
        execute(repo, snapshot, "adoptSuggestion", suggestionId=proposals[0].id, target="activity")
    assert error.value.code == "DATE_REQUIRED"
    snapshot = execute(repo, snapshot, "adoptSuggestion", suggestionId=proposals[0].id, target="activity", date="2026-11-03")
    assert proposals[0].id in snapshot.activities[0].notes
    assert snapshot.activities[0].startAt is None
    snapshot = execute(repo, snapshot, "dismissSuggestion", suggestionId=proposals[1].id)
    assert snapshot.suggestions[1].status == "dismissed"
    assert len(snapshot.activities) == 1


def test_invalid_suggestion_batch_is_atomic(repo, trip):
    with pytest.raises(DomainError):
        repo.add_suggestions(trip.trip.id, [SuggestionDraft(title="okay", rationale="x"), SuggestionDraft(title="bad", rationale="x", proposedDate="2026-11-10")])
    assert repo.get_snapshot(trip.trip.id) == trip


def message(content):
    return ChatMessage(role="user", content=content, createdAt="2026-10-26T00:00:00Z")


def test_sessions_persist_and_cannot_cross_trip_or_overwrite(repo, trip):
    session = ChatSession(id="chat-one", tripId=trip.trip.id, title="第一天", messages=[message("hello")])
    repo.save_session(session)
    assert Repository(repo.path).list_sessions(trip.trip.id) == [session]
    assert repo.get_session(trip.trip.id, "chat-one") == session
    newer = session.model_copy(deep=True)
    newer.messages.append(message("new"))
    repo.save_session(newer)
    with pytest.raises(DomainError) as error:
        repo.save_session(session)
    assert error.value.code == "SESSION_CONFLICT"
    other = repo.create_trip(TripCreate(title="other", destination="x", startDate="2026-11-02", endDate="2026-11-02"))
    with pytest.raises(DomainError):
        repo.get_session(other.trip.id, "chat-one")
    session.tripId = other.trip.id
    with pytest.raises(DomainError) as error:
        repo.save_session(session)
    assert error.value.code == "SESSION_TRIP_MISMATCH"


def test_router_wire_contract_and_error_status(repo):
    app = FastAPI()
    @app.exception_handler(DomainError)
    async def handle(request, error):
        return JSONResponse(status_code=error.status, content={"error": {"code": error.code, "message": error.message}})
    app.include_router(create_router(repo))
    with TestClient(app) as client:
        response = client.post("/api/trips", json={"title": "Demo", "destination": "杭州", "startDate": "2026-11-02", "endDate": "2026-11-06"})
        assert response.status_code == 201
        snapshot = response.json()
        trip_id = snapshot["trip"]["id"]
        command = {"expectedVersion": 1, "command": {"type": "addActivity", "activity": {"title": "步行", "date": "2026-11-02"}}}
        response = client.post(f"/api/trips/{trip_id}/commands", json=command)
        assert response.status_code == 200
        assert response.json()["activities"][0]["startAt"] is None
        assert client.post(f"/api/trips/{trip_id}/commands", json=command).status_code == 409
        assert client.get("/api/trips/absent").status_code == 404
        assert client.get(f"/api/trips/{trip_id}/sessions").json() == []
        assert client.post(f"/api/trips/{trip_id}/commands", json={"expectedVersion": 2, "command": {"type": "unknown"}}).status_code == 422


def chat_turn(trip, *, title="散步建议", session_id="atomic-chat"):
    draft = SuggestionDraft(title="湖边散步", rationale="留一些空白")
    response = ChatResponse(sessionId=session_id, reply="建议供你确认。",
                            suggestions=[Suggestion(**draft.model_dump(), id="agent-temporary-id", tripId=trip.trip.id)],
                            uncertainty=[], mode="demo", snapshotVersion=trip.version)
    session = ChatSession(id=session_id, tripId=trip.trip.id, title=title, messages=[
        message("推荐一个轻松的活动"),
        ChatMessage(role="assistant", content=response.reply, createdAt="2026-10-26T00:00:00Z", response=response)])
    return draft, session, response


def test_finalize_chat_atomically_saves_matching_proposals_and_transcript(repo, trip):
    draft, session, response = chat_turn(trip)
    saved = repo.finalize_chat(trip.trip.id, [draft], session, response)
    reopened = Repository(repo.path)
    snapshot = reopened.get_snapshot(trip.trip.id)
    transcript = reopened.get_session(trip.trip.id, session.id)
    assert saved.suggestions == snapshot.suggestions == transcript.messages[-1].response.suggestions
    assert saved.suggestions[0].id != "agent-temporary-id"
    assert saved.snapshotVersion == 1  # The Agent-read version is not rewritten.
    assert snapshot.version == 2
    assert not snapshot.activities and not snapshot.ideas
    assert response.suggestions[0].id == "agent-temporary-id"
    assert session.messages[-1].response.suggestions[0].id == "agent-temporary-id"


def test_finalize_chat_rolls_back_proposals_when_session_invalid(repo, trip):
    draft, session, response = chat_turn(trip, title=" " * 60)
    with pytest.raises(DomainError) as error:
        repo.finalize_chat(trip.trip.id, [draft], session, response)
    assert error.value.code == "INVALID_SESSION"
    assert repo.get_snapshot(trip.trip.id) == trip
    assert repo.list_sessions(trip.trip.id) == []


def test_finalize_chat_rolls_back_proposals_when_transcript_conflicts(repo, trip):
    draft, session, response = chat_turn(trip)
    prior = session.model_copy(deep=True)
    prior.messages[0].content = "另一个请求已经保存"
    repo.save_session(prior)
    with pytest.raises(DomainError) as error:
        repo.finalize_chat(trip.trip.id, [draft], session, response)
    assert error.value.code == "SESSION_CONFLICT"
    assert repo.get_snapshot(trip.trip.id) == trip
    assert repo.get_session(trip.trip.id, session.id) == prior


def test_finalize_chat_without_suggestions_only_saves_transcript(repo, trip):
    _draft, session, response = chat_turn(trip)
    response.suggestions = []
    result = repo.finalize_chat(trip.trip.id, [], session, response)
    assert not result.suggestions
    assert repo.get_snapshot(trip.trip.id) == trip
    assert repo.get_session(trip.trip.id, session.id).messages[-1].response == result
