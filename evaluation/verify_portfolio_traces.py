"""Read existing LangSmith runs, never invoke a model or print source payloads."""
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from evaluation.research_cli import trace_client


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    client = trace_client()
    chosen = sys.argv[1:] or [
        'bd90bfe8-0291-4328-87ef-ab664f35514a',  # UI blueprint
        '6940d27e-4b3f-452e-b709-c94997f9b32f',  # UI Research
        'ded248cf-480c-4e12-8730-3c6799416587',  # UI day change
        'b75c9b15-e95f-4137-baf1-25846e1c924b',  # independent Hangzhou Research
    ]
    secret_names = ('DASHSCOPE_API_KEY','DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','AMAP_WEB_SERVICE_KEY','TAVILY_API_KEY','LANGSMITH_API_KEY')
    secrets = [os.getenv(k) for k in secret_names if os.getenv(k)]
    records = []
    for run_id in chosen:
        try:
            root = client.read_run(run_id, load_child_runs=True)
            nodes = []
            def walk(node):
                nodes.append(node)
                for child in node.child_runs or []: walk(child)
            walk(root)
            serialized = '\n'.join(node.model_dump_json() for node in nodes)
            no_secrets = not any(s in serialized for s in secrets)
            models = [node.name for node in nodes if node.run_type == 'llm']
            tools = [node.name for node in nodes if node.run_type == 'tool']
            records.append({'runId': run_id, 'verified': bool(models and tools and no_secrets),
                'traceUrl': client.get_run_url(run=root), 'nodeCount':len(nodes), 'modelRuns':models,
                'toolRuns':tools, 'noSecretsFound':no_secrets,
                'latencySeconds':(root.end_time-root.start_time).total_seconds() if root.end_time else None})
        except Exception as exc:
            records.append({'runId':run_id, 'verified':False, 'errorType':type(exc).__name__})
    output = Path('evaluation/portfolio-trace-verification.json')
    previous = json.loads(output.read_text(encoding='utf-8')) if output.exists() else []
    combined = {r['runId']:r for r in [*previous,*records]}
    output.write_text(json.dumps(list(combined.values()),ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(records,ensure_ascii=False))


if __name__ == '__main__': main()
