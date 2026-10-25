# Source provenance

Verified 2026-10-26. No Mindtrip code/assets copied. User screenshots are local reference only.

| Component | Source / revision | License | Integration |
|---|---|---|---|
| Kibo Kanban | https://www.kibo-ui.com/r/kanban.json; repo HEAD 3d63cdb15b79d972e3dc38a10997987672f9b263 (redirects to shadcnblocks/kibo) | MIT, license.md | Registry source under apps/web/src/components/kibo-ui/kanban; domain adapter |
| yassir-jeraidi/full-calendar | https://calendar.jeraidi.dev/r/full-calendar.json; repo HEAD bd8eba932e4ec359353ec1f0cd9ec8daa9de16b1 | MIT | Registry source under apps/web/src/features/calendar, adapt persistence/context |
| Deep Agents | Python deepagents 0.7.32 | MIT | Official create_deep_agent and ToolStrategy |
| LangChain OpenAI | langchain-openai 1.7.2 | MIT | Qwen OpenAI compatible ChatOpenAI adapter |
| React / Vite / shadcn | locked npm versions | MIT | UI foundation |

Registry files are fetched independently from repository HEAD; exact downloaded source hashes will be recorded. npm and uv lockfiles capture package resolutions. @hookform/resolvers pinned 5.2.2 because 6.0.0's optional effect peers conflict during clean npm resolution. No force/legacy-peer bypass used.

Smoke: canonical schema imports; 7 contract tests passed; Deep Agents create_deep_agent signature verified; npm install succeeded with 0 audit vulnerabilities. Full Calendar original source is materialized before domain adaptation; runnable render smoke belongs to UI checkpoint.
