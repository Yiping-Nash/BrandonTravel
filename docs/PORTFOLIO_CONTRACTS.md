# Portfolio contract freeze (2026-10-26)

Lead owns packages/contracts and generated OpenAPI/TypeScript. Existing schemas/commands remain backward compatible for complete Trips. Unknown destination="", startDate/endDate=null, companions=""; never substitute invented dates. Frontend gates calendar/AI planning until destination+valid date range known, but draft Trip and Ideas remain usable. updateTrip accepts complete TripCreate settings; reject dates excluding existing activities rather than delete/move silently.

Proposal is a separate persisted record linked to Trip. ProposalDraft actions reuse AddIdea/AddActivity/UpdateActivity/RemoveActivity. Pending proposals do NOT mutate ideas/activities. Store captured contextHash; confirmProposal command checks latest authoritative context, executes all actions atomically, marks accepted; reject stale, duplicate and cross-Trip. Domain version increments once for applied batch. Idempotency requestId scoped to Trip+operation. Dismiss never writes itinerary.

API (all prefixed /api):
- POST /trips, GET /trips/{id}, POST /trips/{id}/commands (existing; added updateTrip/confirmProposal/dismissProposal).
- GET /trips/{id}/proposals → Proposal[].
- POST /trips/{id}/proposals/generate (PlanRequest) → Proposal. Read snapshot, run official Agent, validate/store proposal, no itinerary writes. kind blueprint/day/changes; day requires selected date.
- GET /trips/{id}/research-runs → ResearchRun[].
- POST /trips/{id}/research-runs (ResearchStart) → ResearchRun,202. One active per Trip; background task is service execution, not custom Agent harness.
- POST /trips/{id}/research-runs/{runId}/cancel → ResearchRun.
- POST /trips/{id}/research-runs/{runId}/proposal (ResearchAdopt) → Proposal. Server reads stored, validated result and evidence; no client-supplied candidate text. chosen target/date determines exact preview actions. Validate context and deduplicate candidate adoption.
- GET /trips/{id}/day-context?date=YYYY-MM-DD → DayContext. Deterministic overlap/unknown-time/movement plausibility; route data explicitly sourced/estimated, never imply measured travel time from straight-line distance.

R1 typed ResearchResult/Evidence remain reused; ResearchRun JSON fields are validated with them before storage. Persist status/results/evidence; restart marks unfinished failed, refresh restores; cancellation must prevent late completion overwriting status. Agent tasks never hold DB transactions across model/network awaits. User edits remain possible while research runs; stale run is visible but cannot be adopted without refresh/research.

Agent module interface: apps/api/agent/portfolio.py exposes async generate_proposal(snapshot:TripSnapshot,request:PlanRequest)->PlanGeneration and async research_for_trip(snapshot:TripSnapshot,question:str)->dict with result/evidence/traceUrl/toolCalls. These read immutable snapshot and return proposed output only, no repository access. Tools accept scoped query, not arbitrary TripID. Official create_deep_agent/task/ToolStrategy. Use existing candidate adapters and global budget constraints; never fake real results. APIs return honest errors. Main conversational chat remains available alongside explicit Blueprint/Day/Research actions.

File ownership: lead shared contracts/generated clients/main integration/maps/verification/docs; Workspace worker apps/api/db/repository.py,domain/commands.py,routes/portfolio.py,workspace tests; Agent worker apps/api/agent/portfolio.py and necessary research runtime files plus own tests; Frontend worker apps/web/src (preserve existing components). Each reports needed cross-owner changes rather than editing shared files.
