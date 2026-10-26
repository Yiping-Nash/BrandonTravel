# Portfolio Workspace independent review — 2026-10-26

Reviewer: independent Codex frontend/learning context; not the Workspace implementation context. This is AI code review, not Product Owner acceptance. Scope: actual `apps/api/db/repository.py`, `apps/api/domain/commands.py`, `apps/api/routes/portfolio.py`, Workspace routes and their contract/test callers. No provider calls or secret reads. Review used source inspection and executable synthetic reproductions, not a claim of native hosted Review execution.

## Findings, highest severity first

**P2 — Fixed and independently rechecked: proposed candidate date caused a server error when no override was supplied.** Location: `apps/api/db/repository.py:577`, `research_proposal`. `ResearchResult.model_validate` produces `datetime.date` for `Candidate.proposedDate`; the prior fallback passed it to `date.fromisoformat`, which accepts a string. Reproduction: persist a valid synthetic candidate with `proposedDate="2026-11-03"`, then request `{candidateIndex:0,target:"activity"}` without `date`. Observed `TypeError: fromisoformat: argument must be str`; snapshot remained unchanged. The Workspace author changed the fallback to `request.date or candidate.proposedDate` and added parameterized coverage for the stored date and explicit user override. Independent rerun passed. This was an API edge-case failure; the current UI normally sends an explicit date.

No remaining P0/P1/P2 findings identified in this bounded review. This is not a guarantee against undiscovered defects.

## Evidence and retained boundaries

- `.venv/Scripts/python.exe -m pytest tests/workspace tests/test_http.py tests/test_contract.py -q`: **74 passed in 5.23s**, after the fix (72 passed before the two added regressions).
- Proposal generation validates detached captured snapshots. Pending proposals do not enter canonical Ideas/Activities. Confirm checks expected version, context hash, Trip scope and prior resolution; all actions, adoption marker and proposal status share one `BEGIN IMMEDIATE` transaction and one version increment. Existing tests inject a mid-batch failure and race two confirmations.
- Research freezes context before awaiting the Agent, permits independent manual edits, rejects stale adoption, validates stored R1 evidence references and builds adoption from server-side candidate data. Unknown/client-supplied candidate text is rejected by the public contract.
- Cancellation/restart win over late results; one active run per Trip and scoped idempotency are persisted. Failed provider details are sanitized. Explicit restart recovery is appropriate to the existing single-process local service; multi-worker coordination was not evaluated or introduced.
- Draft Trips preserve missing dates; Ideas remain writable. Date range edits cannot drop existing activities, and timezone changes revalidate wall times.
- Legacy chat suggestions now have a no-model proposal preview path; accepting the proposal marks the original suggestion accepted atomically and prevents duplicate adoption.

## Limits

Provider quality, real LangSmith trace verification, UI acceptance and live-map accuracy are outside this backend review. Human product review remains Pending. All review executions used synthetic data and made zero paid calls. Source semantics and deterministic regressions were reviewed; no style-only changes were requested.
