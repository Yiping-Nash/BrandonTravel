"""Canonical wire models. Datetimes in activities are trip-local ISO minutes."""
from datetime import date as Date, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")

class Place(Model):
    provider: str = "amap"
    providerId: str | None = None
    name: str = Field(min_length=1, max_length=200)
    address: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

class TripCreate(Model):
    title: str = Field(default="新的旅行", min_length=1, max_length=200)
    destination: str = Field(default="", max_length=200)
    startDate: Date | None = None
    endDate: Date | None = None
    companions: str = Field(default="", max_length=500)
    timezone: str = "Asia/Shanghai"
    preferences: str = Field(default="", max_length=4000)

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value):
        try: ZoneInfo(value)
        except Exception: raise ValueError("Unknown IANA timezone")
        return value

    @model_validator(mode="after")
    def date_range(self):
        if self.startDate and self.endDate and not 0 <= (self.endDate - self.startDate).days <= 60:
            raise ValueError("Trip must last 1–61 days")
        return self

class Trip(TripCreate):
    id: str
    createdAt: str
    updatedAt: str

class IdeaInput(Model):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    place: Place | None = None
    sourceKind: Literal["manual", "poi", "agent"] = "manual"
    evidence: list[str] = Field(default_factory=list, max_length=20)

class Idea(IdeaInput):
    id: str
    tripId: str
    createdAt: str
    updatedAt: str

class ActivityInput(Model):
    title: str = Field(min_length=1, max_length=200)
    date: Date
    startAt: str | None = None
    endAt: str | None = None
    place: Place | None = None
    ideaId: str | None = None
    notes: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def times(self):
        if (self.startAt is None) != (self.endAt is None):
            raise ValueError("startAt and endAt must both be null or present")
        if self.startAt is not None:
            try:
                start, end = datetime.fromisoformat(self.startAt), datetime.fromisoformat(self.endAt)
            except ValueError: raise ValueError("Invalid activity datetime")
            if any(t.tzinfo or t.second or t.microsecond or t.date() != self.date for t in (start, end)):
                raise ValueError("Use trip-local ISO minutes on the activity date; no cross-day events")
            if start >= end: raise ValueError("endAt must be after startAt")
            self.startAt, self.endAt = start.isoformat(timespec="minutes"), end.isoformat(timespec="minutes")
        return self

class Activity(ActivityInput):
    id: str
    tripId: str
    sortKey: int = Field(ge=0)
    createdAt: str
    updatedAt: str

class SuggestionDraft(Model):
    kind: Literal["idea", "activity"] = "idea"
    title: str = Field(min_length=1, max_length=200)
    rationale: str = Field(min_length=1, max_length=4000)
    proposedDate: Date | None = None
    place: Place | None = None
    evidenceRefs: list[str] = Field(default_factory=list, max_length=20)

class Suggestion(SuggestionDraft):
    id: str
    tripId: str
    status: Literal["proposed", "accepted", "dismissed"] = "proposed"

class TripSnapshot(Model):
    version: int = Field(ge=1)
    trip: Trip
    ideas: list[Idea] = Field(default_factory=list)
    activities: list[Activity] = Field(default_factory=list)
    suggestions: list[Suggestion] = Field(default_factory=list)

class AddIdea(Model):
    type: Literal["addIdea"]
    idea: IdeaInput
class DeleteIdea(Model):
    type: Literal["deleteIdea"]
    ideaId: str
class AddActivity(Model):
    type: Literal["addActivity"]
    activity: ActivityInput
class UpdateActivity(Model):
    type: Literal["updateActivity"]
    activityId: str
    activity: ActivityInput
class RemoveActivity(Model):
    type: Literal["removeActivity"]
    activityId: str
class MoveActivity(Model):
    type: Literal["moveActivity"]
    activityId: str
    date: Date
    index: int = Field(ge=0)
class AdoptIdea(Model):
    type: Literal["adoptIdea"]
    ideaId: str
    date: Date
class AdoptSuggestion(Model):
    type: Literal["adoptSuggestion"]
    suggestionId: str
    target: Literal["idea", "activity"]
    date: Date | None = None
class DismissSuggestion(Model):
    type: Literal["dismissSuggestion"]
    suggestionId: str
class SetPreferences(Model):
    type: Literal["setPreferences"]
    preferences: str = Field(max_length=4000)

class UpdateTrip(Model):
    type: Literal["updateTrip"]
    trip: TripCreate

class ConfirmProposal(Model):
    type: Literal["confirmProposal"]
    proposalId: str

class DismissProposal(Model):
    type: Literal["dismissProposal"]
    proposalId: str

CommandBody = Annotated[AddIdea | DeleteIdea | AddActivity | UpdateActivity | RemoveActivity | MoveActivity | AdoptIdea | AdoptSuggestion | DismissSuggestion | SetPreferences | UpdateTrip | ConfirmProposal | DismissProposal, Field(discriminator="type")]
class Command(Model):
    expectedVersion: int = Field(ge=1)
    command: CommandBody

# Proposals are persisted beside a Trip, not a second authoritative itinerary.
ProposalAction = Annotated[AddIdea | AddActivity | UpdateActivity | RemoveActivity, Field(discriminator="type")]

class ProposalDraft(Model):
    kind: Literal["blueprint", "day", "changes", "research"]
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=4000)
    actions: list[ProposalAction] = Field(min_length=1, max_length=40)
    assumptions: list[str] = Field(default_factory=list, max_length=20)
    evidenceRefs: list[str] = Field(default_factory=list, max_length=40)

class Proposal(ProposalDraft):
    id: str
    tripId: str
    contextHash: str
    status: Literal["proposed", "accepted", "dismissed"] = "proposed"
    createdAt: str
    traceUrl: str | None = None
    researchRunId: str | None = None
    candidateIndex: int | None = None

class PlanRequest(Model):
    kind: Literal["blueprint", "day", "changes"] = "blueprint"
    message: str = Field(default="请根据当前旅行与偏好提出结构化安排", min_length=1, max_length=8000)
    date: Date | None = None
    requestId: str = Field(min_length=1, max_length=160)

class PlanGeneration(Model):
    proposal: ProposalDraft
    traceUrl: str | None = None
    toolCalls: list[str] = Field(default_factory=list)

class ResearchStart(Model):
    question: str = Field(min_length=1, max_length=8000)
    requestId: str = Field(min_length=1, max_length=160)

class ResearchAdopt(Model):
    candidateIndex: int = Field(ge=0)
    target: Literal["idea", "activity"]
    date: Date | None = None

class SuggestionPreview(Model):
    target: Literal["idea", "activity"]
    date: Date | None = None

class ResearchRun(Model):
    id: str
    tripId: str
    question: str
    contextHash: str
    status: Literal["queued", "running", "completed", "partial", "failed", "cancelled"]
    createdAt: str
    updatedAt: str
    # Validated by the existing typed R1 ResearchResult/Evidence before persistence.
    result: dict | None = None
    evidence: list[dict] = Field(default_factory=list)
    traceUrl: str | None = None
    error: str | None = None
    toolCalls: list[str] = Field(default_factory=list)

class DayCheck(Model):
    code: str
    severity: Literal["info", "warning"]
    message: str
    activityIds: list[str] = Field(default_factory=list)

class DayRoute(Model):
    fromActivityId: str
    toActivityId: str
    distanceMeters: float | None = None
    durationMinutes: float | None = None
    source: Literal["amap", "straight_line"]
    mapUrl: str | None = None
    note: str

class DayContext(Model):
    date: Date
    checks: list[DayCheck]
    routes: list[DayRoute]

class ChatRequest(Model):
    message: str = Field(min_length=1, max_length=8000)
    sessionId: str | None = None
    mode: Literal["real", "demo"] = "real"

    @field_validator("message", mode="before")
    @classmethod
    def trim_message(cls, value):
        return value.strip() if isinstance(value, str) else value

class AgentOutput(Model):
    reply: str = Field(min_length=1, max_length=16000)
    suggestions: list[SuggestionDraft] = Field(default_factory=list, max_length=8)
    uncertainty: list[str] = Field(default_factory=list, max_length=20)

class ChatResponse(Model):
    sessionId: str
    reply: str
    suggestions: list[Suggestion]
    uncertainty: list[str]
    mode: Literal["real", "demo"]
    snapshotVersion: int
    traceUrl: str | None = None
    toolCalls: list[str] = Field(default_factory=list)

class ChatMessage(Model):
    role: Literal["user", "assistant"]
    content: str
    createdAt: str
    response: ChatResponse | None = None

class ChatSession(Model):
    id: str
    tripId: str
    title: str
    messages: list[ChatMessage] = Field(default_factory=list)

class ApiError(Model):
    code: str
    message: str
    details: list | dict | None = None
