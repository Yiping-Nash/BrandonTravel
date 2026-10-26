import asyncio
from types import SimpleNamespace

import pytest

from evaluation.research_budget import BudgetLedger
from evaluation.research_evaluate import evaluate_dataset
from evaluation.research_fixtures import scenarios


class OfflineClient:
    def __init__(self, ledger, changed=False):
        self.ledger=ledger
        self.called=False
        self.examples=[SimpleNamespace(inputs={"brief":b.model_dump(mode="json")}) for b in scenarios()]
        if changed: self.examples[0].inputs["brief"]["question"]="A remote edit that changes evaluation semantics"
    def has_dataset(self, **kwargs): return True
    def read_dataset(self, **kwargs): return SimpleNamespace(id="fixture-dataset")
    def list_examples(self, **kwargs): return self.examples
    def flush(self, **kwargs): pass
    async def aevaluate(self, target, **kwargs):
        self.called=True
        assert self.ledger.totals()["traceSlotsReserved"] >= 56
        assert kwargs["num_repetitions"]==3 and len(kwargs["data"])==18
        assert kwargs["disable_evaluator_tracing"] is True
        return SimpleNamespace(experiment_name="offline-not-a-real-experiment")


def test_formal_trace_roots_reserved_before_official_runner(tmp_path):
    ledger=BudgetLedger(tmp_path/"budget.sqlite3")
    client=OfflineClient(ledger)
    assert asyncio.run(evaluate_dataset(client,ledger,"A"))==[]
    assert client.called
    assert ledger.totals()["traceSlotsReserved"]==56


def test_remote_dataset_edit_rejected_even_if_count_unchanged(tmp_path):
    ledger=BudgetLedger(tmp_path/"budget.sqlite3")
    client=OfflineClient(ledger,changed=True)
    with pytest.raises(RuntimeError,match="DATASET_CONTENT_CHANGED"):
        asyncio.run(evaluate_dataset(client,ledger,"A"))
    assert not client.called and ledger.totals()["traceSlotsReserved"]==0


def test_full_trace_quota_prevents_even_automatic_target_roots(tmp_path):
    ledger=BudgetLedger(tmp_path/"budget.sqlite3")
    ledger.reserve_evaluation_traces("previous",1000)
    client=OfflineClient(ledger)
    with pytest.raises(RuntimeError,match="TRACE_BUDGET"):
        asyncio.run(evaluate_dataset(client,ledger,"A"))
    assert not client.called


def test_task_reservation_includes_preallocated_evaluation_roots(tmp_path):
    ledger=BudgetLedger(tmp_path/"budget.sqlite3")
    ledger.reserve_evaluation_traces("previous",997)
    with pytest.raises(RuntimeError,match="ITERATION_BUDGET"):
        ledger.reserve("cannot-overbook")
