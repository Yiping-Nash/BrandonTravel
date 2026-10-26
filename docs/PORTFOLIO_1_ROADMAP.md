# Portfolio 1.0 — active product roadmap

Approved by Product Owner on 2026-10-26. This supersedes PLAN.md only as the top-level roadmap; PLAN.md and all R1/R2 work remain Agent subsystem engineering evidence. The36/54 batch experiments are deferred, not prerequisites to this delivery. Existing API/Trace budgets remain caps; no main-branch publication without confirmation.

**BrandonTravel — An AI-native travel planning workspace**

**Plan with structure. Explore with AI. Stay in control.**

Three required values: (1) AI-assisted multi-day blueprint jointly edited with the user; (2) daily Chat/Timeline/Map collaboration with deterministic time/movement checks; (3) personalized, evidence-backed research using AMap and official/authoritative public sources. Xiaohongshu/community research deferred. Do not shrink these goals to match current implementation.

Complete journey: blank start → optional progressive Where/When/Who → create Trip → AI blueprint → preview changes → user confirm → Kanban editing → daily Timeline+Map+Chat → real Research candidates and evidence → confirmed Ideas/Itinerary adoption → refresh and continue editing. Unknown destination/dates/companions remain explicitly unknown, editable later. No hidden invented travel dates. Manual planning remains available.

All agent changes follow Proposal → Diff Preview → User Confirm → Domain Command. Workspace state remains canonical. Proposal/run persistence is linked to Trip, not an alternative itinerary store. Confirm against current context; stale proposals must not overwrite manual edits. Keep Board/Day/Week components and preserve the first-round implementation.

Gate A: inspect current code and original kickoff/UI screenshot index, freeze minimal compatible contracts. Gate B: implement blueprint, daily map/collaboration and real Research/R2 integration in the current FastAPI/Python/React application. Gate C: real-browser blank-start journeys for Shanxi golden demo plus two independent personas; fix defects; independent Workspace/Agent/final reviews; prepare public repository presentation. Gates do not require per-step approval.

Reuse official Deep Agents create_deep_agent/task, applicable Context/Skills/Backend/Planning and LangChain model adapters. No custom agent loop, multi-agent network, RAG, shell/sandbox, microservices or gratuitous MCP. Use mature components and sources, record version/license. Main handles chat/context/simple tools; Research handles complex research; Domain validates and writes after human confirmation.

Portfolio outputs: English and Chinese product-led README, actual Workspace hero, three short demos (blueprint/daily planning/research adoption), concise architecture diagram, setup/demo paths, truthful tests/evaluation/limits/sources. Core story: structured plans continuously improved by people, Workspace and Agent, not static generated guides. Keep docs/agent-learning based on actual code and runnable experiments. Final bundles: ≤2-page Product Owner Report, Developer Learning Guide, Engineering Evidence.

Do not publish unaccepted work to main, discard V1/R1, or claim fixture/no_results as product-value evidence. Reuse existing evidence, avoid broad research and low-value repeated experiments. Ask only for genuine product-definition conflicts, extra spending or destructive action.
