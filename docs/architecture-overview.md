# 架构速读

Human UI → REST / Application Service → Domain Kernel → PostgreSQL Canonical Trip State

Agent（自定义 TypeScript 循环）→ Qwen OpenAI 兼容接口 → 真实 MCP 客户端／工具 → 同一应用服务 → 待确认 Proposal

用户确认 → 授权／固定／版本／幂等校验 → 事务执行 Domain Operations → 读回 Trip / Facts / Snapshot

## 职责

- 模型：理解、选择工具、解释；不充当行程权威状态。
- Runtime：模型／工具循环、预算、取消、上下文及错误处理。
- Domain：时间与规划计算、规则、合法性、共享修改语义。
- Application：可信身份、归属、提案确认、持久化和审计。
- Operational Facts：供应商中立的来源／时效／适用范围，与用户计划分开；刷新不增加计划 revision。

## 主要入口

- apps/api/src/travel/chat-routes.ts：正式聊天宿主，Qwen fetch 与工具循环。
- mcp/src/travel-index.ts：MCP 工具适配。
- apps/api/src/travel/routes.ts：旅行 REST、提案和确认边界。
- apps/api/src/travel/domain.ts：共享操作与计划校验。
- apps/api/src/travel/kernel/service.ts：候选、事实与评估服务。
- packages/utils/src/travel-intelligence.ts：唯一确定性约束规则。
- packages/utils/src/travel-inspection.ts：可解释 Snapshot。

详细架构与决策见 ARCHITECTURE.md 和 ADR/。Phoenix/OTel 只为隔离 Eval 观测，关闭不影响业务或本地报告。SDK Spike 不属于正式运行链路。

## 可靠性与已知负担

版本、事务和幂等保护写入；事实匹配／到期／晚返回保护资料；UNKNOWN 不等于通过。当前仍有自然语言特判与宿主复杂度，未证明长行程泛化；上游未用模块、构建体积和既有 lint 警告仍存在。
