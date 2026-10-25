from contextlib import contextmanager
from pathlib import Path
import sqlite3
from uuid import uuid4

from packages.contracts import ChatResponse, ChatSession, Command, Suggestion, SuggestionDraft, Trip, TripCreate, TripSnapshot
from apps.api.domain.commands import apply_command, identifier, now, require_date, require_text
from apps.api.domain.errors import DomainError


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
        require_text(value.destination, "目的地")
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
