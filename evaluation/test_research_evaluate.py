"""Deterministic score gates are not human recommendation-quality judgments."""
import json

import pytest

from evaluation.research_evaluate import deterministic_checks, deterministic_evaluator


def valid_record(mode="research"):
    return {"status": "Pass", "mode": mode, "noWorkspaceWrites": True, "contextUnchanged": True,
        "modelRequests": 4, "sourceCounts": {"amap": 1, "web": 1, "extract": 1, "credits": 2},
        "sourceEvents": [{"tool": "web_search", "status": "OK", "results": 2}],
        "toolCalls": ["get_trip_snapshot", "search_places", "web_search", "read_pages"],
        "traceVerified": True, "result": {"candidates": [{"title": "Fixture candidate"}]}}


def test_complete_direct_and_research_records_pass_deterministic_checks():
    assert all(deterministic_checks(valid_record()).values())
    direct = valid_record("direct")
    direct.update(sourceEvents=[], result={"candidates": []}, toolCalls=["get_trip_snapshot"])
    assert all(deterministic_checks(direct).values())


@pytest.mark.parametrize("value", [False, None, "true", 1])
def test_trace_must_be_verified_boolean_not_merely_present(value):
    record = valid_record()
    record.update(traceVerified=value, traceUrl="https://example.org/unverified")
    assert not deterministic_checks(record)["trace_verified"]


def test_missing_trace_does_not_pass():
    record = valid_record()
    record.pop("traceVerified")
    assert not deterministic_checks(record)["trace_verified"]


@pytest.mark.parametrize("events", [[], [{"tool": "web_search", "status": "ERROR", "results": 2}],
    [{"tool": "web_search", "status": "OK", "results": 0}], [{"tool": "search_places", "status": "OK", "results": 3}]])
def test_research_needs_successful_nonempty_web_lookup(events):
    record = valid_record()
    record["sourceEvents"] = events
    assert not deterministic_checks(record)["research_has_web_evidence"]


@pytest.mark.parametrize("result", [{}, {"candidates": []}])
def test_research_without_candidate_is_not_business_scenario_pass(result):
    record = valid_record()
    record["result"] = result
    assert not deterministic_checks(record)["research_has_candidate"]


@pytest.mark.parametrize("field,value,check", [("status", "Fail", "structured_references_valid"),
    ("noWorkspaceWrites", False, "state_unchanged"), ("contextUnchanged", False, "state_unchanged"),
    ("modelRequests", 0, "model_budget"), ("modelRequests", 13, "model_budget"),
    ("toolCalls", ["web_search"], "snapshot_read")])
def test_single_violations_fail_their_gate(field, value, check):
    record = valid_record()
    record[field] = value
    assert not deterministic_checks(record)[check]


@pytest.mark.parametrize("kind,excess", [("amap", 4), ("web", 5), ("extract", 6), ("credits", 7)])
def test_each_source_budget_is_enforced(kind, excess):
    record = valid_record()
    record["sourceCounts"][kind] = excess
    assert not deterministic_checks(record)["source_budget"]


@pytest.mark.parametrize("tool", ["adoptSuggestion", "addActivity", "addIdea"])
def test_write_tools_fail_confirmation_boundary(tool):
    record = valid_record()
    record["toolCalls"].append(tool)
    assert not deterministic_checks(record)["human_confirmation_boundary"]


def test_evaluator_reports_automatic_score_without_human_quality_claim():
    output = deterministic_evaluator({}, valid_record())
    assert output["key"] == "deterministic_pass" and output["score"] == 1
    comment = json.loads(output["comment"])
    assert comment["humanReview"] == "Pending" and comment["qualityScore"] is None
    failed = valid_record()
    failed["traceVerified"] = False
    assert deterministic_evaluator({}, failed)["score"] == 0
