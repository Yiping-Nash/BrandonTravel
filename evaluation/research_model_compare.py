"""Small controlled compatibility pilot; official graph, real LLM, fixed tools.

This orchestrates test cases, not model/tool turns. Deep Agents owns all turns.
Run at most one task per requested profile; no automatic retries or expansion.
"""
import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from evaluation.research_cli import ROOT, SOURCE_FINGERPRINT, execute, trace_client
from evaluation.research_budget import BudgetLedger
from evaluation.research_fixtures import build_brief
from evaluation.research_models import PROFILE_NAMES


def failure_categories(record):
    categories=[]
    if record.get("schemaErrors") or record.get("errorType")=="StructuredOutputValidationError":
        categories.append("structured_output")
    if record.get("malformedToolCallCount") or record.get("deniedTools") or record.get("toolErrors"):
        categories.append("tool_protocol")
    if record.get("providerHttpStatus",0)>=400:
        categories.append("api_compatibility_or_access")
    if record.get("errorType") in {"APIConnectionError","APITimeoutError","OpenAITimeoutError","TimeoutError"}:
        categories.append("transport_or_timeout")
    if record.get("errorCode") in {"MODEL_BUDGET_EXCEEDED","MODEL_INPUT_BUDGET_EXCEEDED"}:
        categories.append("bounded_noncompletion_needs_diagnosis")
    if record.get("status")=="Fail" and not categories:
        categories.append("needs_diagnosis")
    return categories


def shared_failure(records):
    qwen=next((r for r in records if r.get("candidate",{}).get("name")=="qwen-flash"),None)
    deepseek=next((r for r in records if r.get("candidate",{}).get("name")=="deepseek-flash"),None)
    if qwen is None or deepseek is None: return []
    # Even recovered common protocol errors merit application inspection first.
    return sorted(set(failure_categories(qwen)) & set(failure_categories(deepseek)))


async def main():
    load_dotenv(ROOT/".env")
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles",nargs="+",choices=PROFILE_NAMES,
        default=["qwen-flash","deepseek-flash","qwen-plus","deepseek-pro"])
    args=parser.parse_args()
    if len(set(args.profiles))!=len(args.profiles): parser.error("One attempt per profile only")
    brief=build_brief("shanghai_seniors",1)
    folder=ROOT/"evaluation/r1-model-comparison";folder.mkdir(parents=True,exist_ok=True)
    manifest={"id":str(uuid4()),"createdAt":datetime.now(timezone.utc).isoformat(),
        "sourceFingerprint":SOURCE_FINGERPRINT,"architecture":"B","taskId":brief.taskId,
        "contextHash":brief.contextHash,"toolMode":"fixture","llmMode":"live",
        "limits":{"modelRequests":12,"maxOutputTokens":5000,"inputBytes":40000,"taskSeconds":180,"cashReservationCny":35},
        "planned":args.profiles,"completed":[],"notRun":[],"humanReview":"Pending",
        "note":"Compatibility isolation only; fixed non-real sources cannot pass real travel research acceptance."}
    path=folder/(manifest["id"]+".json")
    def save(): path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    save()
    client=trace_client();ledger=BudgetLedger();records=[]
    for index,profile in enumerate(args.profiles):
        try:
            record=await execute(brief.model_copy(deep=True),"B",client,ledger,replay=True,
                batch="model-compatibility",candidate=profile)
        except Exception as exc:
            safe_code=getattr(exc,"code",None)
            manifest["completed"].append({"profile":profile,"status":"Blocked","errorType":type(exc).__name__,"errorCode":safe_code})
            manifest["notRun"]=[{"profile":p,"reason":"configuration_or_budget_block"} for p in args.profiles[index+1:]]
            save();break
        records.append(record)
        manifest["completed"].append({"profile":profile,"runId":record["runId"],"status":record["status"],
            "categories":failure_categories(record)})
        common=shared_failure(records)
        if common:
            manifest["applicationReviewRequired"]=common
            manifest["notRun"]=[{"profile":p,"reason":"shared_failure_inspect_application_first"} for p in args.profiles[index+1:]]
            save();break
        save()
    await asyncio.to_thread(client.flush,timeout=5)
    print(json.dumps({"manifest":str(path),"completed":manifest["completed"],"notRun":manifest["notRun"]},ensure_ascii=True))


if __name__=="__main__": asyncio.run(main())
