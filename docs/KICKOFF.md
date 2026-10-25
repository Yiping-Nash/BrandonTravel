# BrandonTravel2 — 开工包（2026-10-26）

这是交给 Codex 的施工输入包。用户和当前 ChatGPT 对话担任产品决策与架构顾问；Codex 负责技术实施、验证和集成。目标为 **三天冲刺可演示 MVP**，不是三天内交付完整版商业产品。

## 阅读顺序
1. `docs/PRODUCT.md` — 产品边界、用户场景、功能优先级
2. `docs/UX_SPEC.md` — 已冻结的视觉参照与交互规则
3. `docs/REFERENCES.md` — 优先复用的项目及调研标准
4. `docs/CONTRACTS.md` — 跨模块语义和接口草约（Lead 实测后冻结）
5. `docs/ACCEPTANCE.md` — 验收与演示标准
6. `docs/EXECUTION_BRIEF.md` — 工作流、并行分工与启动命令
7. `AGENTS.md` — 精简长期工程规则

## 强制前提
- 远程仓库仍为 `https://github.com/Yiping-Nash/BrandonTravel`，**不继承旧代码或旧 AGENTS.md 规则**。先创建可恢复的 V1 归档引用（分支/标签），再在新的 V2 分支中从空白代码树初始化；不强制改写已有提交历史。
- 本地工作区目标：`E:\CodexRepo\projects\BrandonTravel2`（如已存在先检查，不覆盖）。
- Codex 生成 `.env.example`、本地 `.env`（仅占位）和 `.gitignore`；用户亲自填写密钥。绝不提交真实密钥，不将服务端密钥暴露给浏览器。
- 不允许在产品关键路径偷偷使用静态假结果替代真实 Agent/POI 调用；外部配置缺失时明确标识阻塞，保留可运行的 Mock 演示模式，并且与真实模式区分。

## 第一件事
在任何正式功能开发前，Lead 完成架构检查、依赖可用性与许可核查，建立 **最小实体语义 + OpenAPI/类型契约 + 前端 Mock 适配层**，并输出实际测试结果。然后才开启彼此隔离的前端 / Workspace / Agent 三条施工线。

重要：上述资料是经过产品讨论的基线。实现细节可由 Codex 自主选择；如拟改变产品行为、范围或核心语义，生成简短决策请求供用户及 ChatGPT 评审。
