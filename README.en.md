# BrandonTravel

**Plan together. Travel your way.**

A visual travel planner for people and AI to work on the same itinerary. Shape your trip on a timetable, keep undecided ideas in the plan tray, and review proposed changes before they become your plan.

[中文](README.md) · [Product case study](docs/product-case-study.md) · [Demo guide](docs/demo-guide.md) · [Agent evidence](demo/agent-evidence.json) · [Architecture](docs/architecture-overview.md)

![Built weekly timetable with a saved synthetic itinerary](assets/planner.png)

### See the product

[Recorded UI demo — 131 seconds](demo/portfolio-demo.webm) · [Local demo page source](demo/index.html)

The recording shows real UI operations on synthetic data. Its proposal was constructed through the deterministic API, with **no model calls**. Separately, [S01-1](demo/agent-evidence.json) preserves a historical real Qwen + MCP run, with test-runner confirmation and state readback. Neither is a new live Agent demonstration.

### Three new recorded segments

[Planning in progress · 12s](demo/v2/01-creating.webm) · [A formed itinerary · 13s](demo/v2/02-formed.webm) · [Real Agent collaboration · 24s](demo/v2/03-collaborating.webm)

Recorded on the isolated historical baseline, with approved public-demo itineraries. The third segment uses a new real model + MCP run; confirmation is a scripted click in the real UI. State readback verifies only the requested activity changed, and the 10-minute lunch overlap remains visible. [Inspect traces, state and all three attempts](demo/v2/evidence/summary.json). Six model requests total; first attempt hit the context limit. The recordings use live screenshot capture at roughly 4–6 fps and have no audio; they are separate review takes, not the final 70-second edit.

## Built: plan at your own pace

- **Visual planning:** weekly timetable, drag and resize, manual editing, multi-select and atomic batch operations.
- **Room for undecided ideas:** plan tray and origin-date groups; shortening a trip keeps displaced activities available to reschedule.
- **A legible plan:** transitions, plan status and deterministic overlap, travel-gap, opening-hours and outdoor-weather checks.
- **Evidence-aware facts:** sources, freshness and query states stay visible. Missing or stale evidence stays UNKNOWN.

Built denotes implementation with historical verification, not complete user acceptance. Real-phone and full user-led travel-demo acceptance remain pending.

## Experimental: edit together, keep control

The Agent reads the current trip through MCP and proposes a change. The user confirms or rejects it; shared application rules validate the write and the saved state is read back. The structured trip is authoritative, not the conversation.

[Inspect a real historical run](demo/agent-evidence.json) · [Read evaluation evidence and failures](docs/evaluation.md)

The production Agent uses a custom TypeScript model/tool loop. Fixed S01–S15 trials are development regression evidence, not a current-version generalization success rate. SDK compatibility was explored separately; it has not replaced production.

## Three stories from a Shanxi trip

1. **A trip taking shape:** fixed transport anchors and undecided places, with room to make choices.
2. **A trip ready to review:** natural sightseeing, accommodation, a few meals and free time, rather than filling every hour.
3. **A plan changing together:** one precise request, a reviewable proposal and verified readback.

[V2 candidate fixtures and recording plan](docs/demo-guide.md) are prepared separately. They are authored public-demo data. The approved fixtures were imported and read back through the isolated app; the collaboration scenario was run with the real model and MCP. Transport times are illustrative, not verified schedules or bookings. Existing screenshots depict the earlier fixture.

## Product Vision — Planned

- **Proactive information:** surface relevant changes before the traveller has to ask.
- **Key-event verification:** check important travel details with visible sources and freshness.
- **Manageable preference memory:** let travellers review and change what the companion remembers.
- **Multi-source evidence:** preserve uncertainty and disagreements rather than presenting unsupported certainty.
- **Continuous companionship:** useful suggestions and reminders across planning and the trip itself.

These are future product directions, not delivered background monitoring, booking verification or autonomous execution. Any concept visuals will be labelled **Concept / Planned**.

## Why this design

A visual workspace makes the plan inspectable. Shared domain capabilities prevent the UI and Agent from maintaining conflicting plans. Human confirmation keeps meaningful changes under user control; deterministic rules handle constraints, while the Agent helps interpret intent.

[Product decisions and trade-offs](docs/product-case-study.md) · [Architecture](docs/architecture-overview.md) · [Evidence and limitations](docs/evaluation.md)

SVG mapping is available; real AMap JavaScript basemaps remain unverified without the required JS credential. Public hosting and anonymous real-model access are not provided.

## Local development (Windows)

Requires Node.js 24 and Windows PowerShell. First installation downloads project-local Bun/PostgreSQL and dependencies; it does not install Windows services or global tools.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 init
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 start
$env:TRAVEL_FACTS_ALLOW_NETWORK='false'
node scripts/local-start.mjs
```

Open http://localhost:4331/ and register a local account. The last command starts both API and web; leave the terminal open. Ctrl+C stops both, not PostgreSQL. For later launches, only DB start and local-start are required. Default DB/API/web ports: 54329/4332/4331. A fresh-machine installation has **not** been independently verified; current-machine verification is documented.

Offline display works without a model or provider key. Setting TRAVEL_FACTS_ALLOW_NETWORK=false disables external fact acquisition, not configured model calls: do not send chat messages in an offline demonstration. Optional credentials belong only in ignored .runtime configuration; see [demo guide](docs/demo-guide.md). No public deployment or anonymous real-model access is provided.

## Attribution and license

Built on [Open Sunsama](https://github.com/ShadowWalker2014/open-sunsama), pinned to 0eb237d9eb67373fb0c78690b6126d7d6e361368. Calendar interactions and other reused components retain upstream attribution. This repository retains the upstream **non-commercial license**; it is a source-available non-commercial prototype, not an MIT/Apache licensed product. Read [LICENSE](LICENSE), [UPSTREAM.md](UPSTREAM.md) and [credits](docs/credits.md) before reuse.
