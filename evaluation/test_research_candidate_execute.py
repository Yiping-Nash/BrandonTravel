"""Independent offline integration checks for candidate execution and accounting."""
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from evaluation import research_cli
from evaluation.research_budget import BudgetLedger
from evaluation.research_fixtures import build_brief
from evaluation.research_models import metadata


@pytest.mark.parametrize("profile,provider", [("qwen-flash", "openai"), ("deepseek-flash", "deepseek")])
@pytest.mark.parametrize("complete_usage", [True, False])
def test_candidate_execute_preserves_live_metadata_and_settles_or_holds_reservation(
    tmp_path, monkeypatch, profile, provider, complete_usage,
):
    import asyncio
    import evaluation.research_models as models

    model = object()
    construct = Mock(return_value=model)
    monkeypatch.setattr(models, "build_candidate", construct)
    root = SimpleNamespace(trace_id="offline-root", end=Mock())
    monkeypatch.setattr(research_cli, "trace", lambda *a, **k: nullcontext(root))
    monkeypatch.setattr(research_cli, "tracing_context", lambda *a, **k: nullcontext())
    monkeypatch.setattr(research_cli, "save_record", Mock())
    monkeypatch.setattr(research_cli, "git_revision", lambda: "offline-revision")
    monkeypatch.setattr(research_cli, "versions", lambda: {"test": "offline"})
    monkeypatch.setattr(research_cli.asyncio, "sleep", AsyncMock())
    client = SimpleNamespace(flush=Mock(), read_run=Mock(return_value=object()),
                             get_run_url=Mock(return_value="https://example.org/offline-trace"))
    ledger = BudgetLedger(tmp_path / "candidate.sqlite3")
    observed = {}

    async def fake_research(brief, architecture, **kwargs):
        observed.update(kwargs)
        # Reservation must already exist before any potential provider invocation.
        assert ledger.totals()["cnyConservativeBudgetCharge"] == 35
        return {"architecture": architecture, "status": "Pass", "modelRequests": 2,
                "usageRequests": 2 if complete_usage else 1,
                "inputTokens": 1000, "outputTokens": 100,
                "llmMode": "live", "toolMode": "fixture",
                "sourceCounts": {"credits": 0, "amap": 0}}

    monkeypatch.setattr(research_cli, "run_research", fake_research)
    record = asyncio.run(research_cli.execute(build_brief("shanghai_seniors", 1), "B", client,
        ledger, replay=True, batch="model-compatibility", candidate=profile))

    construct.assert_called_once_with(profile)
    assert observed == {"replay": True, "model": model, "model_is_live": True,
                        "max_input_bytes": 40000, "profile_provider": provider}
    assert record["llmMode"] == "live" and record["toolMode"] == "fixture"
    assert record["candidate"]["name"] == profile
    assert record["pilotCashReservationCny"] == 35 and record["traceVerified"] is True
    assert record["humanReview"] == "Pending"
    assert record["knownUsageCostCny"] is None and record["modelListPriceEstimateCny"] is None
    rates = metadata(profile)
    known = (1000 * rates["inputCnyPerMillion"] + 100 * rates["outputCnyPerMillion"]) / 1_000_000
    assert record["conservativeKnownUsageCostCny"] == pytest.approx(known)
    assert record["costCompleteness"] == ("complete_usage" if complete_usage else "partial_usage_lower_bound")
    expected_charge = round(known + .4, 4) if complete_usage else 35
    assert ledger.totals()["cnyConservativeBudgetCharge"] == pytest.approx(expected_charge)
    assert ledger.totals()["traceSlotsReserved"] == 4
