from dataclasses import asdict, dataclass, field
import pytest
from evaluation.trace_utils import verify_trace_tree


@dataclass
class Run:
    name: str = "run"
    run_type: str = "chain"
    inputs: dict = field(default_factory=dict)
    outputs: dict = field(default_factory=dict)
    error: str | None = None
    child_runs: list = field(default_factory=list)

    def model_dump(self, **_kwargs):
        return asdict(self)


def tree():
    tool = Run(name="search_places", run_type="tool")
    model = Run(name="ChatOpenAI", run_type="llm")
    return Run(child_runs=[Run(child_runs=[model, tool])]), tool


def test_recurses_through_grandchildren():
    root, _ = tree()
    report = verify_trace_tree(root, [], "https://example.test/trace")
    assert report["runCount"] == 4
    assert {step["type"] for step in report["steps"]} == {"chain", "llm", "tool"}


@pytest.mark.parametrize("payload_field", ["inputs", "outputs"])
def test_private_grandchild_payload_fails_verification(payload_field):
    root, grandchild = tree()
    setattr(grandchild, payload_field, {"text": "private-trip-note"})
    with pytest.raises(AssertionError, match="unhidden") as exc:
        verify_trace_tree(root, [], "https://example.test/trace")
    assert "private-trip-note" not in str(exc.value)


def test_secret_in_grandchild_error_fails_without_disclosure():
    root, grandchild = tree()
    grandchild.error = "request contained unit-test-secret"
    with pytest.raises(AssertionError, match="secret redaction") as exc:
        verify_trace_tree(root, ["unit-test-secret"], "https://example.test/trace")
    assert "unit-test-secret" not in str(exc.value)


def test_missing_model_or_tool_steps_fails():
    with pytest.raises(AssertionError, match="missing model/tool"):
        verify_trace_tree(Run(), [], "https://example.test/trace")
