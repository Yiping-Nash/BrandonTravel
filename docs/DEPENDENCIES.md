# Source provenance

Verified 2026-10-26. No Mindtrip code/assets copied. User screenshots are local reference only.

| Component | Source / revision | License | Integration |
|---|---|---|---|
| Kibo Kanban | https://www.kibo-ui.com/r/kanban.json; repo HEAD 3d63cdb15b79d972e3dc38a10997987672f9b263 (redirects to shadcnblocks/kibo) | MIT, license.md | Registry source under apps/web/src/components/kibo-ui/kanban; domain adapter |
| yassir-jeraidi/full-calendar | https://calendar.jeraidi.dev/r/full-calendar.json; repo HEAD bd8eba932e4ec359353ec1f0cd9ec8daa9de16b1 | MIT | Registry source under apps/web/src/features/calendar, adapt persistence/context |
| Deep Agents | Python deepagents 0.7.32 | MIT | Official create_deep_agent and ToolStrategy |
| LangChain OpenAI | langchain-openai 1.7.2 | MIT | Qwen OpenAI compatible ChatOpenAI adapter |
| LangChain DeepSeek | langchain-deepseek 1.1.1 | MIT | Official ChatDeepSeek for Portfolio planning / Research |
| Tavily Python | tavily-python 0.8.5 | MIT | Official search/extract client, authoritative-source filtering |
| React / Vite / shadcn | locked npm versions | MIT | UI foundation |

Registry files are fetched independently from repository HEAD; exact downloaded source hashes will be recorded. npm and uv lockfiles capture package resolutions. @hookform/resolvers pinned 5.2.2 because 6.0.0's optional effect peers conflict during clean npm resolution. No force/legacy-peer bypass used.

Copied component license texts are preserved in [third_party/licenses](../third_party/licenses/). Original AMap imagery retains provider attribution; AMap/Tavily hosted APIs follow their provider terms and account quotas rather than the components' MIT licenses. Exact Python/npm versions remain in `uv.lock` and `apps/web/package-lock.json`.

Portfolio 1.0 original V2 code is MIT, selected by the owner on 2026-10-26. The former Open Sunsama non-commercial root license remains applicable to its V1 material in archived history; it is not V2's project license. See [LICENSE](../LICENSE) and [NOTICE](../NOTICE.md) for the scope and preserved component notices.

Smoke: canonical schema imports; 7 contract tests passed; Deep Agents create_deep_agent signature verified; npm install succeeded with 0 audit vulnerabilities. Full Calendar original source is materialized before domain adaptation; runnable render smoke belongs to UI checkpoint.
