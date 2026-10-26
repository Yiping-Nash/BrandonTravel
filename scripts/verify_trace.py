"""Read back the complete LangSmith tree; never print credentials or payloads."""
import json
import os
import re
from pathlib import Path
from dotenv import load_dotenv
from langsmith import Client

load_dotenv(Path(__file__).resolve().parents[1]/'.env')
source=Path('evaluation/real-smoke-result.json')
evidence=json.loads(source.read_text(encoding='utf-8'))
run_id=re.search(r'/r/([^?]+)',evidence['traceUrl']).group(1)
client=Client()
root=client.read_run(run_id,load_child_runs=True)
nodes=[]
def visit(run):
    nodes.append(run)
    for child in run.child_runs or []: visit(child)
visit(root)
serialized='\n'.join(x.model_dump_json() if hasattr(x,'model_dump_json') else x.json() for x in nodes)
secrets=[os.getenv(k,'') for k in ['DASHSCOPE_API_KEY','AMAP_WEB_SERVICE_KEY','LANGSMITH_API_KEY']]
assert not any(secret and secret in serialized for secret in secrets),'Secret redaction check failed'
summary={
    'traceUrl':evidence['traceUrl'],
    'runCount':len(nodes),
    'modelRuns':[{'name':x.name,'type':x.run_type} for x in nodes if x.run_type=='llm'],
    'toolRuns':[{'name':x.name,'type':x.run_type} for x in nodes if x.run_type=='tool'],
    'noSecretsFound':True,
    'allInputsHidden':all(not x.inputs for x in nodes),
    'allOutputsHidden':all(not x.outputs for x in nodes),
}
assert summary['modelRuns'] and summary['toolRuns'],'Trace missing model/tool descendants'
Path('evaluation/trace-tree-verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
