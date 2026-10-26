"""Official LangSmith Dataset/Experiments flow; deterministic scores, human Pending."""
import asyncio
import hashlib
import json
from uuid import uuid4

from evaluation.research_fixtures import scenarios
from apps.api.agent.research_contracts import ResearchBrief


def deterministic_checks(record):
    counts = record.get("sourceCounts", {})
    events = record.get("sourceEvents", [])
    tool_names = record.get("toolCalls", [])
    research = record.get("mode") == "research"
    checked_web = any(e.get("tool") == "web_search" and e.get("status") == "OK" and e.get("results", 0) > 0 for e in events)
    return {
        "structured_references_valid": record.get("status") == "Pass",
        "state_unchanged": record.get("noWorkspaceWrites") is True and record.get("contextUnchanged") is True,
        "model_budget": 0 < record.get("modelRequests", 0) <= 12,
        "source_budget": counts.get("amap", 0) <= 3 and counts.get("web", 0) <= 4 and counts.get("extract", 0) <= 5 and counts.get("credits", 0) <= 6,
        "snapshot_read": "get_trip_snapshot" in tool_names,
        "trace_verified": record.get("traceVerified") is True,
        "research_has_web_evidence": not research or checked_web,
        "research_has_candidate": not research or bool(record.get("result", {}).get("candidates")),
        "human_confirmation_boundary": not any(t in tool_names for t in ("adoptSuggestion", "addActivity", "addIdea")),
    }


def deterministic_evaluator(inputs, outputs):
    checks = deterministic_checks(outputs)
    return {"key": "deterministic_pass", "score": int(all(checks.values())),
            "comment": json.dumps({"checks": checks, "humanReview": "Pending", "qualityScore": None}, ensure_ascii=False)}


async def evaluate_dataset(client, ledger, architecture, *, replay=False):
    from evaluation.research_cli import execute, save_record
    from langsmith import tracing_context
    briefs = scenarios()
    serialized = [b.model_dump(mode="json") for b in briefs]
    fingerprint = hashlib.sha256(json.dumps(serialized, sort_keys=True).encode()).hexdigest()[:12]
    dataset_name = "BrandonTravel2-R1-" + fingerprint
    exists = await asyncio.to_thread(client.has_dataset, dataset_name=dataset_name)
    if exists:
        ds = await asyncio.to_thread(client.read_dataset, dataset_name=dataset_name)
    else:
        ds = await asyncio.to_thread(client.create_dataset, dataset_name=dataset_name,
            description="18 synthetic Trip tasks; fixed dated snapshot. Deterministic checks automatic; human quality Pending.")
        await asyncio.to_thread(client.create_examples, dataset_id=ds.id,
            inputs=[{"brief": b} for b in serialized], outputs=[{"humanReview": "Pending", "mustNotWriteTrip": True} for _ in briefs])
    examples = await asyncio.to_thread(lambda: list(client.list_examples(dataset_id=ds.id)))
    if len(examples) != 18:
        raise RuntimeError("DATASET_INCOMPLETE")
    expected=sorted(json.dumps({"brief":b},sort_keys=True,ensure_ascii=False) for b in serialized)
    actual=sorted(json.dumps(e.inputs,sort_keys=True,ensure_ascii=False) for e in examples)
    if actual!=expected: raise RuntimeError("DATASET_CONTENT_CHANGED")
    completed = []

    async def target(inputs):
        brief = ResearchBrief.model_validate(inputs["brief"])
        record = await execute(brief, architecture, client, ledger, replay=replay, batch="evaluation")
        record["deterministicChecks"] = deterministic_checks(record)
        record["scenarioPass"] = all(record["deterministicChecks"].values())
        record["datasetId"] = str(ds.id)
        save_record(record)
        completed.append(record)
        return record

    # aevaluate creates target roots BEFORE target() can reserve its task budget.
    # Reserve all54 roots plus2 orchestration slots before invoking the official runner.
    ledger.reserve_evaluation_traces(str(uuid4()),56)
    with tracing_context(enabled=True, client=client):
        result = await client.aevaluate(target, data=examples, evaluators=[deterministic_evaluator],
            experiment_prefix=f"Brandon-R1-{architecture}-{'replay' if replay else 'live'}", max_concurrency=2,
            num_repetitions=3, disable_evaluator_tracing=True,
            metadata={"synthetic": True,"architecture": architecture,"dataset_fingerprint": fingerprint,"human_review":"Pending"})
    # SDK completes outer target roots after target returns; verify again now before reporting.
    await asyncio.to_thread(client.flush, timeout=5)
    experiment_name = getattr(result, "experiment_name", None)
    for record in completed:
        record["experimentName"] = experiment_name
        save_record(record)
    return completed
