# Portfolio integration review — 2026-10-26

Independent context, separate from implementation. Scope: `main.py`, Portfolio/map routes and domain seams, App/PortfolioTools/DayWorkspace/DayMap/ProposalDiffPanel, shared contracts and repository confirmation/lifecycle behavior. This is code and offline integration review, not human recommendation-quality acceptance.

## Findings (severity order)

1. **P2 — confirmation succeeds but refresh failure presents it as unconfirmed. Resolved and independently verified.** Originally `apps/web/src/ProposalDiffPanel.tsx:8`: after `command()` succeeded, `await onChanged()` could reject without being caught. The parent Proposal list retained status `proposed`, so the UI continued saying “尚未改写日程” and offered confirmation again even though canonical state was written. Reproduced with real Chrome against fully mocked API responses: successful command returned version 2 and an added Idea, then proposal-list GET returned 503. Browser received an uncaught `Simulated list failure`, and the confirmation button remained visible. Fix now records resolution through `onResolved` before reloading and catches refresh failure separately. **Same probe after fix: `confirmed=true`, `errors=[]`, `pendingButtonStillVisible=false`; UI says “已确认并保存” and “已保存，记录刷新失败。正式行程已更新，可稍后刷新查看。”** Repro: `data/portfolio/review-confirm.mjs` (no paid calls, no persisted product data).

No P0/P1 findings identified in this review scope. No formatting/style recommendations block delivery.

Final review state: no unresolved P0/P1/P2 findings identified in scope after the above repair.

## Evidence and limits

- `python -m pytest tests/workspace tests/test_http.py tests/test_contract.py -q`: **74 passed in 5.41 s**.
- Post-fix focused map regression: `python -m pytest tests/workspace/test_day_context.py -q`: **3 passed in 2.40 s**. Additional mocked provider-error probe deliberately embedded a dummy secret in an HTTP exception; API returned HTTP 502 `MAP_UNAVAILABLE`, with no dummy key in response body or headers.
- Visually inspected the real browser screenshot `data/portfolio/browser/shanxi-1792996873621/05-day-timeline-map-chat.png`: Day timeline, Chat, map, location list and explicit unknown-time/location checks are visible together. The map carries AMap attribution; no browser key is shown. This visual inspection does not independently establish provider data accuracy or recommendation quality.
- Reviewed trip-keyed component lifetime and navigation guards, immutable captured research snapshot, stale/duplicate/cross-Trip confirmation rejection, cancellation winning over late results, restart recovery, optional dates, hidden server map keys, and explicit straight-line fallback without invented travel durations.
- Map and route tests mock the provider; they do not prove live route quality. Live model/browser product acceptance remains the integration lead's separate evidence.
- Current strict context-hash policy makes remaining candidates stale after adopting one candidate from the same run. This follows the frozen contract; it is a product limitation to explain, not silently relax during review.

## Focused follow-up: shared distance facts and invalid tool JSON

Read-only review of the later `day_context.py` / `maps.py` / Main `_rules` changes found no new blocking issue. Known places separated by an unlocated activity now retain a clearly labelled incomplete straight-line relationship, without a travel-duration claim. The map route adapter skips provider route enrichment across that unknown stop. Main receives the same pure `dayContext` object and is instructed to cite these values instead of estimating coordinates mentally. Prompt instructions alone are not evidence that every future model answer will comply.

Independent offline probe: two known coordinates with one unknown intermediate stop produced **66,717 m**, `durationMinutes=null`, explicit incomplete-route text, **zero provider calls**, and byte-equivalent JSON between Main's rule summary and `summarize_day`. This verifies the deterministic source, not any new paid-model answer.

Also inspected the narrow malformed structured-tool JSON failure path: official parsed `invalid_tool_calls` are rejected after usage accounting, diagnostics omit raw arguments, and the child cannot continue to parent selection with an invalid result. No custom repair/parser loop was introduced.

Focused rerun: `python -m pytest tests/workspace/test_day_context.py evaluation/test_agent.py evaluation/test_research_runtime.py evaluation/test_portfolio_agent.py -q` — **100 passed in 6.14 s**, no paid provider/model calls. Review remains closed with no unresolved P0/P1/P2 findings identified in this narrow follow-up.

## Final contract follow-up: production place binding

Reviewed the additive Pydantic `ProductionCandidate` / `ProductionResearchResult` definitions and their `response_schema` propagation through official `ToolStrategy`, child result capture and direct/delegated validation. Production candidates require a non-null, non-blank `placeEvidenceRef`; R1's default schema remains nullable, and an empty `no_results` response remains valid. Observed-evidence/place validation is retained after schema validation. The implementation does not fill missing IDs or increase the one-repair limit.

Minimal independent rerun: `python -m pytest evaluation/test_portfolio_agent.py -k 'production_schema or production_place or repair' -q` — **7 passed, 45 deselected in 2.56 s**. Covers missing/null/empty references, successful official repair, repeated-invalid failure, R1 compatibility and no-results validity. No paid calls; no new findings. Final review remains closed.
