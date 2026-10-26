"""Deterministic research boundary checks. No LLM, external API or human rating."""
from datetime import timedelta

import pytest
from pydantic import ValidationError

from apps.api.agent.research_contracts import (
    Candidate, Claim, Evidence, ResearchBrief, ResearchResult, context_hash, validate_result,
)
from evaluation.research_fixtures import ALL_TRIP_KEYS, TRIP_KEYS, build_brief, scenarios
from packages.contracts import Place, Suggestion
from scripts.persona_trips import PERSONAS


@pytest.fixture
def brief():
    return build_brief("hangzhou", 1)


def evidence(ref="e1", source="web", place=None):
    return Evidence(id=ref, sourceType=source, title="Fixed test evidence", excerpt="Fixture only",
        contentHash="fixture-hash", verification="provider" if source == "poi" else "search_excerpt",
        place=place)


def result(ref="e1", kind="fact", **candidate_fields):
    return ResearchResult(summary="Fixture result", status="complete", candidates=[Candidate(
        title="Candidate", rationale="Fixture rationale", claims=[Claim(text="Fixture claim", kind=kind,
        evidenceRefs=[ref] if ref else [])], **candidate_fields)])


def test_fixed_dataset_has_18_distinct_tasks_and_seven_isolated_trips():
    cases = scenarios()
    assert len(cases) == 18 and len({x.taskId for x in cases}) == 18
    assert len({x.snapshot.trip.id for x in cases}) == 6
    assert len({build_brief(k).snapshot.trip.id for k in ALL_TRIP_KEYS}) == 7
    assert sum(x.mode == "direct" for x in cases) == 6
    assert all(x.snapshot.activities and x.snapshot.ideas for x in cases)


@pytest.mark.parametrize("key", TRIP_KEYS)
def test_rebuild_is_deterministic_and_does_not_share_mutable_state(key):
    first, second = build_brief(key), build_brief(key)
    assert first.model_dump() == second.model_dump()
    first.snapshot.activities[0].title = "Changed in one test"
    assert second.snapshot.activities[0].title != first.snapshot.activities[0].title
    assert build_brief(key).model_dump() == second.model_dump()


@pytest.mark.parametrize("key,index", [("hangzhou", 0), ("shanghai_dense", 1), ("chengdu", 2), ("xian", 3)])
def test_original_persona_activity_coverage_is_preserved(key, index):
    brief = build_brief(key)
    source = PERSONAS[index]
    assert [a.title for a in brief.snapshot.activities] == [a[0] for day in source["dayspec"] for a in day]
    assert source["preferences"] in brief.snapshot.trip.preferences
    assert (brief.snapshot.trip.endDate - brief.snapshot.trip.startDate).days + 1 == source["days"]


@pytest.mark.parametrize("key", TRIP_KEYS)
def test_edited_variant_preserves_identity_and_represents_partial_adoption(key):
    before, after = build_brief(key, 1), build_brief(key, 2)
    assert before.snapshot.trip.id == after.snapshot.trip.id
    assert before.contextHash != after.contextHash
    assert before.snapshot.activities[0].id == after.snapshot.activities[0].id
    assert before.snapshot.activities[0].date + timedelta(days=1) == after.snapshot.activities[0].date
    assert after.snapshot.activities[-1].ideaId == after.snapshot.ideas[0].id
    assert len(after.snapshot.ideas) == len(before.snapshot.ideas)
    assert after.snapshot.version > before.snapshot.version


def test_base_date_rebuild_moves_every_activity_and_nine_day_horizon():
    old, new = build_brief("xian"), build_brief("xian", base_date="2027-01-11")
    delta = new.snapshot.trip.startDate - old.snapshot.trip.startDate
    assert all(a.date + delta == b.date for a, b in zip(old.snapshot.activities, new.snapshot.activities))
    assert (new.snapshot.trip.endDate - new.snapshot.trip.startDate).days == 8
    assert old.taskId != new.taskId


def test_hash_ignores_only_non_context_version_timestamps_and_suggestions(brief):
    changed = brief.snapshot.model_copy(deep=True)
    changed.version += 1
    for x in [changed.trip, *changed.activities, *changed.ideas]:
        x.createdAt = "2027-01-01T00:00:00Z"
        x.updatedAt = "2027-01-02T00:00:00Z"
    changed.suggestions.append(Suggestion(id="s1", tripId=changed.trip.id, title="A suggestion",
        rationale="Not adopted", evidenceRefs=[]))
    assert context_hash(changed) == brief.contextHash


@pytest.mark.parametrize("mutation", ["preference", "activity_title", "activity_date", "activity_order", "idea", "timezone"])
def test_context_changes_invalidate_hash(brief, mutation):
    changed = brief.snapshot.model_copy(deep=True)
    if mutation == "preference": changed.trip.preferences += " 不吃辣。"
    elif mutation == "activity_title": changed.activities[0].title += " Changed"
    elif mutation == "activity_date": changed.activities[0].date += timedelta(days=1)
    elif mutation == "activity_order": changed.activities[0].sortKey += 1
    elif mutation == "idea": changed.ideas[0].description += " New user constraint"
    elif mutation == "timezone": changed.trip.timezone = "Asia/Tokyo"
    assert context_hash(changed) != brief.contextHash
    with pytest.raises(ValidationError, match="hash mismatch"):
        ResearchBrief(**{**brief.model_dump(), "snapshot": changed})


@pytest.mark.parametrize("collection", ["activities", "ideas", "suggestions"])
def test_cross_trip_context_is_rejected_even_with_matching_hash(brief, collection):
    changed = brief.snapshot.model_copy(deep=True)
    if collection == "suggestions":
        changed.suggestions.append(Suggestion(id="other-s", tripId="other-trip", title="Other", rationale="Other"))
    else:
        getattr(changed, collection)[0].tripId = "other-trip"
    with pytest.raises(ValidationError, match="Cross-trip"):
        ResearchBrief(**{**brief.model_dump(), "snapshot": changed, "contextHash": context_hash(changed)})


def test_forged_evidence_reference_is_rejected(brief):
    with pytest.raises(ValueError, match="Unobserved evidence"):
        validate_result(result("invented"), [evidence()], brief)


def test_duplicate_evidence_ids_are_rejected(brief):
    with pytest.raises(ValueError, match="Duplicate evidence"):
        validate_result(result(), [evidence(), evidence()], brief)


@pytest.mark.parametrize("kind", ["fact", "experience"])
def test_evidence_required_for_factual_and_experience_claims(brief, kind):
    with pytest.raises(ValueError, match="without evidence"):
        validate_result(result(None, kind), [], brief)


@pytest.mark.parametrize("source", ["poi", "snapshot"])
def test_poi_or_snapshot_does_not_prove_experience(brief, source):
    with pytest.raises(ValueError, match="not experience evidence"):
        validate_result(result(kind="experience"), [evidence(source=source)], brief)


@pytest.mark.parametrize("proposed", ["2026-11-01", "2026-11-07", "not-a-date"])
def test_invalid_candidate_date_is_rejected(brief, proposed):
    with pytest.raises(ValueError):
        validate_result(result(proposedDate=proposed), [evidence()], brief)


def test_candidate_place_must_point_to_an_observed_place(brief):
    candidate = result(placeEvidenceRef="e1")
    with pytest.raises(ValueError, match="Unobserved place"):
        validate_result(candidate, [evidence()], brief)
    validate_result(candidate, [evidence(source="poi", place=Place(name="Fixture place", providerId="fixture-poi"))], brief)


def test_no_results_cannot_contradict_candidates(brief):
    response = result().model_copy(update={"status": "no_results"})
    with pytest.raises(ValueError, match="cannot contain candidates"):
        validate_result(response, [evidence()], brief)


def test_inference_can_be_explicitly_unsupported_but_not_passed_off_as_fact(brief):
    validate_result(result(None, "inference"), [], brief)


@pytest.mark.parametrize("key,index", [("unknown", 0), ("hangzhou", -1), ("hangzhou", 3), ("hangzhou", True)])
def test_invalid_fixture_selection_fails_before_any_run(key, index):
    with pytest.raises(ValueError):
        build_brief(key, index)
