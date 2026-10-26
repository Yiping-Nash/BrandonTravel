from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from packages.contracts import (ActivityInput, AddActivity, AddIdea, ChatResponse, ChatSession, Command,
    IdeaInput, PlanGeneration, PlanRequest, Proposal, ProposalDraft, ResearchAdopt, ResearchRun,
    ResearchStart, Suggestion, SuggestionDraft, Trip, TripCreate, TripSnapshot)
from apps.api.domain.commands import apply_command, identifier, now, require_date, require_text
from apps.api.domain.errors import DomainError
from apps.api.agent.research_contracts import Evidence, ResearchBrief, ResearchResult, context_hash, validate_result


class Repository:
    """One SQLite transaction per domain command; no view-specific copies of state."""

    def __init__(self, path: str | Path):
        self._keeper = None
        self._uri = str(path) == ":memory:"
        if self._uri:
            self.path = f"file:brandontravel-{uuid4()}?mode=memory&cache=shared"
            self._keeper = sqlite3.connect(self.path, uri=True, check_same_thread=False)
        else:
            self.path = str(Path(path).resolve())
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS trips (
                    id TEXT PRIMARY KEY,
                    version INTEGER NOT NULL CHECK(version > 0),
                    snapshot TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    trip_id TEXT NOT NULL REFERENCES trips(id),
                    session TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_trip ON sessions(trip_id);
                CREATE TABLE IF NOT EXISTS research_runs (
                    id TEXT PRIMARY KEY,
                    trip_id TEXT NOT NULL REFERENCES trips(id),
                    status TEXT NOT NULL,
                    run TEXT NOT NULL,
                    captured_snapshot TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS research_runs_trip ON research_runs(trip_id);
                CREATE UNIQUE INDEX IF NOT EXISTS research_one_active ON research_runs(trip_id)
                    WHERE status IN ('queued','running');
                CREATE TABLE IF NOT EXISTS proposals (
                    id TEXT PRIMARY KEY,
                    trip_id TEXT NOT NULL REFERENCES trips(id),
                    status TEXT NOT NULL,
                    proposal TEXT NOT NULL,
                    research_run_id TEXT REFERENCES research_runs(id),
                    candidate_index INTEGER
                );
                CREATE INDEX IF NOT EXISTS proposals_trip ON proposals(trip_id);
                CREATE UNIQUE INDEX IF NOT EXISTS proposal_pending_candidate ON proposals(research_run_id,candidate_index)
                    WHERE status='proposed' AND research_run_id IS NOT NULL;
                CREATE TABLE IF NOT EXISTS research_adoptions (
                    run_id TEXT NOT NULL REFERENCES research_runs(id),
                    candidate_index INTEGER NOT NULL,
                    proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
                    PRIMARY KEY(run_id,candidate_index)
                );
                CREATE TABLE IF NOT EXISTS suggestion_proposals (
                    proposal_id TEXT PRIMARY KEY REFERENCES proposals(id),
                    trip_id TEXT NOT NULL REFERENCES trips(id),
                    suggestion_id TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS suggestion_proposals_source ON suggestion_proposals(trip_id,suggestion_id);
                CREATE TABLE IF NOT EXISTS portfolio_requests (
                    trip_id TEXT NOT NULL REFERENCES trips(id),
                    operation TEXT NOT NULL,
                    request_id TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    resource_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    captured_snapshot TEXT,
                    PRIMARY KEY(trip_id,operation,request_id)
                );
            """)

    @contextmanager
    def _connection(self, *, write: bool = False):
        connection = sqlite3.connect(self.path, timeout=10, uri=self._uri)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except sqlite3.OperationalError as error:
            connection.rollback()
            if "locked" in str(error).lower() or "busy" in str(error).lower():
                raise DomainError(503, "WORKSPACE_BUSY", "工作区正在保存，请稍后重试。") from None
            raise
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _read(connection, trip_id: str) -> TripSnapshot:
        row = connection.execute("SELECT snapshot FROM trips WHERE id=?", (trip_id,)).fetchone()
        if row is None:
            raise DomainError(404, "TRIP_NOT_FOUND", "找不到此旅行。")
        return TripSnapshot.model_validate_json(row["snapshot"])

    @staticmethod
    def _write(connection, snapshot: TripSnapshot, previous_version: int) -> None:
        # Revalidate after mutable domain operations before serializing authoritative state.
        snapshot = TripSnapshot.model_validate(snapshot.model_dump())
        result = connection.execute(
            "UPDATE trips SET version=?, snapshot=?, updated_at=? WHERE id=? AND version=?",
            (snapshot.version, snapshot.model_dump_json(), snapshot.trip.updatedAt, snapshot.trip.id, previous_version))
        if result.rowcount != 1:
            raise DomainError(409, "VERSION_CONFLICT", "工作区已更新，请刷新后重试。")

    def list_trips(self) -> list[Trip]:
        with self._connection() as connection:
            rows = connection.execute("SELECT snapshot FROM trips ORDER BY updated_at DESC, id").fetchall()
            return [TripSnapshot.model_validate_json(row["snapshot"]).trip for row in rows]

    def create_trip(self, value: TripCreate) -> TripSnapshot:
        value = TripCreate.model_validate(value.model_dump())
        require_text(value.title)
        value.destination = value.destination.strip()
        stamp = now()
        trip = Trip(**value.model_dump(), id=identifier(), createdAt=stamp, updatedAt=stamp)
        snapshot = TripSnapshot(version=1, trip=trip)
        with self._connection(write=True) as connection:
            connection.execute("INSERT INTO trips(id,version,snapshot,updated_at) VALUES(?,?,?,?)",
                               (trip.id, 1, snapshot.model_dump_json(), stamp))
        return snapshot

    def get_snapshot(self, trip_id: str) -> TripSnapshot:
        with self._connection() as connection:
            return self._read(connection, trip_id)

    def execute(self, trip_id: str, command: Command) -> TripSnapshot:
        command = Command.model_validate(command.model_dump())
        with self._connection(write=True) as connection:
            snapshot = self._read(connection, trip_id)
            if snapshot.version != command.expectedVersion:
                raise DomainError(409, "VERSION_CONFLICT", "工作区已更新，请刷新后重试。")
            if command.command.type == "dismissProposal":
                self._dismiss_proposal(connection, trip_id, command.command.proposalId)
                return snapshot  # Proposal bookkeeping is not a Workspace edit.
            if command.command.type == "confirmProposal":
                self._confirm_proposal(connection, snapshot, command.command.proposalId)
            else:
                apply_command(snapshot, command.command)
            snapshot.version += 1
            self._write(connection, snapshot, command.expectedVersion)
            return snapshot

    def add_suggestions(self, trip_id: str, drafts: list[SuggestionDraft]) -> list[Suggestion]:
        """Integration-only path: Agent proposals cannot write Ideas or Activities."""
        with self._connection(write=True) as connection:
            return self._add_suggestions(connection, trip_id, drafts)

    def _add_suggestions(self, connection, trip_id: str, drafts: list[SuggestionDraft]) -> list[Suggestion]:
        if len(drafts) > 8:
            raise DomainError(422, "TOO_MANY_SUGGESTIONS", "每次最多生成八条建议。")
        snapshot = self._read(connection, trip_id)
        proposals = []
        for draft in drafts:
            draft = SuggestionDraft.model_validate(draft.model_dump(include=set(SuggestionDraft.model_fields)))
            require_text(draft.title)
            require_text(draft.rationale, "建议原因")
            if draft.proposedDate is not None:
                require_date(snapshot, draft.proposedDate)
            proposals.append(Suggestion(**draft.model_dump(), id=identifier(), tripId=trip_id, status="proposed"))
        if proposals:
            previous_version = snapshot.version
            snapshot.suggestions.extend(proposals)
            snapshot.version += 1
            snapshot.trip.updatedAt = now()
            self._write(connection, snapshot, previous_version)
        return proposals

    def list_sessions(self, trip_id: str) -> list[ChatSession]:
        with self._connection() as connection:
            self._read(connection, trip_id)
            rows = connection.execute("SELECT session FROM sessions WHERE trip_id=? ORDER BY updated_at DESC, id",
                                      (trip_id,)).fetchall()
            return [ChatSession.model_validate_json(row["session"]) for row in rows]

    def get_session(self, trip_id: str, session_id: str) -> ChatSession:
        with self._connection() as connection:
            self._read(connection, trip_id)
            row = connection.execute("SELECT session FROM sessions WHERE id=? AND trip_id=?", (session_id, trip_id)).fetchone()
            if row is None:
                raise DomainError(404, "SESSION_NOT_FOUND", "此旅行中找不到聊天会话。")
            return ChatSession.model_validate_json(row["session"])

    def save_session(self, session: ChatSession) -> None:
        with self._connection(write=True) as connection:
            self._save_session(connection, session)

    def _save_session(self, connection, session: ChatSession) -> None:
        session = ChatSession.model_validate(session.model_dump())
        if not session.id or len(session.id) > 200 or not session.title.strip() or len(session.title) > 200:
            raise DomainError(422, "INVALID_SESSION", "无效的聊天会话。")
        for message in session.messages:
            if message.response is not None:
                if message.response.sessionId != session.id or any(s.tripId != session.tripId for s in message.response.suggestions):
                    raise DomainError(422, "SESSION_TRIP_MISMATCH", "聊天响应与旅行会话不一致。")
        self._read(connection, session.tripId)
        existing = connection.execute("SELECT trip_id,session FROM sessions WHERE id=?", (session.id,)).fetchone()
        if existing:
            if existing["trip_id"] != session.tripId:
                raise DomainError(409, "SESSION_TRIP_MISMATCH", "聊天会话已属于其他旅行。")
            previous = ChatSession.model_validate_json(existing["session"])
            if previous.messages != session.messages[:len(previous.messages)]:
                raise DomainError(409, "SESSION_CONFLICT", "此聊天已有新消息，请刷新后重试。")
            connection.execute("UPDATE sessions SET session=?,updated_at=? WHERE id=?",
                               (session.model_dump_json(), now(), session.id))
        else:
            connection.execute("INSERT INTO sessions(id,trip_id,session,updated_at) VALUES(?,?,?,?)",
                               (session.id, session.tripId, session.model_dump_json(), now()))

    def finalize_chat(self, trip_id: str, drafts: list[SuggestionDraft], session: ChatSession,
                      response: ChatResponse) -> ChatResponse:
        """Persist one completed chat turn and its proposed suggestions atomically.

        The caller supplies a session with the new user/assistant messages already
        appended. Returned suggestion IDs are the persisted IDs. snapshotVersion
        intentionally records the version the Agent read, not the proposal write.
        Inputs stay untouched if validation or concurrent transcript checks fail.
        """
        session = ChatSession.model_validate(session.model_dump())
        response = ChatResponse.model_validate(response.model_dump())
        if session.tripId != trip_id or response.sessionId != session.id:
            raise DomainError(422, "SESSION_TRIP_MISMATCH", "聊天响应与旅行会话不一致。")
        if (not session.messages or session.messages[-1].role != "assistant"
                or session.messages[-1].content != response.reply):
            raise DomainError(422, "INVALID_CHAT_TURN", "聊天会话必须以当前助手响应结束。")
        with self._connection(write=True) as connection:
            response.suggestions = self._add_suggestions(connection, trip_id, drafts)
            session.messages[-1].response = response
            self._save_session(connection, session)
        return response

    # Portfolio records are sidecars: pending work never enters TripSnapshot.
    @staticmethod
    def _payload_hash(value) -> str:
        return hashlib.sha256(json.dumps(value.model_dump(mode="json", exclude={"requestId"}),
            ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    @staticmethod
    def _require_ai_context(snapshot: TripSnapshot) -> None:
        if not snapshot.trip.destination.strip() or not snapshot.trip.startDate or not snapshot.trip.endDate:
            raise DomainError(422, "TRIP_DETAILS_REQUIRED", "请先补全目的地和旅行起止日期，再使用 AI 安排或研究。")

    @staticmethod
    def _read_proposal(connection, trip_id: str, proposal_id: str) -> Proposal:
        row = connection.execute("SELECT proposal FROM proposals WHERE id=? AND trip_id=?",
                                 (proposal_id, trip_id)).fetchone()
        if row is None:
            raise DomainError(404, "PROPOSAL_NOT_FOUND", "此旅行中找不到这份方案。")
        return Proposal.model_validate_json(row["proposal"])

    @staticmethod
    def _store_proposal(connection, proposal: Proposal) -> None:
        connection.execute("INSERT INTO proposals(id,trip_id,status,proposal,research_run_id,candidate_index) VALUES(?,?,?,?,?,?)",
            (proposal.id, proposal.tripId, proposal.status, proposal.model_dump_json(), proposal.researchRunId, proposal.candidateIndex))

    @staticmethod
    def _update_proposal(connection, proposal: Proposal) -> None:
        connection.execute("UPDATE proposals SET status=?,proposal=? WHERE id=? AND trip_id=?",
            (proposal.status, proposal.model_dump_json(), proposal.id, proposal.tripId))

    @staticmethod
    def _validate_actions(snapshot: TripSnapshot, draft: ProposalDraft) -> None:
        require_text(draft.title)
        require_text(draft.summary, "方案说明")
        private = snapshot.model_copy(deep=True)
        for action in draft.actions:
            apply_command(private, action)
        # apply_command mutates only this detached validation copy.
        TripSnapshot.model_validate(private.model_dump())

    def list_proposals(self, trip_id: str) -> list[Proposal]:
        with self._connection() as connection:
            self._read(connection, trip_id)
            rows = connection.execute("SELECT proposal FROM proposals WHERE trip_id=? ORDER BY rowid DESC", (trip_id,)).fetchall()
            return [Proposal.model_validate_json(row["proposal"]) for row in rows]

    def begin_plan(self, trip_id: str, request: PlanRequest) -> tuple[TripSnapshot, Proposal | None]:
        """Reserve a generation request before model I/O; retries never call twice."""
        request = PlanRequest.model_validate(request.model_dump())
        require_text(request.requestId, "请求 ID")
        require_text(request.message, "问题")
        digest = self._payload_hash(request)
        with self._connection(write=True) as connection:
            snapshot = self._read(connection, trip_id)
            existing = connection.execute("SELECT * FROM portfolio_requests WHERE trip_id=? AND operation='plan' AND request_id=?",
                                          (trip_id, request.requestId)).fetchone()
            if existing:
                if existing["payload_hash"] != digest:
                    raise DomainError(409, "IDEMPOTENCY_CONFLICT", "同一请求 ID 不能用于不同内容，请刷新后重新发起。")
                if existing["status"] == "completed":
                    return snapshot, self._read_proposal(connection, trip_id, existing["resource_id"])
                code = "REQUEST_IN_PROGRESS" if existing["status"] == "pending" else "REQUEST_FAILED"
                raise DomainError(409, code, "该请求正在处理或已失败；请检查已保存方案，失败后使用新请求重试。")
            self._require_ai_context(snapshot)
            if request.kind == "day" and request.date is None:
                raise DomainError(422, "DATE_REQUIRED", "请先选择要讨论的日期。")
            if request.date is not None:
                require_date(snapshot, request.date)
            connection.execute("INSERT INTO portfolio_requests VALUES(?,?,?,?,?,?,?)",
                (trip_id, "plan", request.requestId, digest, identifier(), "pending", snapshot.model_dump_json()))
            return snapshot, None

    def finish_plan(self, trip_id: str, request: PlanRequest, generation: PlanGeneration) -> Proposal:
        generation = PlanGeneration.model_validate(generation.model_dump())
        with self._connection(write=True) as connection:
            self._read(connection, trip_id)
            row = connection.execute("SELECT * FROM portfolio_requests WHERE trip_id=? AND operation='plan' AND request_id=?",
                                     (trip_id, request.requestId)).fetchone()
            if not row or row["payload_hash"] != self._payload_hash(request) or row["status"] != "pending":
                raise DomainError(409, "REQUEST_RESOLVED", "该方案请求已结束，不能再次保存。")
            captured = TripSnapshot.model_validate_json(row["captured_snapshot"])
            if generation.proposal.kind != request.kind:
                raise DomainError(502, "PLAN_KIND_MISMATCH", "AI 返回的方案类型不符合请求，请重试。")
            self._validate_actions(captured, generation.proposal)
            proposal = Proposal(**generation.proposal.model_dump(), id=row["resource_id"], tripId=trip_id,
                contextHash=context_hash(captured), createdAt=now(), traceUrl=generation.traceUrl)
            self._store_proposal(connection, proposal)
            connection.execute("UPDATE portfolio_requests SET status='completed' WHERE trip_id=? AND operation='plan' AND request_id=?",
                               (trip_id, request.requestId))
            return proposal

    def fail_plan(self, trip_id: str, request_id: str) -> None:
        with self._connection(write=True) as connection:
            connection.execute("UPDATE portfolio_requests SET status='failed' WHERE trip_id=? AND operation='plan' AND request_id=? AND status='pending'",
                               (trip_id, request_id))

    def _dismiss_proposal(self, connection, trip_id: str, proposal_id: str) -> None:
        proposal = self._read_proposal(connection, trip_id, proposal_id)
        if proposal.status != "proposed":
            raise DomainError(409, "PROPOSAL_RESOLVED", "此方案已处理，不能重复操作。")
        proposal.status = "dismissed"
        self._update_proposal(connection, proposal)

    def _confirm_proposal(self, connection, snapshot: TripSnapshot, proposal_id: str) -> None:
        proposal = self._read_proposal(connection, snapshot.trip.id, proposal_id)
        if proposal.status != "proposed":
            raise DomainError(409, "PROPOSAL_RESOLVED", "此方案已处理，不能重复采纳。")
        source_row = connection.execute("SELECT suggestion_id FROM suggestion_proposals WHERE proposal_id=? AND trip_id=?",
                                        (proposal_id, snapshot.trip.id)).fetchone()
        source_suggestion = None
        if source_row:
            source_suggestion = self._unresolved_suggestion(snapshot, source_row["suggestion_id"])
        if proposal.contextHash != context_hash(snapshot):
            raise DomainError(409, "PROPOSAL_STALE", "旅行内容已经变化，请重新生成方案后再确认。")
        if proposal.researchRunId is not None:
            research_run = self._read_research(connection, snapshot.trip.id, proposal.researchRunId)
            if research_run.contextHash != context_hash(snapshot):
                raise DomainError(409, "RESEARCH_STALE", "研究依据的旅行内容已经变化，请重新研究。")
            if connection.execute("SELECT 1 FROM research_adoptions WHERE run_id=? AND candidate_index=?",
                                  (proposal.researchRunId, proposal.candidateIndex)).fetchone():
                raise DomainError(409, "CANDIDATE_ALREADY_ADOPTED", "此研究候选已采纳，不能再次添加。")
        # All actions, the adoption marker and proposal status commit with one
        # Workspace version increment in execute(). Any failure rolls back all.
        for action in proposal.actions:
            apply_command(snapshot, action)
        if source_suggestion is not None:
            source_suggestion.status = "accepted"
        if proposal.researchRunId is not None:
            connection.execute("INSERT INTO research_adoptions VALUES(?,?,?)",
                               (proposal.researchRunId, proposal.candidateIndex, proposal.id))
        proposal.status = "accepted"
        self._update_proposal(connection, proposal)

    @staticmethod
    def _unresolved_suggestion(snapshot: TripSnapshot, suggestion_id: str) -> Suggestion:
        suggestion = next((s for s in snapshot.suggestions if s.id == suggestion_id and s.tripId == snapshot.trip.id), None)
        if suggestion is None:
            raise DomainError(404, "SUGGESTION_NOT_FOUND", "此旅行中找不到该建议。")
        if suggestion.status != "proposed":
            raise DomainError(409, "SUGGESTION_RESOLVED", "此建议已经处理，不能重复采纳。")
        return suggestion

    def suggestion_proposal(self, trip_id: str, suggestion_id: str, target: str, day=None) -> Proposal:
        """Preview legacy Main Chat suggestions from stored data, never client text."""
        if target not in {"idea", "activity"}:
            raise DomainError(422, "INVALID_TARGET", "请选择加入候选或日程。")
        with self._connection(write=True) as connection:
            snapshot = self._read(connection, trip_id)
            suggestion = self._unresolved_suggestion(snapshot, suggestion_id)
            if target == "idea":
                action = AddIdea(type="addIdea", idea=IdeaInput(title=suggestion.title, description=suggestion.rationale,
                    place=suggestion.place, sourceKind="agent", evidence=[f"suggestion:{suggestion.id}", *suggestion.evidenceRefs][:20]))
            else:
                selected_day = day or suggestion.proposedDate
                if selected_day is None:
                    raise DomainError(422, "DATE_REQUIRED", "加入日程前请选择日期。")
                from datetime import date
                if isinstance(selected_day, str):
                    try:
                        selected_day = date.fromisoformat(selected_day)
                    except ValueError:
                        raise DomainError(422, "INVALID_DATE", "请选择有效日期。") from None
                require_date(snapshot, selected_day)
                action = AddActivity(type="addActivity", activity=ActivityInput(title=suggestion.title, date=selected_day,
                    place=suggestion.place, notes=f"来源建议：{suggestion.id}\n{suggestion.rationale}"[:4000]))
            row = connection.execute("SELECT p.proposal FROM proposals p JOIN suggestion_proposals s ON p.id=s.proposal_id "
                "WHERE s.trip_id=? AND s.suggestion_id=? AND p.status='proposed'", (trip_id, suggestion_id)).fetchone()
            if row:
                previous = Proposal.model_validate_json(row["proposal"])
                if previous.contextHash != context_hash(snapshot):
                    raise DomainError(409, "PROPOSAL_STALE", "旅行已变化，请先忽略旧方案，再重新预览建议。")
                if previous.actions == [action]:
                    return previous
                raise DomainError(409, "SUGGESTION_PROPOSAL_EXISTS", "该建议已有待确认方案，请先确认或忽略原方案。")
            draft = ProposalDraft(kind="changes", title=f"采纳建议：{suggestion.title}"[:200], summary=suggestion.rationale,
                actions=[action], evidenceRefs=suggestion.evidenceRefs, assumptions=["建议不是已完成的预约；确认后才会写入工作区。"])
            self._validate_actions(snapshot, draft)
            proposal = Proposal(**draft.model_dump(), id=identifier(), tripId=trip_id, contextHash=context_hash(snapshot), createdAt=now())
            self._store_proposal(connection, proposal)
            connection.execute("INSERT INTO suggestion_proposals VALUES(?,?,?)", (proposal.id, trip_id, suggestion_id))
            return proposal

    @staticmethod
    def _read_research(connection, trip_id: str, run_id: str) -> ResearchRun:
        row = connection.execute("SELECT run FROM research_runs WHERE id=? AND trip_id=?", (run_id, trip_id)).fetchone()
        if row is None:
            raise DomainError(404, "RESEARCH_NOT_FOUND", "此旅行中找不到该研究任务。")
        return ResearchRun.model_validate_json(row["run"])

    @staticmethod
    def _write_research(connection, value: ResearchRun) -> None:
        value.updatedAt = now()
        connection.execute("UPDATE research_runs SET status=?,run=? WHERE id=? AND trip_id=?",
                           (value.status, value.model_dump_json(), value.id, value.tripId))

    def get_research(self, trip_id: str, run_id: str) -> ResearchRun:
        with self._connection() as connection:
            self._read(connection, trip_id)
            return self._read_research(connection, trip_id, run_id)

    def list_research(self, trip_id: str) -> list[ResearchRun]:
        with self._connection() as connection:
            self._read(connection, trip_id)
            rows = connection.execute("SELECT run FROM research_runs WHERE trip_id=? ORDER BY rowid DESC", (trip_id,)).fetchall()
            return [ResearchRun.model_validate_json(row["run"]) for row in rows]

    def begin_research(self, trip_id: str, request: ResearchStart) -> tuple[ResearchRun, bool]:
        request = ResearchStart.model_validate(request.model_dump())
        require_text(request.requestId, "请求 ID")
        require_text(request.question, "研究问题")
        digest = self._payload_hash(request)
        with self._connection(write=True) as connection:
            snapshot = self._read(connection, trip_id)
            existing = connection.execute("SELECT * FROM portfolio_requests WHERE trip_id=? AND operation='research' AND request_id=?",
                                          (trip_id, request.requestId)).fetchone()
            if existing:
                if existing["payload_hash"] != digest:
                    raise DomainError(409, "IDEMPOTENCY_CONFLICT", "同一请求 ID 不能用于不同研究内容。")
                return self._read_research(connection, trip_id, existing["resource_id"]), False
            self._require_ai_context(snapshot)
            if connection.execute("SELECT 1 FROM research_runs WHERE trip_id=? AND status IN ('queued','running')", (trip_id,)).fetchone():
                raise DomainError(409, "RESEARCH_ALREADY_ACTIVE", "此旅行已有研究进行中，请等待完成或先取消。")
            stamp = now()
            value = ResearchRun(id=identifier(), tripId=trip_id, question=request.question, contextHash=context_hash(snapshot),
                                status="queued", createdAt=stamp, updatedAt=stamp)
            connection.execute("INSERT INTO research_runs VALUES(?,?,?,?,?)",
                               (value.id, trip_id, value.status, value.model_dump_json(), snapshot.model_dump_json()))
            connection.execute("INSERT INTO portfolio_requests VALUES(?,?,?,?,?,?,?)",
                               (trip_id, "research", request.requestId, digest, value.id, "completed", None))
            return value, True

    def claim_research(self, trip_id: str, run_id: str) -> TripSnapshot | None:
        with self._connection(write=True) as connection:
            value = self._read_research(connection, trip_id, run_id)
            if value.status != "queued":
                return None
            row = connection.execute("SELECT captured_snapshot FROM research_runs WHERE id=? AND trip_id=?", (run_id, trip_id)).fetchone()
            snapshot = TripSnapshot.model_validate_json(row["captured_snapshot"])
            value.status = "running"
            self._write_research(connection, value)
            return snapshot

    def finish_research(self, trip_id: str, run_id: str, output: dict) -> ResearchRun:
        with self._connection(write=True) as connection:
            value = self._read_research(connection, trip_id, run_id)
            if value.status != "running":
                return value  # Cancellation/restart wins over a late result.
            row = connection.execute("SELECT captured_snapshot FROM research_runs WHERE id=? AND trip_id=?", (run_id, trip_id)).fetchone()
            captured = TripSnapshot.model_validate_json(row["captured_snapshot"])
            try:
                result = ResearchResult.model_validate(output.get("result"))
                evidence = [Evidence.model_validate(e) for e in output.get("evidence", [])]
                brief = ResearchBrief(snapshot=captured, question=value.question, taskId=value.id, contextHash=value.contextHash)
                validate_result(result, evidence, brief)
                if output.get("status") in {"Fail", "failed"}:
                    raise ValueError("Failed output cannot be a completed run")
                # Validate the public record too (tool calls, URL and nested field types).
                updated = ResearchRun(**{**value.model_dump(), "status": "partial" if result.status == "partial" else "completed",
                    "result": result.model_dump(mode="json"), "evidence": [e.model_dump(mode="json") for e in evidence],
                    "traceUrl": output.get("traceUrl"), "toolCalls": output.get("toolCalls", []), "error": None})
            except (ValueError, TypeError, AttributeError):
                raise DomainError(502, "RESEARCH_INVALID_RESULT", "研究结果未通过证据或数据校验，未保存建议。") from None
            self._write_research(connection, updated)
            return updated

    def fail_research(self, trip_id: str, run_id: str, code: str = "RESEARCH_FAILED") -> ResearchRun:
        with self._connection(write=True) as connection:
            value = self._read_research(connection, trip_id, run_id)
            if value.status in {"queued", "running"}:
                value.status, value.error = "failed", code
                self._write_research(connection, value)
            return value

    def cancel_research(self, trip_id: str, run_id: str) -> ResearchRun:
        with self._connection(write=True) as connection:
            self._read(connection, trip_id)
            value = self._read_research(connection, trip_id, run_id)
            if value.status == "cancelled":
                return value
            if value.status not in {"queued", "running"}:
                raise DomainError(409, "RESEARCH_RESOLVED", "此研究已结束，无需取消。")
            value.status = "cancelled"
            self._write_research(connection, value)
            return value

    def recover_interrupted(self) -> int:
        """Called once on service startup, never on ordinary Repository reads."""
        with self._connection(write=True) as connection:
            rows = connection.execute("SELECT run FROM research_runs WHERE status IN ('queued','running')").fetchall()
            for row in rows:
                value = ResearchRun.model_validate_json(row["run"])
                value.status, value.error = "failed", "SERVICE_RESTARTED"
                self._write_research(connection, value)
            connection.execute("UPDATE portfolio_requests SET status='failed' WHERE operation='plan' AND status='pending'")
            return len(rows)

    def research_proposal(self, trip_id: str, run_id: str, request: ResearchAdopt) -> Proposal:
        request = ResearchAdopt.model_validate(request.model_dump())
        with self._connection(write=True) as connection:
            snapshot = self._read(connection, trip_id)
            value = self._read_research(connection, trip_id, run_id)
            if value.status not in {"completed", "partial"} or value.result is None:
                raise DomainError(409, "RESEARCH_NOT_READY", "研究尚未完成或没有可采纳结果。")
            if connection.execute("SELECT 1 FROM research_adoptions WHERE run_id=? AND candidate_index=?",
                                  (run_id, request.candidateIndex)).fetchone():
                raise DomainError(409, "CANDIDATE_ALREADY_ADOPTED", "此研究候选已采纳，不能再次添加。")
            if value.contextHash != context_hash(snapshot):
                raise DomainError(409, "RESEARCH_STALE", "旅行内容已经变化，请重新研究后采纳。")
            result = ResearchResult.model_validate(value.result)
            if request.candidateIndex >= len(result.candidates):
                raise DomainError(422, "CANDIDATE_NOT_FOUND", "研究结果中没有这个候选。")
            candidate = result.candidates[request.candidateIndex]
            refs = list(dict.fromkeys(r for claim in candidate.claims for r in claim.evidenceRefs))
            if candidate.placeEvidenceRef and candidate.placeEvidenceRef not in refs:
                refs.append(candidate.placeEvidenceRef)
            evidence = {e.id: e for e in (Evidence.model_validate(e) for e in value.evidence)}
            place = evidence[candidate.placeEvidenceRef].place if candidate.placeEvidenceRef else None
            description = candidate.rationale
            if candidate.tradeoffs:
                description += "\n取舍：" + "；".join(candidate.tradeoffs)
            source_ref = f"research:{run_id}:{request.candidateIndex}"
            if request.target == "idea":
                action = AddIdea(type="addIdea", idea=IdeaInput(title=candidate.title, description=description[:4000],
                    place=place, sourceKind="agent", evidence=[source_ref, *refs][:20]))
            else:
                day = request.date or candidate.proposedDate
                if day is None:
                    raise DomainError(422, "DATE_REQUIRED", "加入日程前请选择日期。")
                require_date(snapshot, day)
                action = AddActivity(type="addActivity", activity=ActivityInput(title=candidate.title, date=day,
                    place=place, notes=(source_ref + "\n" + description)[:4000]))
            pending = connection.execute("SELECT proposal FROM proposals WHERE research_run_id=? AND candidate_index=? AND status='proposed'",
                                         (run_id, request.candidateIndex)).fetchone()
            if pending:
                previous = Proposal.model_validate_json(pending["proposal"])
                if previous.actions == [action]:
                    return previous
                raise DomainError(409, "CANDIDATE_PROPOSAL_EXISTS", "此候选已有待确认方案，请先确认或忽略原方案。")
            draft = ProposalDraft(kind="research", title=f"采纳：{candidate.title}"[:200], summary=description[:4000],
                actions=[action], assumptions=["研究候选不代表真实预约；确认后才写入工作区。"], evidenceRefs=refs[:40])
            self._validate_actions(snapshot, draft)
            proposal = Proposal(**draft.model_dump(), id=identifier(), tripId=trip_id, contextHash=value.contextHash,
                                createdAt=now(), traceUrl=value.traceUrl, researchRunId=run_id, candidateIndex=request.candidateIndex)
            self._store_proposal(connection, proposal)
            return proposal
