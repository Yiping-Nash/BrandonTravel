# Iteration 2 — approved execution plan

Approved 2026-10-26. R1 precedes R2. The three final corrections override earlier architecture preferences: A/B/C are selected from evidence (A is allowed); AI quality scores are not human review; human review remains Pending until the author reviews it. Begin with a bounded public API compatibility check; never patch framework internals.

## R1 — Agent Research Spike

1. Audit installed Deep Agents 0.7.32, LangChain, LangGraph and LangSmith against Academy M1–M6 and current official API. Record source/version/license and executable checks. Read the whole local course, including M1/M2/M6; distinguish inspected, executed and blocked examples.
2. Freeze ResearchBrief, Evidence, ResearchResult and candidate contracts outside canonical Trip State. Source adapters assign evidence IDs. Agent may propose, never write confirmed itinerary.
3. Build an independent CLI using real Qwen3.8-Flash, AMap and verified web search. A uses one official Deep Agent; B uses Main -> official task -> one Research Subagent; C adds Skills and ephemeral Filesystem. No custom agent loop, shell, RAG, queue or microservices.
4. Use seven rebuildable independent Trip fixtures: six business evaluation Trips (Shanxi architecture, Hangzhou family, Chengdu food, Beijing culture, Shanghai seniors, Xi'an nine days) plus the existing dense Shanghai regression. Preserve the original four persona fixtures.
5. L0 deterministic contracts/permissions/state/budgets; L1 fake-model framework components; L2 six live smoke tasks; A/B/C six complex scenarios x three architectures x two repetitions = 36; L3 18 distinct scenarios x three repetitions = 54. Do not expand batches merely to spend quota. Record Pass/Fail/Blocked/Not Run, including unsuccessful attempts.
6. Use LangSmith Dataset/Examples/Experiments/aevaluate and deterministic evaluators. Keep real external tools separate from recorded tools and fault injection. Compare quality, reliability, token use, latency and cost under equal total budgets. AI assessment is explicitly AI-assisted; produce representative evidence and comparisons for the author, human status Pending.
7. Technical gate: previous baseline and new deterministic checks pass; >=51/54 scenario passes and >=2/3 for each; zero unauthorized writes, cross-Trip access, forged evidence or tool boundary bypass; local records and verified traces. Human quality gate is separately Pending until reviewed (target mean >=4/5, each Trip >=3.5/5). Architecture choice is independent: choose A if evidence supports it; no requirement for B/C to win. No automatic R2 while human acceptance is pending.
8. Deliver CLI demo, trace URLs, test/audit reports, A/B/C review pack and learning materials. Independent Agent code review, fix high-priority findings and retest.

## R2 — Product integration (after R1 acceptance)

Reuse the selected R1 implementation. Persist ResearchRun/Result/Evidence linked to Trip/session without replacing canonical Workspace state. Extend chat with status, sources and existing suggestion adoption; preserve Board/Day/Week. Add queued/running/completed/partial/failed/cancelled states, context-hash staleness, request idempotency, cancellation and atomic adoption validation. One active task per Trip; manual edits remain allowed. Refresh restores records; restart fails unfinished runs (no durable continuation). Independent Workspace and final integration reviews, real browser tests/screenshots and existing regression gates.

## Budget and dependencies

R1 external API cap RMB100; model name stays configured Qwen3.8-Flash. Full iteration LangSmith cap 1,000 new unique traces including evaluators/retries (R1 reserve600, R2 reserve250, contingency150). These are caps, not targets. Preflight credentials and reserve budget before a batch; record estimated versus provider-confirmed costs separately. Feedback may cause extended retention billing. Do not auto-purchase or deploy managed infrastructure. Default live concurrency2; task180s; <=12 total model attempts; one research delegation; AMap3, search4, at most5 extracted pages, <=6 Tavily credits/task. Retry transient provider errors at most once inside counted budgets; do not silently rerun failed tasks.

Sources: AMap POI is not experience data; official pages for dated rules; Tavily search/extract pending key validation; Xiaohongshu is optional, no unverified scraping/login bypass. Unknown facts must stay unknown. Evidence existence does not prove semantic support.

Author supplied Tavily key and allocated 1,000 Tavily credits on 2026-10-26. Track this separately from 1,000 LangSmith traces; both are ceilings. Do not treat either allocation as a consumption target.

User-approved model compatibility supplement: keep the accepted application on Qwen3.8-Flash; compare Qwen3.7-Plus, DeepSeek Flash/Pro and optional Claude Sonnet5.5 through official LangChain adapters. Begin with a small fixed-Trip/tool/schema/budget pilot. Distinguish model output, adapter/API compatibility and network faults. If Qwen and DeepSeek share a failure, inspect application definitions and Deep Agents configuration before adding models or retries. Claude is not invoked while the installed ToolStrategy's forced-tool mode conflicts with its documented API. This supplement does not authorize automatic expansion to full experiments or change the R1 gates.

## Learning and review ownership

Maintain docs/agent-learning/{course-mapping,architecture,code-walkthrough,experiments,decisions,evaluation-guide}.md using actual code, commands, outputs and traces. Codex implements, checks, organizes evidence and labels AI assessment. Author supplies keys, reviews recommendations and evidence, runs representative delegation/permissions/staleness experiments and explains architecture choices. Human scoring and acceptance cannot be fabricated by Codex.
