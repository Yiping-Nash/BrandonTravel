"""Read saved smoke trace and emit nonsecret structure/redaction evidence."""
import json
import os
from pathlib import Path
from dotenv import load_dotenv
from apps.api.agent.service import _trace_client
from evaluation.trace_utils import verify_trace_tree

def main():
    load_dotenv()
    result=json.loads(Path("evaluation/real-smoke-result.json").read_text(encoding="utf-8"))
    run_id=result["traceUrl"].split("/r/")[1].split("?")[0]
    client=_trace_client()
    root=client.read_run(run_id,load_child_runs=True)
    keys=[os.getenv(k,"") for k in ("DASHSCOPE_API_KEY","AMAP_WEB_SERVICE_KEY","LANGSMITH_API_KEY")]
    report=verify_trace_tree(root, keys, result["traceUrl"])
    Path("evaluation/trace-verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=="__main__": main()
