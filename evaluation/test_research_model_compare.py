import asyncio
import pytest
from evaluation.research_budget import BudgetLedger
from evaluation.research_model_compare import shared_failure, failure_categories
from evaluation.research_cli import scrub


def test_shared_protocol_error_stops_expansion_even_after_recovery():
    rows=[{"candidate":{"name":name},"status":"Pass","toolErrors":["read_pages"]}
          for name in ["qwen-flash","deepseek-flash"]]
    assert shared_failure(rows)==["tool_protocol"]


def test_trace_network_failure_is_not_model_protocol_failure():
    assert failure_categories({"status":"Pass","traceVerified":False})==[]
    assert failure_categories({"status":"Fail","providerHttpStatus":400})==["api_compatibility_or_access"]


def test_model_profiles_have_separate_conservative_budget_settlement(tmp_path):
    ledger=BudgetLedger(tmp_path/'pilot.sqlite3')
    ledger.reserve('pilot',cny=35)
    ledger.settle('pilot',{'modelRequests':12,'usageRequests':12,'inputTokens':12*90_000,
        'outputTokens':12*5000,'sourceCounts':{'credits':0,'amap':3}},input_rate=25,output_rate=100)
    assert ledger.totals()['cnyConservativeBudgetCharge']==pytest.approx(33.43)
    assert ledger.totals()['cnyConservativeBudgetCharge']<35


@pytest.mark.parametrize('value',[0,-1,float('inf'),float('nan'),101])
def test_invalid_pilot_reservations_are_rejected(tmp_path,value):
    ledger=BudgetLedger(tmp_path/'pilot.sqlite3')
    with pytest.raises(ValueError):ledger.reserve('bad',cny=value)
    assert ledger.totals()['tasksReserved']==0


def test_new_provider_secrets_are_scrubbed(monkeypatch):
    monkeypatch.setenv('DEEPSEEK_API_KEY','fixture-deepseek-secret')
    monkeypatch.setenv('ANTHROPIC_API_KEY','fixture-anthropic-secret')
    assert scrub({'message':'fixture-deepseek-secret fixture-anthropic-secret'})=={'message':'[redacted] [redacted]'}


def test_claude_toolstrategy_mismatch_blocks_before_client_or_budget_use():
    from evaluation.research_cli import execute
    from evaluation.research_models import CandidateConfigurationError
    with pytest.raises(CandidateConfigurationError,match='CLAUDE_TOOLSTRATEGY_UNSUPPORTED'):
        asyncio.run(execute(None,'B',None,None,candidate='claude-reference'))
