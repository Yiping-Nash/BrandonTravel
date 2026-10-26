"""Summarize local evidence without publishing full provider pages or credentials."""
import json
from collections import Counter
from pathlib import Path
import xml.etree.ElementTree as ET
from evaluation.research_budget import BudgetLedger

ROOT = Path(__file__).resolve().parents[1]


def main():
    runs = [json.loads(p.read_text(encoding='utf-8')) for p in sorted((ROOT/'data/portfolio-agent-runs').glob('*.json'))]
    browsers = []
    research_samples = []
    for path in sorted((ROOT/'data/portfolio/browser').glob('*/results.json')):
        value = json.loads(path.read_text(encoding='utf-8'))
        browsers.append({k:value[k] for k in ('scenario','kind','tripId','runId','status','failure','checks','errors','traceUrls','resume') if k in value} | {'artifact':str(path.relative_to(ROOT)).replace('\\','/')})
        run = value.get('run')
        if run and run.get('result'):
            research_samples.append({'tripId':value['tripId'], 'runId':run['id'], 'status':run['status'],
                'question':run['question'], 'result':run['result'], 'traceUrl':run['traceUrl'], 'humanReview':'Pending',
                # Keep URLs, verification and hashes; avoid republishing full source articles.
                'sources':[{k:e[k] for k in ('id','sourceType','title','url','publisher','retrievedAt','verification','contentHash','sourceContentHash','excerptTruncated') if k in e} for e in run['evidence']]})
    research_samples = list({r['runId']:r for r in research_samples}.values())
    traces = json.loads((ROOT/'evaluation/portfolio-trace-verification.json').read_text(encoding='utf-8'))
    suites = ET.parse(ROOT/'data/portfolio/pytest.xml').getroot().findall('testsuite')
    tests = {k:sum(int(s.get(k,'0')) for s in suites) for k in ('tests','failures','errors','skipped')}
    usage = {k:sum(r.get(k,0) for r in runs) for k in ('modelRequests','usageRequests','inputTokens','outputTokens')}
    usage['sources'] = dict(sum((Counter(r.get('sourceCounts',{})) for r in runs),Counter()))
    data = {'date':'2026-10-26','scope':'Portfolio implementation + targeted real user journeys; not a statistical model benchmark',
        'pythonRegression':tests,'build':{'passed':True,'minifiedJsKB':583.88,'warning':'One JS chunk exceeds500KB'},
        'preservedBrowserRegression':{'passed':6,'note':'Five initially passed; one async test waiting issue fixed and independently rerun passed. Chat recovery uses actual Qwen; navigation tests include controlled delay/fixture behavior.'},
        'liveModelUsage':usage,'sharedIterationBudget':BudgetLedger().totals(),
        'budgetNote':'Ledger numbers are conservative reservations/upper bounds, not invoices. Prior R1 unknown-usage holds remain. Legacy Qwen Chat browser checks are separate and retain their own Trace records.',
        'browserRuns':browsers,'agentRuns':runs,'traceVerification':traces,'researchSamples':research_samples,
        'humanRecommendationReview':'Pending','deferred':'36 architecture /54 formal evaluation batch; Xiaohongshu/community; production authentication/hosting'}
    (ROOT/'evaluation/portfolio-evidence.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'tests':tests,'browserRuns':len(browsers),'agentRuns':len(runs),'researchSamples':len(research_samples),'usage':usage,'budget':data['sharedIterationBudget']},ensure_ascii=False))


if __name__ == '__main__': main()
