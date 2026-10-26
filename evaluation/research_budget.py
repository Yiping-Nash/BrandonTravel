"""Local transactional reservation ledger; not an agent scheduler or harness."""
import sqlite3
import math
from pathlib import Path


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class BudgetLedger:
    def __init__(self, path=Path(__file__).resolve().parents[1] / "data/iteration2/budget.sqlite3"):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, traces INTEGER, credits INTEGER, cny REAL, settled INTEGER DEFAULT 0)")
            db.execute("CREATE TABLE IF NOT EXISTS trace_batches (id TEXT PRIMARY KEY, traces INTEGER)")

    def reserve_evaluation_traces(self, batch_id, count):
        if not isinstance(count,int) or count < 1: raise ValueError("Invalid trace reservation")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current=db.execute("SELECT COALESCE(SUM(traces),0) FROM reservations").fetchone()[0]
            current+=db.execute("SELECT COALESCE(SUM(traces),0) FROM trace_batches").fetchone()[0]
            if current+count>1000: raise RuntimeError("ITERATION_TRACE_BUDGET_EXCEEDED")
            db.execute("INSERT INTO trace_batches VALUES(?,?)",(batch_id,count))

    def connect(self):
        return sqlite3.connect(self.path, timeout=10, factory=ClosingConnection)

    def reserve(self, run_id, *, cny=4):
        if not isinstance(cny,(float,int)) or not math.isfinite(cny) or cny<=0 or cny>100:
            raise ValueError("Invalid cash reservation")
        # Runtime caps serialized input at150KB, plus50KB allowance for built-in middleware/schema.
        # <=12 x200K input tokens at1.1/M +12 x5K output at3.5/M + trace/POI reserve < RMB4.
        # UTF-8 byte count is conservative for the Qwen byte-level tokenizer. No media tools.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM reservations WHERE id=?", (run_id,)).fetchone():
                raise ValueError("Duplicate budget reservation")
            t, c, money = db.execute("SELECT COALESCE(SUM(traces),0),COALESCE(SUM(credits),0),COALESCE(SUM(cny),0) FROM reservations").fetchone()
            t += db.execute("SELECT COALESCE(SUM(traces),0) FROM trace_batches").fetchone()[0]
            if t + 4 > 1000 or c + 6 > 1000 or money + cny > 100:
                raise RuntimeError("ITERATION_BUDGET_EXCEEDED")
            db.execute("INSERT INTO reservations(id,traces,credits,cny) VALUES(?,4,6,?)", (run_id,cny))

    def settle(self, run_id, record, *, input_rate=1.1, output_rate=3.5):
        if any(not isinstance(rate,(int,float)) or not math.isfinite(rate) or rate<=0 for rate in (input_rate,output_rate)):
            raise ValueError("Invalid model budget rates")
        counts = record.get("sourceCounts", {})
        credits = counts.get("credits", 6)
        known = record.get("usageRequests", 0) == record.get("modelRequests", -1)
        money = None
        if known:
            money = (record.get("inputTokens", 0) * input_rate + record.get("outputTokens", 0) * output_rate) / 1_000_000
            # Author explicitly allocated 1,000 free Tavily credits; enforce credit cap separately.
            # Keep a conservative retention/POI reserve; no claim that it is an actual invoice.
            money += .4 + counts.get("amap", 3) * .01
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT settled,cny FROM reservations WHERE id=?", (run_id,)).fetchone()
            if row is None or row[0]:
                raise ValueError("Missing/already settled reservation")
            db.execute("UPDATE reservations SET credits=?,cny=?,settled=1 WHERE id=?", (credits, money if money is not None else row[1], run_id))

    def totals(self):
        with self.connect() as db:
            t,c,m,n = db.execute("SELECT COALESCE(SUM(traces),0),COALESCE(SUM(credits),0),COALESCE(SUM(cny),0),COUNT(*) FROM reservations").fetchone()
            t+=db.execute("SELECT COALESCE(SUM(traces),0) FROM trace_batches").fetchone()[0]
        return {"traceSlotsReserved": t, "tavilyCreditsUpperBound": c, "cnyConservativeBudgetCharge": round(m,4), "tasksReserved": n,
                "note": "Reservations/upper bounds, not provider invoices or actual trace counts."}
