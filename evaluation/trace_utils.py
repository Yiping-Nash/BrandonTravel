"""Pure recursive trace verification; failure messages never contain trace payloads."""
import json
from collections.abc import Iterable


def verify_trace_tree(root, secrets: Iterable[str], trace_url: str) -> dict:
    nodes = []

    def visit(run):
        nodes.append(run)
        for child in run.child_runs or []:
            visit(child)

    visit(root)
    serialized = json.dumps([run.model_dump(mode="json") for run in nodes])
    if any(secret and secret in serialized for secret in secrets):
        raise AssertionError("Trace secret redaction check failed")
    if any(run.inputs for run in nodes):
        raise AssertionError("Trace contains unhidden input payloads")
    if any(run.outputs for run in nodes):
        raise AssertionError("Trace contains unhidden output payloads")
    if not any(run.run_type == "llm" for run in nodes) or not any(run.run_type == "tool" for run in nodes):
        raise AssertionError("Trace missing model/tool descendants")
    return {
        "traceUrl": trace_url,
        "runCount": len(nodes),
        "secretScanPassed": True,
        "inputsHidden": True,
        "outputsHidden": True,
        "steps": [{"name": run.name, "type": run.run_type, "failed": bool(run.error)} for run in nodes],
    }
