# Independent code review checkpoints

## Workspace — completed

Scope: actual new `apps/api/domain/**`, `apps/api/db/**`, `apps/api/routes/**`, `tests/workspace/**` relative to baseline `1f584ad`.

Independent reviewer (separate context from implementer): **no actionable P1/P2 findings**. Validated CAS transactions, rollback, date/time/DST, ordering, confirmation gating, session scoping and route contracts. 19 tests passed; additional temporary-DB probes verified cross-trip rejection, exactly-one concurrent adoption, and persistence after reopening. No review edits.

Native `codex review` was attempted first. Direct network timed out; proxy retry reached the model but its Windows sandbox could not execute read commands (`helper_unknown_error: setup refresh had errors`). An unrestricted retry was blocked by automatic approval review and was not run. Isolated reviewer with individually scoped read/test commands completed the review instead.

## Agent — completed, P2 repaired

Independent scope: actual `apps/api/agent/**`, `evaluation/**`, shared contract as context. Separate reviewer from implementer.

| Severity | Original location | Finding / evidence | Resolution |
|---|---|---|---|
| P2 | evaluation/verify_trace.py:14 | Only root/direct children were checked. A grandchild containing private inputs passed the old gate; original evidence counted 2 nodes versus actual 41. | Recursive `evaluation/trace_utils.py` traversal now fails on any exposed descendant inputs/outputs or key. New regression cases pass; real 41-node trace verified. |

No P1 or additional concrete P2 issues in scoped Agent implementation. Tool access remains read-only and trip-scoped. Agent evaluation suite expanded from 11 to 20 tests including date semantics and trace ingestion retries.

## Final integration — completed, all three P2 repaired

Final independent review covered API/Frontend mapping, persistence, Agent confirmation, errors and secret boundaries.

| Severity | Original location | Finding / verification evidence | Resolution |
|---|---|---|---|
| P2 | apps/web/src/App.tsx:22–23 | Delayed snapshot GET vN could overwrite command vN+1; late command could reopen a departed Trip. | `acceptSnapshot` guards active trip/navigation generation + monotonic version. Two deterministic delayed-response Chrome regressions passed. Chat lifecycle also guards session selection. |
| P2 | apps/api/main.py:89–94 | Proposals and transcript were separate transactions. Message `60 spaces + hello` produced blank title and 422 after version/proposal persisted. | Normalize message and use `Repository.finalize_chat` transaction. Independent repro now leaves version1/proposals0/sessions0 on invalid session. New atomic-success/rollback tests passed. |
| P2 | apps/web/src/features/calendar/helpers.ts:140; contexts/dnd-context.tsx:8; dnd/resizable-event.tsx:7 | Browser New York DST shifted Shanghai 09:00 to 08:00 and shortened 01:00–04:00 to120 minutes. | Official `@date-fns/utc` civil-date carrier. Independent repro returns540 grid minutes/180 duration/12:00 dragged end. Real Chrome timezone regression passed. |

Independent re-review confirmed all three original findings resolved, with no residual P1/P2 in repaired paths. No formatting/style requests block delivery.
