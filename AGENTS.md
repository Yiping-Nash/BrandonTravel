# BrandonTravel2 — Agent Working Rules

1. Read `docs/PRODUCT.md`, `docs/UX_SPEC.md`, `docs/CONTRACTS.md`, `docs/ACCEPTANCE.md` before feature work.
2. Product decisions belong to the user and their ChatGPT Product & Architecture Advisor. Builders may choose implementation details, not silently change approved behavior.
3. Reuse vetted open-source components, framework APIs and examples before writing replacements. Track license/version/source.
4. The Workspace domain state is canonical. Kanban/Day/Week are editable projections. Agent proposes; user confirmation writes.
5. Agent technology: Python Deep Agents and LangChain ecosystem, LangSmith tracing. No custom hand-rolled agent loop unless explicitly justified and approved.
6. Use independent worktrees/clear file ownership for parallel tasks. Shared contracts belong to integration lead.
7. Run tests and report actual results, errors and known limits. Never claim a mock as a production integration.
8. Keep API keys out of repo and browser bundles. Prepare env templates for user configuration.
9. Preserve V1 git history; V2 starts with clean implementation. Never force push or destroy existing work without explicit approval.
10. Favor three-day coherent E2E demo over unrelated features or speculative infrastructure.
