"""R1 contracts: read-only research, separate from canonical Workspace state."""
import hashlib
import json
from datetime import date, datetime, timezone
from typing import Literal

from pydantic import Field, model_validator

from packages.contracts import Model, Place, TripSnapshot


def context_hash(snapshot: TripSnapshot) -> str:
    data = snapshot.model_dump(mode="json", exclude={"suggestions", "version"})
    for item in [data["trip"], *data["ideas"], *data["activities"]]:
        item.pop("createdAt", None)
        item.pop("updatedAt", None)
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


class ResearchBrief(Model):
    snapshot: TripSnapshot
    question: str = Field(min_length=1, max_length=8000)
    taskId: str = Field(min_length=1, max_length=160)
    mode: Literal["direct", "research"] = "research"
    contextHash: str

    @model_validator(mode="after")
    def validate_snapshot(self):
        if self.contextHash != context_hash(self.snapshot):
            raise ValueError("Snapshot hash mismatch")
        if any(x.tripId != self.snapshot.trip.id for x in [*self.snapshot.ideas, *self.snapshot.activities, *self.snapshot.suggestions]):
            raise ValueError("Cross-trip context")
        return self


class Evidence(Model):
    id: str
    sourceType: Literal["snapshot", "poi", "web"]
    url: str | None = None
    providerId: str | None = None
    title: str
    publisher: str | None = None
    retrievedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    publishedAt: str | None = None
    excerpt: str = Field(max_length=6000)
    contentHash: str
    sourceContentHash: str | None = Field(default=None, description="Hash of exact provider text before excerpt truncation, not an independent full-page verification.")
    excerptTruncated: bool = False
    verification: Literal["snapshot", "provider", "search_excerpt", "page_extract"]
    place: Place | None = None
    commercialStatus: Literal["unknown", "declared"] = "unknown"


class Claim(Model):
    text: str = Field(min_length=1, max_length=1600)
    kind: Literal["fact", "experience", "inference"]
    evidenceRefs: list[str] = Field(default_factory=list, max_length=12)


class Candidate(Model):
    title: str = Field(min_length=1, max_length=200)
    rationale: str = Field(min_length=1, max_length=2000)
    preferenceMatches: list[str] = Field(default_factory=list, max_length=8)
    tradeoffs: list[str] = Field(default_factory=list, max_length=8)
    claims: list[Claim] = Field(min_length=1, max_length=12)
    proposedDate: date | None = Field(default=None, description="Exactly one ISO YYYY-MM-DD date within the Trip, or null. Never prose or alternative dates.")
    placeEvidenceRef: str | None = None


class ResearchResult(Model):
    summary: str = Field(min_length=1, max_length=6000)
    candidates: list[Candidate] = Field(default_factory=list, max_length=6)
    claims: list[Claim] = Field(default_factory=list, max_length=16)
    limitations: list[str] = Field(default_factory=list, max_length=16)
    coverage: list[str] = Field(default_factory=list, max_length=8)
    status: Literal["complete", "partial", "no_results"]


def validate_result(result: ResearchResult, evidence: list[Evidence], brief: ResearchBrief) -> None:
    """Validate references and scope, not semantic truth (a separate review)."""
    refs = {e.id: e for e in evidence}
    if len(refs) != len(evidence):
        raise ValueError("Duplicate evidence IDs")
    for c in [*result.claims, *(c for item in result.candidates for c in item.claims)]:
        if any(ref not in refs for ref in c.evidenceRefs):
            raise ValueError("Unobserved evidence reference")
        if c.kind in {"fact", "experience"} and not c.evidenceRefs:
            raise ValueError("Factual/experience claim without evidence")
        if c.kind == "experience" and all(refs[r].sourceType != "web" for r in c.evidenceRefs):
            raise ValueError("POI/snapshot is not experience evidence")
    for item in result.candidates:
        if item.proposedDate:
            day = item.proposedDate
            if brief.snapshot.trip.startDate is None or brief.snapshot.trip.endDate is None:
                raise ValueError("Candidate date requires known trip dates")
            if not brief.snapshot.trip.startDate <= day <= brief.snapshot.trip.endDate:
                raise ValueError("Candidate date outside trip")
        if item.placeEvidenceRef and (item.placeEvidenceRef not in refs or refs[item.placeEvidenceRef].place is None):
            raise ValueError("Unobserved place")
    if result.status == "no_results" and result.candidates:
        raise ValueError("No-results response cannot contain candidates")
