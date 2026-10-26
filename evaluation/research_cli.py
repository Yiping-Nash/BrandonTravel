"""Reproducible R1 CLI. Only synthetic fixtures; never connects to Workspace DB."""
import argparse
import asyncio
import importlib.metadata
import hashlib
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import requests
from urllib3.util.retry import Retry
from dotenv import load_dotenv
from langsmith import Client, trace, tracing_context

from apps.api.agent.research import run_research
from apps.api.agent.research_contracts import ResearchBrief
from evaluation.research_budget import BudgetLedger
from evaluation.research_fixtures import ALL_TRIP_KEYS, TRIP_KEYS, build_brief, scenarios

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "evaluation" / "r1-results"
SOURCE_FINGERPRINT = hashlib.sha256(b"".join(p.read_bytes() for p in sorted([
    *ROOT.glob("apps/api/agent/*.py"), *ROOT.glob("evaluation/research*.py"), ROOT / "pyproject.toml"]))).hexdigest()


def scrub(value):
    secrets = [os.getenv(k, "") for k in ("DASHSCOPE_API_KEY", "TAVILY_API_KEY", "AMAP_WEB_SERVICE_KEY", "LANGSMITH_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY")]
    if isinstance(value, dict):
        return {k: "[redacted]" if any(w in k.lower() for w in ("api_key", "authorization", "password")) or k == "error" else scrub(v) for k,v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        for s in secrets:
            if s: value = value.replace(s, "[redacted]")
    return value


def trace_client():
    session = requests.Session()
    session.trust_env = False
    proxy = os.getenv("RESEARCH_HTTPS_PROXY")
    if proxy:
        session.proxies.update({"http": proxy, "https": proxy})
    return Client(api_key=os.getenv("LANGSMITH_API_KEY"), api_url=os.getenv("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com"),
        workspace_id=os.getenv("LANGSMITH_WORKSPACE_ID") or None, session=session, timeout_ms=10000,
        retry_config=Retry(total=1,connect=1,read=1,backoff_factor=.2),
        hide_inputs=scrub, hide_outputs=scrub, hide_metadata=scrub, process_buffered_run_ops=scrub,
        run_ops_buffer_size=100, run_ops_buffer_timeout_ms=250, omit_traced_runtime_info=True)


def preflight(replay=False):
    required = ["DASHSCOPE_API_KEY", "LANGSMITH_API_KEY"]
    if not replay: required += ["AMAP_WEB_SERVICE_KEY", "TAVILY_API_KEY"]
    missing = [k for k in required if not os.getenv(k, "").strip()]
    if missing: raise RuntimeError("MISSING_CONFIG:" + ",".join(missing))
    if os.getenv("AGENT_MODEL", "qwen3.8-flash") != "qwen3.8-flash":
        raise RuntimeError("BUDGET_PRICE_MODEL_MISMATCH")


def versions():
    return {p: importlib.metadata.version(p) for p in ["deepagents", "langchain", "langgraph", "langsmith", "langchain-openai", "langchain-deepseek", "langchain-anthropic", "tavily-python"]}


def git_revision():
    return subprocess.check_output(["git", "-c", f"safe.directory={ROOT.as_posix()}", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def save_record(record):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / (record["runId"] + ".json")).write_text(json.dumps(scrub(record), ensure_ascii=False, indent=2), encoding="utf-8")


async def execute(brief, architecture, client, ledger, *, replay=False, batch="demo", candidate=None):
    wall_started=time.monotonic()
    candidate_info=None
    if candidate:
        from evaluation.research_models import build_candidate, metadata, CandidateConfigurationError
        if candidate=="claude-reference":
            # Installed LangChain ToolStrategy forces tool_choice=any, which
            # Sonnet5.5 rejects. Do not spend a request proving a documented400.
            raise CandidateConfigurationError("CLAUDE_TOOLSTRATEGY_UNSUPPORTED")
        candidate_info=metadata(candidate)
        candidate_model=build_candidate(candidate)
    run_id = str(uuid4())
    # Identical pilot caps for every candidate;35CNY covers the most expensive
    # reference at12*(90K*25/M+5K*100/M), including50KB framework allowance.
    ledger.reserve(run_id,cny=35 if candidate else 4)
    project = os.getenv("LANGSMITH_PROJECT", "BrandonTravel2") + "-R1"
    record = {"runId": run_id, "taskId": brief.taskId, "status": "Fail", "batch": batch}
    save_record(record)  # Persist the attempt before any model work; interrupted tasks remain visible.
    with tracing_context(enabled=True, client=client, project_name=project):
        with trace("R1 " + brief.taskId, run_id=run_id, client=client, inputs={"brief": brief.model_dump(mode="json")},
                   metadata={"synthetic": True, "architecture": architecture, "batch": batch, "task_id": brief.taskId,
                             "candidate":candidate or "qwen-baseline","tool_mode":"fixture" if replay else "live"}) as root:
            try:
                kwargs={"model":candidate_model,"model_is_live":True,"max_input_bytes":40_000,
                        "profile_provider":candidate_info["harnessProvider"]} if candidate else {}
                record.update(await run_research(brief, architecture, replay=replay, **kwargs))
                root.end(outputs=record)
            except Exception as exc:
                record.update(status="Fail", errorType=type(exc).__name__)
                root.end(outputs=record)
    record.update(createdAt=datetime.now(timezone.utc).isoformat(), brief=brief.model_dump(mode="json"), versions=versions(),
                  commit=git_revision(), sourceFingerprint=SOURCE_FINGERPRINT, traceId=str(root.trace_id), traceRunId=run_id, humanReview="Pending")
    # Conservative price estimate for Beijing, ignoring cache/free allowance; not an invoice.
    known_cost = round((record.get("inputTokens",0)*.8 + record.get("outputTokens",0)*2.7)/1_000_000,6)
    record["knownUsageCostCny"] = known_cost
    record["costCompleteness"] = "complete_usage" if record.get("usageRequests",0)==record.get("modelRequests",-1) else "partial_usage_lower_bound"
    record["modelListPriceEstimateCny"] = known_cost if record["costCompleteness"]=="complete_usage" else None
    record["priceBasis"] = "Qwen Beijing official list 2026-10-26; actual invoice/free/cache effects unverified"
    if candidate_info:
        record["candidate"]=candidate_info
        record["pilotCashReservationCny"]=35
        record["knownUsageCostCny"]=None
        record["modelListPriceEstimateCny"]=None
        record["conservativeKnownUsageCostCny"]=round((record.get("inputTokens",0)*candidate_info["inputCnyPerMillion"]+
            record.get("outputTokens",0)*candidate_info["outputCnyPerMillion"])/1_000_000,6)
        record["priceBasis"]="Candidate budget rates; conservative conversion/peak/cache-write ceiling, not invoice or comparable list-price estimate."
    record["traceVerified"] = False
    try:
        await asyncio.to_thread(client.flush, timeout=5)
        for delay in (0.5, 1.5, 3):
            await asyncio.sleep(delay)
            try:
                run = await asyncio.to_thread(client.read_run, run_id)
                record.update(traceVerified=True, traceUrl=await asyncio.to_thread(client.get_run_url, run=run))
                break
            except Exception:
                continue
    except Exception:
        pass
    if candidate_info:
        ledger.settle(run_id,record,input_rate=candidate_info["inputCnyPerMillion"],output_rate=candidate_info["outputCnyPerMillion"])
    else: ledger.settle(run_id, record)
    record["totalSeconds"]=round(time.monotonic()-wall_started,3)
    save_record(record)
    print(json.dumps({k: record.get(k) for k in ["runId","taskId","architecture","status","seconds","modelRequests","traceVerified","traceUrl","modelListPriceEstimateCny"]}, ensure_ascii=True), flush=True)
    return record


def summary():
    records = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(OUT.glob("*.json"))]
    from evaluation.research_evaluate import deterministic_checks
    cohorts = {}
    for r in records:
        key = "/".join(str(r.get(k,"unknown")) for k in ["batch","toolMode","llmMode","architecture","sourceFingerprint"])
        key += "/" + r.get("candidate",{}).get("name","qwen-baseline")
        cohort = cohorts.setdefault(key,{"tasks":0,"contractPass":0,"scenarioPass":0,"verifiedTraces":0})
        cohort["tasks"]+=1
        cohort["contractPass"]+=int(r.get("status")=="Pass")
        cohort["scenarioPass"]+=int(all(deterministic_checks(r).values()))
        cohort["verifiedTraces"]+=int(r.get("traceVerified",False))
    formal = [r for r in records if r.get("batch")=="evaluation" and r.get("toolMode")=="live" and r.get("llmMode")=="live"]
    experiments = {}
    for r in formal:
        key = str(r.get("experimentName") or "incomplete")
        experiments.setdefault(key,[]).append(r)
    gates = {}
    for name, rows in experiments.items():
        cases = {}
        for r in rows:
            c=cases.setdefault(r["taskId"],{"runs":0,"pass":0})
            c["runs"]+=1;c["pass"]+=int(all(deterministic_checks(r).values()))
        passed=sum(c["pass"] for c in cases.values())
        complete=len(rows)==54 and len(cases)==18 and all(c["runs"]==3 for c in cases.values())
        gates[name]={"tasks":len(rows),"scenarioPass":passed,"cases":cases,"complete18x3":complete,
                     "technicalGate":complete and passed>=51 and all(c["pass"]>=2 for c in cases.values()) and all(r.get("traceVerified") for r in rows),
                     "humanReview":"Pending","r2Acceptance":"Pending"}
    data = {"tasks": len(records), "status": {s: sum(r.get("status")==s for r in records) for s in ["Pass","Fail","Blocked","Not Run"]},
            "verifiedTraceCount": len({r.get("traceId") for r in records if r.get("traceVerified")}),
            "modelRequests": sum(r.get("modelRequests",0) for r in records),
            "knownUsageCostCny": round(sum(r.get("knownUsageCostCny",r.get("modelListPriceEstimateCny")) or 0 for r in records),6),
            "costCompleteness":"partial_usage_lower_bound" if any(r.get("usageRequests",0)!=r.get("modelRequests",-1) for r in records) else "complete_usage",
            "humanReview": "Pending", "cohorts":cohorts,"formalGates":gates,"budget": BudgetLedger().totals()}
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return data


async def reverify_traces(client):
    """Read-only eventual-ingestion recovery; never reruns the model or invents a URL."""
    await asyncio.to_thread(client.flush,timeout=5)
    updated=[]
    for path in sorted(OUT.glob("*.json")):
        record=json.loads(path.read_text(encoding="utf-8"))
        if record.get("traceVerified") or not record.get("traceRunId"): continue
        try:
            run=await asyncio.to_thread(client.read_run,record["traceRunId"])
            record.update(traceVerified=True,traceUrl=await asyncio.to_thread(client.get_run_url,run=run),
                          traceReverifiedAt=datetime.now(timezone.utc).isoformat())
            save_record(record);updated.append(record["runId"])
        except Exception: continue
    print(json.dumps({"reverifiedTraceRuns":updated},ensure_ascii=True))


async def main():
    load_dotenv(ROOT / ".env")
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("command",choices=["demo","smoke","compare","evaluate","summary","fixtures","verify-traces"])
    p.add_argument("--trip",choices=ALL_TRIP_KEYS,default="hangzhou")
    p.add_argument("--task",type=int,choices=[0,1,2],default=1)
    p.add_argument("--architecture",choices=["A","B","C"],default="B")
    p.add_argument("--replay",action="store_true",help="Real Qwen + fixed test tools, NOT live external-source validation")
    args=p.parse_args()
    if args.command=="summary": summary();return
    if args.command=="fixtures":
        print(json.dumps([b.model_dump(mode="json") for b in scenarios()],ensure_ascii=False,indent=2));return
    if args.command=="verify-traces":
        await reverify_traces(trace_client());summary();return
    preflight(args.replay)
    client=trace_client();ledger=BudgetLedger()
    if args.command=="demo": jobs=[(build_brief(args.trip,args.task),args.architecture)]
    elif args.command=="smoke": jobs=[(build_brief(k,0 if i<2 else 1),args.architecture) for i,k in enumerate(TRIP_KEYS)]
    elif args.command=="compare": jobs=[(build_brief(k,1),a) for repeat in range(2) for k in TRIP_KEYS for a in ["A","B","C"]]
    else:
        from evaluation.research_evaluate import evaluate_dataset
        await evaluate_dataset(client,ledger,args.architecture,replay=args.replay);await reverify_traces(client);summary();return
    # Two independent tasks at a time; stop an unhealthy batch instead of burning quota.
    batch_id=str(uuid4())
    manifest={"batchId":batch_id,"command":args.command,"planned":len(jobs),"completed":[],"notRun":[],"sourceFingerprint":SOURCE_FINGERPRINT}
    for start in range(0,len(jobs),2):
        results=await asyncio.gather(*(execute(b,a,client,ledger,replay=args.replay,batch=args.command) for b,a in jobs[start:start+2]),return_exceptions=True)
        failures=0
        for item in results:
            if isinstance(item,BaseException):
                failures+=1;manifest["completed"].append({"status":"Blocked","errorType":type(item).__name__})
            else:
                failures+=int(item.get("status")!="Pass")
                manifest["completed"].append({"runId":item["runId"],"status":item["status"]})
        if failures==len(results):
            manifest["notRun"]=[{"taskId":b.taskId,"architecture":a,"status":"Not Run","reason":"batch_circuit_breaker"} for b,a in jobs[start+2:]]
            break
    folder=OUT/"manifests";folder.mkdir(parents=True,exist_ok=True)
    (folder/(batch_id+".json")).write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    await reverify_traces(client)
    summary()


if __name__=="__main__":
    asyncio.run(main())
