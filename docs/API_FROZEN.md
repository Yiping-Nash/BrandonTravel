# Contract v1 — integration lead owns packages/contracts

Python Pydantic models are canonical. Generated OpenAPI and TypeScript live here/packages/contracts.
All JSON field names are camelCase. All API paths start `/api`.

- GET /health → {status, capabilities:{agent:boolean,poi:boolean,tracing:boolean}, model}
- GET /trips → Trip[]; POST /trips body TripCreate → TripSnapshot (201)
- GET /trips/{id} → TripSnapshot
- POST /trips/{id}/commands body Command → complete TripSnapshot; transaction + expectedVersion, stale returns 409.
- GET /places?query=...&city=... → {places:Place[],provider:'amap'}; 503 missing key, 502 upstream, no mock fallback.
- POST /trips/{id}/chat body ChatRequest → ChatResponse; suggestions persisted as proposed only. This increments snapshot version, so client refetches after chat.
- GET /trips/{id}/sessions → ChatSession[]. sessionId scoped to trip. New null ID makes a session; subsequent requests reuse it.
- All errors {error:{code,message,details?}}. Validation 422, absent entity 404, conflict 409, missing config 503, upstream 502.

Activity startAt/endAt: nullable pair, ISO local `YYYY-MM-DDTHH:mm` in Trip.timezone (IANA), without offset. Same activity date, end > start, no cross-midnight. DST ambiguous/nonexistent wall times rejected. Calendar adapter uses wall-clock components (never UTC conversion). moveActivity retains local clock time on target date and revalidates. Sort keys normalized to contiguous 0-based positions within each date. Deleting an Idea unlinks Activity.ideaId; it never deletes adopted activities. Suggestion adoption is atomic and once only (repeat 409). Dates must be inside the trip.

Architecture: React/Vite, FastAPI, SQLite transactional aggregate JSON + version CAS; one localhost single-user workspace. No production authentication claimed. API binds loopback, Vite proxies /api, reject nonlocal browser origins. Persistent chats separate from canonical trip snapshot. Agent only receives snapshot and POI callables, never storage or general CRUD tools. Model default qwen3.8-flash; no silent fallback.

Ownership: Frontend apps/web/**; Workspace apps/api/{domain,routes,db}/** plus tests/workspace/**; Agent apps/api/agent/** plus evaluation/**. Lead owns root setup, packages/contracts/**, apps/api/main.py, integration tests/scripts/docs.

Workspace integration exports: Repository(path), .list_trips(), .create_trip(TripCreate), .get_snapshot(id), .execute(id,Command), .add_suggestions(id,list[SuggestionDraft]) -> list[Suggestion], .list_sessions(trip_id), .get_session(trip_id,session_id), .save_session(ChatSession). DomainError(status,code,message). API router factory create_router(repo) covers trips/commands/sessions; no chat route. Agent exports run_chat(trip_id, request, get_snapshot, search_places, history) -> ChatResponse (suggestions assigned UUIDs, not persisted by Agent); async search_places(query,city) -> list[Place]. Lead handles saving proposed suggestions + session transcript and HTTP wrappers.
