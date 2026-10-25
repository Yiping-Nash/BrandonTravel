# Brandon frontend

Run from repo root: `npm --prefix apps/web run dev`. Vite serves `http://127.0.0.1:5173` and proxies `/api` to FastAPI on `127.0.0.1:8000`.

`npm --prefix apps/web run build` typechecks all retained source then produces `dist/`.

The homepage creates real persistent trips. “打开演示旅行” explicitly writes the frozen demonstration fixture through real Workspace commands; the content is labeled demo, not represented as POI research. `?demo=1` is a read-only, visibly labeled UI review fixture and rejects writes. `?trip=<id>` restores a real trip after refresh.

## Reused components

- Kibo UI registry Kanban (`src/components/kibo-ui/kanban/index.tsx`): official source, immutable drag arrays and six-pixel activation threshold adapted; domain changes commit once at drop. Pointer, touch and keyboard sensors retained. Details dialog offers move controls as an alternative to dragging.
- yassir-jeraidi/full-calendar (`src/features/calendar`): official week grid, grouping, event layout, DnD and resize primitives. Day shares that grid with a single column. Replaced private domain state with controlled Workspace callbacks; all event times use trip-local wall-clock strings; updates commit once at drop/resize end. Removed unused upstream demo/network/local-storage modules and month/year/agenda presentation. No fabricated all-day timestamps: untimed activities render in a distinct domain strip.
- Source licenses retained in repository `licenses/`. Registry baseline exists in Git history; integration changes are reviewable against the frozen baseline.

## Browser automation hooks

`data-testid`: `view-board`, `view-day`, `view-week`, `tab-itinerary`, `tab-ideas`, `tab-explore`, `trip-<id>`, `activity-<id>`, `untimed-<id>`, `idea-<id>`, `adopt-idea-<id>`.

Accessible labels include 旅行名称, 目的地, 出发日期, 结束日期, 活动名称, 活动日期, 设定具体时间, 开始时间, 结束时间, 活动备注, Idea 标题, 采纳日期, 搜索地点, 给 Brandon 的消息, 对话模式, 聊天会话, 发送消息, 展开聊天 / 收起聊天.

Chat explicitly selects real or demo. Errors never silently fall back to mock content. POI search uses only backend results. Suggestions can be saved to Ideas or adopted into the proposed/first date with a separate user action. Every command sends expectedVersion and reads back the complete canonical snapshot; conflicts refresh state and require a deliberate retry.

## Concurrency and civil time

Snapshot acceptance checks both the active navigation generation/trip and a monotonic version. Home/navigation invalidates earlier reads and writes; operation tokens prevent old request cleanup from unlocking a newer operation. Failed commands do not restore a stale snapshot. Chat guards selected-session and component lifetime, shows pending messages, and restores the last valid per-trip session from sessionStorage (an explicit New conversation remains new). Collapsing chat hides it without interrupting its current request.

Calendar calculations use the official MIT `@date-fns/utc` 2.1.1 `UTCDate` adapter as a civil-time arithmetic carrier. The API still receives trip-local ISO strings without an offset. This prevents the browser timezone's daylight saving changes from shifting activity positions or durations. Verified smoke with `TZ=America/New_York`: Shanghai `2026-03-08T09:00` maps to minute 540; `01:00–04:00` is 180 minutes; moving that duration to next-day 09:00 ends at 12:00. Browser regression evidence belongs to the Lead's E2E report.
