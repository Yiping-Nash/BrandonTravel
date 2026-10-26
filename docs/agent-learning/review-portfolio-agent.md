# Portfolio Agent independent code review

Reviewed 2026-10-26 by the Workspace implementation context, which did not implement the Portfolio Agent. Scope: actual working-tree implementation in `apps/api/agent/portfolio.py`, `research.py`, `research_sources.py`, the diff in `places.py`, and the API/contracts integration boundary. This is an independent code review, not a paid-model evaluation or human recommendation-quality assessment.

## Findings, ordered by severity

### P2 — Empty provider content becomes apparently usable web evidence

Location at review time: `apps/api/agent/research_sources.py:135` and `:161`.

`str(r.get("content", ""))` accepts an empty search excerpt; `str(r.get("raw_content", ""))` turns a provider null into the literal text `None`. Both are stored as web Evidence. An official-host URL then meets the Portfolio source-type/host support check even though it contains no supporting content. Extraction also reports `OK` for this null body. This is a deterministic provenance defect, separate from the acknowledged limitation that reference validation cannot establish semantic truth.

Offline reproduction with an `AsyncMock` provider: search result `{url: "https://www.shanghai.gov.cn/empty", content: ""}` produces an evidence excerpt `''`; `validate_result` accepts a factual claim referencing it. Extract result for that observed URL with `raw_content: None` produces excerpt `'None'`. No external source or model calls were made.

Resolution: the Agent implementation owner rejected non-string and blank provider content before creating Evidence. Empty search results stay empty; missing extraction bodies now contribute to `failedCount` and `PARTIAL`. Added regression cases cover empty, whitespace, null, non-text and valid bodies, including content-hash fidelity after excerpt truncation. Independently re-read and retested the fix: **closed**. No Agent implementation file was edited by the reviewer.

## Verified boundaries

- Official `create_deep_agent`, `ToolStrategy`, public middleware and StateBackend own execution. Application middleware bounds the offered and executable tool capabilities, shared model requests, source calls, and input size. No custom model loop was introduced.
- Planning and research receive copied, bound Trip snapshots. Tool inputs do not accept an arbitrary Trip ID; neither module receives a Repository. Proposal actions are returned for a separate confirmation transaction.
- Proposed activity IDs, date range, selected-day scope, known place objects and evidence references are checked. Unknown Trip details stop planning before model invocation. Domain validation remains authoritative before persistence/confirmation.
- Research preserves the captured child structured result instead of asking the parent to reproduce evidence. Unobserved URLs cannot be extracted, and authoritative-host matching rejects suffix spoofing. Province POI searches filter returned administrative province instead of assuming a provincial capital.
- Shared SQLite budget reservations precede invocation; cancellation keeps conservative usage accounting. Model adapters disable SDK retries and validate official endpoints. Provider exceptions exposed to callers are safe codes/messages; trace processing uses the existing scrubber.
- The route layer handles cancellation/restart and stores separate pending records; stale or duplicate adoption remains a Workspace responsibility with regression coverage.

## Validation and limits

Executed offline:

```text
.venv\Scripts\python.exe -m pytest evaluation/test_portfolio_agent.py evaluation/test_research_runtime.py evaluation/test_research_budget.py evaluation/test_research_models.py tests/workspace/test_portfolio_routes.py -q
135 passed in 6.29s (after fix; initial review run: 130 passed in 6.21s)
```

No open actionable finding remains in this reviewed scope; the single P2 was fixed and independently verified. No P0/P1 issue was identified. This is not a guarantee of absence. Source excerpt relevance, recommendation quality, future opening/booking rules and live trace availability require separate real-demo evidence and human review; human quality review remains Pending. Existing passing mocks are not represented as production integrations.
