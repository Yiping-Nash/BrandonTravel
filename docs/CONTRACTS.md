# Contract Baseline（供 Codex Lead 验证后冻结）

这是语义契约而非强制 ORM/schema。Lead 可以根据框架选择 OpenAPI + Zod / Pydantic，并生成跨语言类型，但要保持这些不变量。

## 关键模型
- `Trip`: `id`, `title`, `destination`, `startDate`, `endDate`, `timezone`, `preferences?`, timestamps.
- `Idea`: `id`, `tripId`, `title`, `description?`, `place?`, `sourceKind` (manual|poi|agent), `evidence?`, timestamps.
- `Activity`: `id`, `tripId`, `title`, `date`, `sortKey`, `startAt?`, `endAt?`, `place?`, `ideaId?`, `notes?`, timestamps. `startAt/endAt` 成对空或成对有效；没有时间并不代表不存在于 Itinerary。
- `Place`: `provider`, `providerId?`, `name`, `address?`, `latitude?`, `longitude?`; 不要求所有自定义活动绑定 Place。
- `Suggestion`: `id`, `tripId`, `kind`, `title`, `rationale`, `proposedDate?`, `place?`, `evidenceRefs?`, `status`(proposed|accepted|dismissed). Agent 提交建议，不直写 Activity。
- `TripSnapshot`: 最新 Trip + Ideas + Activities + preferences + 当前相关信息（带版本/更新时间），供 Agent 读取。

## 状态单一来源
- 统一 Workspace 域状态/API 为权威。Kanban / Day / Week 是投影视图。
- 所有编辑经过一个领域命令入口（前端 store/action -> API），包括 reorder、moveDate、setTime、remove、addIdea、adoptSuggestion；刷新后可读回。
- 对写入采用版本检查或至少一致的修改返回与读回验证；禁止 Agent UI 将未确认建议写入 Trip。

## Agent ↔ Workspace 接口
- 读：`get_trip_snapshot(trip_id)`、`search_places(...)`、按需规则/事实工具。
- 写：Agent 不拥有一般日程 CRUD 权限；`propose_suggestions` 返回结构化结果，后续由用户调用 Workspace adopt API。
- 输出结构使用 Pydantic（如适配）并暴露稳定 JSON 供 React 呈现；错误/未知来源要可表达。
- Chat session 关联 tripId，但允许一趟 Trip 多个 session；不把聊天记录当 Trip 的数据库。

## 必须由 Lead 在启动时解决的技术细节
1. 完整时区语义，跨天事件是否首期支持（建议首期明确不支持，并做输入校验）。
2. 适配 Full Calendar 的事件类型、拖拽回调与 Kibo 的跨列排序；怎样处理 undated Idea / untimed Activity。
3. POI API 的返回字段、配额/权限、错误态和展示要求。
4. Deep Agents 模型的工具调用/结构化输出 smoke test；Trace 的敏感信息脱敏。
5. API 错误响应、用户操作回滚、持久化数据库选型。

所有不确定项记录为 ADR，不擅自改变产品语义。无需预先实现所有可选字段。
