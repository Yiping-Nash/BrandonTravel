"""Transactional local budget tests. All databases live under pytest tmp_path."""
import inspect
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from evaluation.research_budget import BudgetLedger


def known_record(**changes):
    return {"usageRequests": 1, "modelRequests": 1, "inputTokens": 1000, "outputTokens": 100,
            "sourceCounts": {"credits": 2, "amap": 1}, **changes}


def test_initial_reservation_and_known_settlement_are_conservative(tmp_path):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3")
    ledger.reserve("run-1")
    assert ledger.totals() == {
        "traceSlotsReserved": 4, "tavilyCreditsUpperBound": 6, "cnyConservativeBudgetCharge": 4,
        "tasksReserved": 1, "note": "Reservations/upper bounds, not provider invoices or actual trace counts."}
    ledger.settle("run-1", known_record())
    after = ledger.totals()
    assert after["traceSlotsReserved"] == 4
    assert after["tavilyCreditsUpperBound"] == 2
    # Upper-bound pricing includes trace/tool provision; it is not an invoice.
    assert after["cnyConservativeBudgetCharge"] == pytest.approx(.4115, abs=.0001)


@pytest.mark.parametrize("record", [{}, {"modelRequests": 2, "usageRequests": 1, "inputTokens": 100}])
def test_missing_or_partial_usage_keeps_full_money_reservation(tmp_path, record):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3")
    ledger.reserve("unknown")
    ledger.settle("unknown", record)
    assert ledger.totals()["cnyConservativeBudgetCharge"] == 4


def test_unknown_usage_preserves_legacy_reservation_instead_of_repricing_it(tmp_path):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3")
    with ledger.connect() as db:
        db.execute("INSERT INTO reservations VALUES ('legacy',4,6,15,0)")
    ledger.settle("legacy", {})
    assert ledger.totals()["cnyConservativeBudgetCharge"] == 15


def test_bounded_worst_case_usage_fits_four_yuan_reservation(tmp_path):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3")
    ledger.reserve("bounded-worst-case")
    # 12 requests * (150K bounded bytes + 50K framework allowance), conservatively
    # one token per byte; 12 * 5K output. Pricing assumptions are not an invoice.
    record = known_record(usageRequests=12, modelRequests=12, inputTokens=2_400_000,
        outputTokens=60_000, sourceCounts={"credits": 6, "amap": 3})
    ledger.settle("bounded-worst-case", record)
    assert ledger.totals()["cnyConservativeBudgetCharge"] == pytest.approx(3.28)
    assert ledger.totals()["cnyConservativeBudgetCharge"] < 4
    assert ledger.totals()["tavilyCreditsUpperBound"] == 6


def test_allocated_free_tavily_credits_do_not_add_cash_charge(tmp_path):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3")
    ledger.reserve("zero-credits")
    ledger.settle("zero-credits", known_record(sourceCounts={"credits": 0, "amap": 1}))
    first = ledger.totals()["cnyConservativeBudgetCharge"]
    ledger.reserve("six-credits")
    ledger.settle("six-credits", known_record(sourceCounts={"credits": 6, "amap": 1}))
    assert ledger.totals()["cnyConservativeBudgetCharge"] == pytest.approx(first * 2, abs=.0001)
    assert ledger.totals()["tavilyCreditsUpperBound"] == 6


def test_duplicate_ids_and_settlement_cannot_refund_twice(tmp_path):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3")
    ledger.reserve("unique")
    with pytest.raises(ValueError, match="Duplicate"):
        ledger.reserve("unique")
    with pytest.raises(ValueError, match="Missing"):
        ledger.settle("not-reserved", known_record())
    ledger.settle("unique", known_record())
    totals = ledger.totals()
    with pytest.raises(ValueError, match="already settled"):
        ledger.settle("unique", known_record(inputTokens=0, outputTokens=0))
    assert ledger.totals() == totals


@pytest.mark.parametrize("traces,credits,cny", [(997, 0, 0), (0, 995, 0), (0, 0, 97)])
def test_each_global_cap_rejects_before_creating_reservation(tmp_path, traces, credits, cny):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3")
    with ledger.connect() as db:
        db.execute("INSERT INTO reservations VALUES ('prior',?,?,?,1)", (traces, credits, cny))
    before = ledger.totals()
    with pytest.raises(RuntimeError, match="ITERATION_BUDGET_EXCEEDED"):
        ledger.reserve("would-exceed")
    assert ledger.totals() == before


def test_exact_global_cap_boundary_is_allowed(tmp_path):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3")
    with ledger.connect() as db:
        db.execute("INSERT INTO reservations VALUES ('prior',996,994,96,1)")
    ledger.reserve("last")
    assert ledger.totals()["traceSlotsReserved"] == 1000
    assert ledger.totals()["tavilyCreditsUpperBound"] == 1000
    assert ledger.totals()["cnyConservativeBudgetCharge"] == 100


def test_default_path_is_repository_absolute_not_cwd_dependent(tmp_path, monkeypatch):
    original_default = inspect.signature(BudgetLedger).parameters["path"].default
    monkeypatch.chdir(tmp_path)
    current_default = inspect.signature(BudgetLedger).parameters["path"].default
    assert current_default == original_default
    assert current_default.is_absolute()
    assert current_default == Path(__file__).resolve().parents[1] / "data/iteration2/budget.sqlite3"
    # Do not instantiate the default: tests must never touch the actual ledger.


@pytest.mark.parametrize("prior_cny,expected_reserved", [(0, 10), (76, 6)])
def test_reservations_are_atomic_across_concurrent_ledger_instances(tmp_path, prior_cny, expected_reserved):
    db_path = tmp_path / "concurrent.sqlite3"
    ledger = BudgetLedger(db_path)
    if prior_cny:
        with ledger.connect() as db:
            db.execute("INSERT INTO reservations VALUES ('prior',0,0,?,1)", (prior_cny,))
    start = threading.Barrier(10)

    def reserve(index):
        local = BudgetLedger(db_path)
        start.wait(timeout=10)
        try:
            local.reserve(f"run-{index}")
            return "reserved"
        except RuntimeError as error:
            assert str(error) == "ITERATION_BUDGET_EXCEEDED"
            return "limited"

    with ThreadPoolExecutor(max_workers=10) as pool:
        outcomes = list(pool.map(reserve, range(10)))
    assert outcomes.count("reserved") == expected_reserved
    assert outcomes.count("limited") == 10 - expected_reserved
    assert ledger.totals()["tasksReserved"] == expected_reserved + int(bool(prior_cny))
    assert ledger.totals()["cnyConservativeBudgetCharge"] == prior_cny + expected_reserved * 4


def test_concurrent_settlement_accepts_only_one_caller(tmp_path, monkeypatch):
    ledger = BudgetLedger(tmp_path / "settle.sqlite3")
    ledger.reserve("same")
    original_connect = ledger.connect
    read_barrier = threading.Barrier(2)

    class Cursor:
        def __init__(self, cursor, connection):
            self.cursor, self.connection = cursor, connection

        def fetchone(self):
            row = self.cursor.fetchone()
            # Deliberately interleave unprotected read-before-update. An explicit
            # write transaction already serializes callers, so needs no barrier.
            if not self.connection.in_transaction:
                read_barrier.wait(timeout=10)
            return row

    class Connection:
        def __init__(self): self.connection = original_connect()
        def __enter__(self): self.connection.__enter__(); return self
        def __exit__(self, *args): return self.connection.__exit__(*args)
        def execute(self, sql, *args):
            cursor = self.connection.execute(sql, *args)
            if sql.lstrip().startswith("SELECT settled"):
                return Cursor(cursor, self.connection)
            return cursor

    monkeypatch.setattr(ledger, "connect", Connection)

    def settle(_):
        try:
            ledger.settle("same", known_record())
            return "settled"
        except ValueError:
            return "rejected"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(settle, range(2)))
    assert sorted(outcomes) == ["rejected", "settled"]


def test_make_model_sets_underlying_sync_and_async_sdk_retries(monkeypatch):
    from apps.api.agent.service import _make_model
    monkeypatch.setenv("DASHSCOPE_API_KEY", "fixture-not-a-real-key")
    monkeypatch.setenv("AGENT_MODEL", "qwen3.8-flash")
    monkeypatch.setenv("AGENT_BASE_URL", "https://example.org/compatible/v1")
    model = _make_model(max_retries=0, max_tokens=3500)
    assert model.max_retries == 0 and model.max_tokens == 3500
    assert model.root_client.max_retries == 0
    assert model.root_async_client.max_retries == 0


@pytest.mark.parametrize("fail_inside_transaction", [False, True])
def test_connection_closes_after_success_or_body_error(tmp_path, fail_inside_transaction):
    ledger = BudgetLedger(tmp_path / "closed.sqlite3")
    connection = ledger.connect()
    try:
        with connection as db:
            db.execute("INSERT INTO reservations VALUES ('close-check',4,6,4,0)")
            if fail_inside_transaction:
                raise RuntimeError("fixture transaction failure")
    except RuntimeError as error:
        assert fail_inside_transaction and str(error) == "fixture transaction failure"

    # Keep the connection reference alive: garbage collection must not be needed.
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        connection.execute("SELECT 1")
    with ledger.connect() as check:
        count = check.execute("SELECT COUNT(*) FROM reservations WHERE id='close-check'").fetchone()[0]
        assert count == int(not fail_inside_transaction)
    # On Windows this also catches the original WinError32 handle leak.
    ledger.path.unlink()
    assert not ledger.path.exists()


def test_connection_closes_even_when_commit_itself_fails(tmp_path):
    ledger = BudgetLedger(tmp_path / "commit-error.sqlite3")
    connection = ledger.connect()
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
    connection.execute("CREATE TABLE child (parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)")
    with pytest.raises(sqlite3.IntegrityError):
        with connection as db:
            db.execute("INSERT INTO child VALUES (99)")
            # Deferred constraint fails in __exit__/COMMIT, not in INSERT.
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        connection.execute("SELECT 1")
    with ledger.connect() as check:
        assert check.execute("SELECT COUNT(*) FROM child").fetchone()[0] == 0
    ledger.path.unlink()
