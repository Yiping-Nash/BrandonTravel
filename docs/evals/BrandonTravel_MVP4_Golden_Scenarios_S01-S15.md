# BrandonTravel — MVP4 Golden Scenario Specifications (S01–S15)

**Status:** Baseline scenario specification / working agreement  
**Date:** 2026-10-11  
**Scope:** MVP3 stabilization + MVP4 Agent evaluation  
**Audience:** Product owner, Codex, evaluation harness implementers

## 0. How to use this document

This is the **missing source-of-truth scenario definition** referenced by the MVP3.5/MVP4 Collaborative Development Brief. Scenario IDs and intended user behaviors reproduce the 15 scenarios agreed in discussion; they are **not evidence of implemented features**. Do not invent alternate meanings for S01–S15.

For each scenario, Codex should (1) audit whether its domain operations and tooling already exist, (2) build a deterministic fixture and assertions, (3) verify graders against a known-correct reference outcome, (4) run the real Agent and shared Domain, and (5) fix the smallest observed gap. Scenario fixture IDs, specific itinerary dates, weather values, travel durations, and business hours below are **not production facts**; create explicitly synthetic reproducible test data, not unverifiable real-world assertions. Any scenario ambiguity about permission to commit should be captured as an explicit test policy rather than silently assumed.

**Scoring policy:** Assess actual canonical-state changes; a plausible response alone is insufficient. Infeasible requests may pass by accurately explaining and preserving state. A no-op does not pass an otherwise feasible, clearly authorized edit. Hard constraints, unauthorized deletion, invalid state mutations, false claims about facts or execution, and unacknowledged partial commits are blocking failures. Preserve multiple acceptable outcomes where explicitly stated. Do not weaken graders just to get green tests.

**Prerequisite contracts (verify rather than assume):** stable Trip/Activity identity; planned vs. unscheduled state; version/revision; shared mutation and validation; operational facts with freshness; test-isolated tool calls, fixtures and traces. Where contracts are missing, classify a Domain Gap. Keep MVP3 and MVP4 concurrent; do not turn this into a speculative schema refactor or full Evidence/Memory implementation.

## 1. Golden scenarios

### A. Basic schedule operations

#### S01 — Adjust a single Activity by natural language
- **Priority:** P0
- **User request:** “把第二天下午两点的山西博物院推迟到三点，参观时间仍然保持两小时。”
- **Setup:** A trip with a unique museum Activity on day two scheduled 14:00–16:00; other activities and constraints are recorded.
- **Required outcome:** Target Activity becomes 15:00–17:00 with stable ID and unchanged two-hour duration. Unrelated Activities remain unchanged. A newly introduced conflict must not be silently ignored or overwritten.
- **Assertions:** Target identity, start/end, duration, unchanged unrelated state, valid mutation / conflict handling.

#### S02 — Return an Activity to Unscheduled without deleting it
- **Priority:** P0
- **User request:** “周三不去晋祠了，先放回待安排区，之后再决定。”
- **Setup:** Wednesday contains a scheduled 晋祠 Activity with ID, notes and original date.
- **Required outcome:** Activity is removed from the scheduled time slot and added to Unscheduled; its ID, notes and original planned-date association are preserved. It must not be deleted.
- **Assertions:** No scheduled occurrence, exactly one unscheduled occurrence, preserved metadata and stable ID.

#### S03 — Shorten Trip dates without losing displaced activities
- **Priority:** P0
- **User request:** “原本玩五天，现在只玩三天。后两天的安排不要删除，帮我保留下来。”
- **Setup:** A five-day Trip with Activities across all days and distinguishable original-date groups.
- **Required outcome:** Trip becomes three days; displaced Activities from days four and five return to Unscheduled grouped by their original date and retain details. The remaining plan is revalidated.
- **Assertions:** New date boundaries, zero lost Activities, correct original-date grouping, preserved IDs/notes, validation run.

### B. Multi-step planning

#### S04 — Start tomorrow after 10 AM
- **Priority:** P0
- **User request:** “明天早上想睡懒觉，十点之后再开始活动，帮我调整一下。”
- **Setup:** Tomorrow has at least one Activity before 10:00, subsequent Activities, fixed synthetic opening hours and transition durations.
- **Required outcome:** A feasible replanning starts Activities after 10:00 while considering opening hours, travel and constraints; do not blindly shift every event or hide displaced Activities. If full accommodation is impossible, preserve remaining items and explain.
- **Assertions:** No pre-10:00 Activities in a committed successful plan, no unauthorized loss, fact/route checks, clear exceptions.

#### S05 — Insert an Activity into an existing afternoon
- **Priority:** P0
- **User request:** “第二天下午想去双塔寺，帮我看看能不能塞进去。”
- **Setup:** Existing day-two Activities, free/busy time, and controlled route/opening-hour data for the target.
- **Required outcome:** Assess feasibility using existing plan, visit duration and transitions. When feasible, offer a reasonable arrangement; when not, explain alternatives. **“帮我看看” is an inquiry, not unconditional permission to commit**: run this scenario in proposal-only mode unless later authorization is supplied.
- **Assertions:** Accurate feasibility judgment, no invented place details or hours, no unintended mutation during inquiry.

#### S06 — Lighten an over-packed day
- **Priority:** P1
- **User request:** “第二天安排得太赶了，帮我轻松一点。”
- **Setup:** Day two is packed with little travel buffer and several movable Activities.
- **Required outcome:** Identify realistic sources of pressure and propose/execute a materially more relaxed plan within authorization. Avoid achieving apparent improvement by indiscriminately deleting Activities; account for shifted/unscheduled items.
- **Assertions:** No unauthorized loss or hard-constraint violation; compare objective indicators (e.g., buffer, transitions, occupied time) and apply human/LLM rubric for subjective quality. Multiple solutions acceptable.

### C. Constraints and infeasibility

#### S07 — Protect a fixed evening show
- **Priority:** P0
- **User request:** “第二天的日程随便调整，但晚上七点的演出绝对不能动。”
- **Setup:** Evening show at 19:00, preceding Activities, controlled route times, and scope of permitted edits.
- **Required outcome:** Preserve show ID and time; preceding plans must allow timely arrival. Explain any unresolved travel conflict rather than pretending it is resolved.
- **Assertions:** Unchanged show identity/time; valid prior transition; no hidden hard-constraint violation or unauthorized deletion.

#### S08 — Reject or negotiate an impossible plan
- **Priority:** P0
- **User request:** “下午两点到四点既要参观两个相距很远的景点，又不能缩短参观时间。”
- **Setup:** Controlled route and visit-duration fixture proving the requirements cannot all be met.
- **Required outcome:** Detect infeasibility and articulate the conflicting constraints; offer alternatives or request which condition can change. Do not fake transport times, violate constraints, or commit an invalid plan.
- **Assertions:** State integrity, correct infeasibility, no fabricated facts, appropriate clarification/alternatives.

#### S09 — Handle an opening-hours conflict
- **Priority:** P0
- **User request:** “把这个景点改到周一下午参观。”
- **Setup:** A uniquely identified Attraction and a **synthetic, current official-source fixture** indicating Monday closure.
- **Required outcome:** Notice closure, avoid claiming Monday admission is possible, suggest another day or request direction. If product permits saving a conflicting draft, visibly retain the warning; never claim the issue is resolved.
- **Assertions:** Proper use of fact status, explicit conflict communication, no silent falsely valid state. Distinguish structural invalidity from warning-level conflicts.

### D. Facts, freshness, and user context

#### S10 — Replan outdoor activities around rain
- **Priority:** P1
- **User request:** “第二天下午有雨，把户外活动调整一下。”
- **Setup:** Controlled forecast, validity window and mix of outdoor/indoor Activities.
- **Required outcome:** Identify impacted Activities, prefer feasible indoor alternatives or date changes and preserve unrelated Activities. Do not invent weather or unverified opening details.
- **Assertions:** Forecast used within scope/freshness, sensible changes, no unauthorized loss; subjective quality rubric as needed.

#### S11 — Recognize stale business hours / unavailable refresh
- **Priority:** P0
- **User request:** “这家店明晚还能去吗？能的话就放到行程里。”
- **Setup:** Stale business-hours data; refresh deliberately unavailable. Restaurant identity is unambiguous.
- **Required outcome:** Do not represent stale information as live confirmation. Recommend verification, or clearly mark any tentative entry as unverified if allowed. Do not confidently state that the place will be open.
- **Assertions:** Honest freshness/unknown statement, appropriate conditional action, no fabricated verification.

#### S12 — Respect a trip-scoped preference
- **Priority:** P1
- **Conversation:** First user states “我这次旅行不喜欢七点前出门。” Later asks “重新整理第三天，尽量高效一点。”
- **Setup:** Trip-scoped preference recorded in current context; day three can be replanned with competing efficiency tradeoffs.
- **Required outcome:** Respect trip-scoped preference by default. If a substantial benefit requires early departure, explain and seek consent instead of silently treating efficiency as overriding the preference. Do not elevate a one-trip preference into permanent memory.
- **Assertions:** Correct preference scope and origin, plan consistency or explicit consent request, no silent override.

### E. Reliability and human/Agent collaboration

#### S13 — Handle concurrent human modification
- **Priority:** P0
- **Sequence:** Agent reads Trip; before its write, the user manually moves an afternoon Activity to morning; Agent attempts to write based on stale revision.
- **Setup:** Deterministic interleaving / revision conflict injection.
- **Required outcome:** Detect state version change. Re-read and replan, or report the conflict; never overwrite the newer human edit with stale state.
- **Assertions:** Revision conflict handled, newer manual edit preserved, eventual result coherent, trace documents what occurred.

#### S14 — Recover safely from a tool failure
- **Priority:** P0
- **Sequence:** Agent completes some planned edits; a later write fails or times out.
- **Setup:** Controlled fault injection with distinguishable 'failed before commit' vs. 'committed but response lost' outcomes.
- **Required outcome:** Inspect persisted state before retrying; avoid duplicate Activities or invalid partial state. Safely retry, compensate if supported, or clearly report remaining incomplete steps.
- **Assertions:** No duplication, no hidden unintended partial commits, accurate final-state reporting and safe recovery behavior.

#### S15 — Selectively undo a prior edit across turns
- **Priority:** P1
- **Conversation:** “把晋祠调到周三。” Agent applies it. Then user: “还是算了，恢复刚才的安排，但保留新增的午餐。”
- **Setup:** Recorded revision(s) or enough operation history to identify the targeted edit; new lunch must be distinguishable from the moved attraction.
- **Required outcome:** Undo only the requested attraction move, preserve the independently added lunch and unrelated changes; explain what was restored.
- **Assertions:** Selective state diff, preserved lunch, no collateral rollback, accurate report. Do not assume full event-sourcing infrastructure is required; implement minimum safe behavior supported by evidence.

## 2. Execution order and grading rules

- **Sprint A:** Targeted capability audit, controlled evaluation loop, S01–S03.
- **Sprint B:** S04–S08, planning and constraints.
- **Sprint C:** S09–S12, facts and context.
- **Sprint D:** S13–S15, reliability and collaboration; full regression.

For each scenario include: reproducible fixture, scenario metadata, expected invariants, explicitly accepted alternatives, forbidden behavior, assertions, execution trace, before/after state, fault/setup dependencies, and failure category. Start with a single end-to-end trial per scenario and subsequently repeat independent trials (initial suggestion: 3) for reliability. A high average score never cancels a critical invariant failure.

**Failure classes:** Intent; Planning; Tool Selection/Contract; Domain Gap; Validation; Facts/Freshness; Context; State/Concurrency; Recovery; Eval Defect.

**Information-system guardrail:** The separate `BrandonTravel_MVP3-4_Information_System_Snapshot(1).md` is a conceptual working agreement, not a backlog. Preserve `PLAN ≠ FACT ≠ CLAIM ≠ PREFERENCE ≠ INFERENCE`. Build only minimal MVP3/MVP4 requirements; do not prebuild Evidence Engine, long-term Memory, generic lifecycle framework or speculative services.

**Scope of approval:** Follow `CODEX_CHANGE_AUTHORITY.md` for modifications requiring owner review; do not infer unrestricted approval for schema, authorization, or architectural changes from a passing test goal.

## 3. Codex's first response after reading

1. Confirm all 15 IDs are found and summarize which can already run using current code.
2. Produce source-linked capability audit and a Sprint A plan scoped to S01–S03.
3. List any missing fixture assumptions or product decisions explicitly, especially write authorization.
4. Do not mutate production/travel user data, call live external APIs, or build out-of-scope future infrastructure to run tests.
