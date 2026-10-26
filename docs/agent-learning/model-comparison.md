# R1 模型兼容性对照

2026-10-26。用户指定五个候选；本轮先做少量兼容性测试，不扩展为模型排行榜。人工推荐质量评审为 **Pending**。本文件的运行表由真实记录补充，模型可构造、Key 可用、Agent 运行成功是三个独立检查。

## 官方实现与相同条件

模型分别使用 `langchain_openai.ChatOpenAI`（百炼兼容 API）、`langchain_deepseek.ChatDeepSeek`、`langchain_anthropic.ChatAnthropic`。版本固定为 1.7.2、1.1.1、1.7.6；依赖 MIT 许可证，来自 LangChain 官方发行包。DeepSeek 包因 PyPI 文件服务器 TLS 失败通过阿里云 PyPI 镜像取得，锁文件保留哈希，其余依赖来源不变。

依据：[Deep Agents 模型](https://docs.langchain.com/oss/python/deepagents/models)、[ChatDeepSeek](https://docs.langchain.com/oss/python/integrations/chat/deepseek)、[ChatAnthropic](https://docs.langchain.com/oss/python/integrations/chat/anthropic)、[Subagents](https://docs.langchain.com/oss/python/deepagents/subagents)、[结构化输出](https://docs.langchain.com/oss/python/langchain/structured-output)。Academy M1.3/M1.5、M4.1/M4.2、M5.3 对应关系见 [course-mapping.md](course-mapping.md)。

Agent 仍由 `create_deep_agent` 调度，通过官方 `task` 委派一个 Research。Main 返回 ResearchSelection，子代理返回 ResearchResult；公开 Middleware 捕获子结果、统计预算和拒绝未授权工具。没有修改框架内部代码。CLI 只组织独立测试案例，不负责模型与工具的推理循环。

固定条件：上海长者 Trip，`r1-v1:shanghai_seniors:1:2026-11-02`，架构 B，完全相同的快照、问题、工具定义、Pydantic Schema、系统提示。使用**真实模型 + 固定工具数据**隔离供应商网页波动。固定来源只用于协议验证，不能作为真实景点推荐或旅行研究通过的证据。

每个模型一次任务；父子合计最多 12 次模型请求、每次最多 5,000 输出 Token、模型输入序列化上限 40,000 UTF-8 字节、任务 180 秒、SDK 自动重试 0、官方 ToolStrategy 最多一次格式修复。统一每任务预留 ¥35，覆盖最贵参考模型与 50KB 框架余量的保守上界；按实际已知 Token 结算，缺 usage 保留预留。全局 ¥100、LangSmith 1,000 Trace 和 Tavily 1,000 credits 上限继续有效。预留不等于实际花费。

测试入口：

```powershell
.\.venv\Scripts\python.exe -m evaluation.research_model_compare
```

默认顺序为 Qwen Flash、DeepSeek Flash、Qwen Plus、DeepSeek Pro。若 Qwen/DeepSeek 出现共同失败类别则停止后续扩展，先检查工具、Schema 和 Deep Agents 配置。单次成功不足以宣称稳定或选择最终架构；本轮不自动跑 36/54 次正式实验。

## 配置检查和已知框架限制

`.env` 已按 `.env.example` 整理；六个平台 Key 均有值，原值被保留。Key 的值不会进入报告、Git 或浏览器。Qwen Plus 共用百炼 Key，两个 DeepSeek 共用 DeepSeek Key；实际产品 AGENT_MODEL 保持现有基线。

只读模型列表接口已返回：Qwen HTTP 200，可见 `qwen3.8-flash`、`qwen3.7-plus`；DeepSeek HTTP 200，可见 `deepseek-flash`、`deepseek-v4-pro`。Claude Key 经用户纠正后，解析值没有多余首尾引号或空白，但直连接口仍为 HTTP 403；这不证明 Key 无效，也不证明模型能力不足。[原始安全检查记录](../../evaluation/r1-config-check.json)

Claude 另有已证实的配置不兼容：本地 LangChain 1.4.7 的 `agents/factory.py` 在 ToolStrategy 路径绑定 `tool_choice='any'`，而 [Sonnet 5.5 官方说明](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) 明确不接受强制工具选择。只在 ChatAnthropic 构造时省略参数不能消除框架后来设置的参数。当前在预算预留和网络调用前将 Claude 标记 `CLAUDE_TOOLSTRATEGY_UNSUPPORTED`，不发送注定失败的付费请求，也不伪造可比较结果。需要官方支持且能说明条件差异的适配方案后，再讨论加入参考组。

## 费用口径

记录输入/输出 Token、usage 完整性和保守预算费用。DeepSeek 按官方峰值及 10 CNY/USD 的**预算换算**，Claude 预留考虑缓存写入上界；这不是汇率报价或平台账单。Qwen 的地区、缓存、免费额度也会影响实付。报告不把预算金额伪装成精确费用。

来源：[Qwen Plus](https://help.aliyun.com/zh/model-studio/qwen3-7-plus)、[DeepSeek 价格](https://api-docs.deepseek.com/quick_start/pricing/)、[Claude Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)。具体价格及差异以执行时保存的候选元数据为准。

## 审查与判定

独立审查已覆盖适配器、候选执行路径、密钥脱敏、预算和权限；识别并修复 harnessProvider 缺失，以及在调用前阻止 Claude ToolStrategy 不兼容。复审未发现未解决 P1/P2，详见 [review-r1.md](review-r1.md)。

分别观察：未提供工具的调用、无法解析的工具参数、工具错误、Schema 修复次数、最终数组/日期校验、委派完成、状态不变、模型请求数、Token、耗时、成本完整性和 Trace 读回。协议通过不等于证据语义正确。若日期为 null 或没有候选，必须说明本次并未实际测试非空日期生成，不能用空字段宣称日期能力通过。

<!-- ACTUAL_RESULTS -->

## 实际结果：四次初测 + 两次定向复测

### 初测：相同代码、相同任务

源码指纹 `8a9f530f0c58c65fb243ed86e4111184df922b09c30dfaf4e72a38499ba2a2b6`；[批次清单](../../evaluation/r1-model-comparison/b59e06f6-b265-41d3-bf76-fcd739243256.json)。不同指纹的结果不合并推断成功率。

| 模型 | 协议结果 | 请求 | 输入 / 输出 Token | 图运行 / 总耗时秒 | 保守模型费用上界估算 CNY | Trace |
|---|---|---:|---:|---:|---:|---|
| [qwen3.8-flash](../../evaluation/r1-results/f3e5f376-799c-4055-a111-bdd07505541b.json) | MODEL_INPUT_BUDGET_EXCEEDED | 9 | 46,062 / 2,731 | 50.806 / 58.700 | 0.060227 | Unavailable |
| [deepseek-flash](../../evaluation/r1-results/83e35bfa-e4b5-4b4b-9ff5-5a76bb12d091.json) | Pass / no_results | 7 | 28,876 / 1,793 | 13.518 / 17.494 | 0.108144 | [已读回](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/55b3a23a-9cbf-403a-93ab-852acadde052/r/83e35bfa-e4b5-4b4b-9ff5-5a76bb12d091?poll=true) |
| [qwen3.7-plus](../../evaluation/r1-results/6122a60d-8963-4889-b2f7-b3ccebddf07d.json) | MODEL_BUDGET_EXCEEDED | 12 | 59,315 / 1,125 | 33.008 / 35.324 | 0.191445 | [已读回](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/55b3a23a-9cbf-403a-93ab-852acadde052/r/6122a60d-8963-4889-b2f7-b3ccebddf07d?poll=true) |
| [deepseek-v4-pro](../../evaluation/r1-results/13adfca1-9ea9-4e5c-a6db-dfcb7819f028.json) | MISSING_DELEGATION | 11 | 51,215 / 1,446 | 18.880 / 22.068 | 0.733300 | [已读回](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/55b3a23a-9cbf-403a-93ab-852acadde052/r/13adfca1-9ea9-4e5c-a6db-dfcb7819f028?poll=true) |

### 应用收敛配置修正后的两次复测

源码指纹 `3b4a1335096c2409870a7c78515fee0e07d2f6adc404da68a34baefb63266ae5`；[批次清单](../../evaluation/r1-model-comparison/3a94c2fc-9dbd-4aab-8d1d-c75dd60bef55.json)。不同指纹的结果不合并推断成功率。

| 模型 | 协议结果 | 请求 | 输入 / 输出 Token | 图运行 / 总耗时秒 | 保守模型费用上界估算 CNY | Trace |
|---|---|---:|---:|---:|---:|---|
| [qwen3.7-plus](../../evaluation/r1-results/d28c4c33-b209-4a70-aade-4c47f85b3b4d.json) | MODEL_BUDGET_EXCEEDED | 12 | 66,434 / 840 | 26.471 / 41.664 | 0.209382 | Unavailable |
| [deepseek-v4-pro](../../evaluation/r1-results/6ecb7c7f-fa09-43a2-9795-99dd11f9c21b.json) | Pass / no_results | 9 | 40,390 / 1,117 | 16.731 / 44.287 | 0.577381 | [已读回](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/55b3a23a-9cbf-403a-93ab-852acadde052/r/6ecb7c7f-fa09-43a2-9795-99dd11f9c21b?poll=true) |

初测每模型只有一次：DeepSeek Flash 1/1 协议完成，其余各0/1；这是单例计数，**不是生产成功率估计**。复测仅针对 Qwen Plus、DeepSeek Pro，各一次，分别0/1和1/1；不能与不同应用版本混合计算稳定性。全部六次 usage 请求计数完整，工具数据为 fixture，不产生真实网页研究结论。费用是保守预算模型计算，不是平台账单，不能按此精确排序性价比。

## 已定位的共同问题与处理

1. **应用配置干扰：** 旧逻辑在第9次模型请求撤回所有普通工具。Qwen Plus 在 web 调用计数仍为0时就被拒绝搜索；DeepSeek Pro 的 write_todos 同样被撤回。Trace 确认当时真正提供的只有 ResearchResult，但模型仍调用旧工具。应用提前撤工具与模型未遵守当前工具集共同出现，不能把问题全部归因于模型。
2. **公开 API 修正：** 通过 AgentMiddleware.awrap_model_call 的 request.override(system_message=...) 从第7次请求提醒剩余预算，保留仍有配额的工具。执行授权、来源限额、12次硬上限和不写行程保持不变。独立复审与233项回归通过；没有修改框架内部或增加重试。
3. **单独的模型输出问题：** DeepSeek Pro 初测的 ResearchResult 参数不是有效JSON，标准解析报告第1行第205列缺逗号；官方适配器标记 invalid_tool_calls 是正确行为。未采用宽松解析或编造修复后的结果。
4. **修正后的观察：** 两次复测都没有被撤工具拒绝或 malformed tool call；DeepSeek Pro 成功完成委派，Qwen Plus仍到达12次调用上限。单次改善不证明因果强度或稳定性，故停止扩样，不增加模型/重试。

原始诊断：[Qwen Plus](../../evaluation/r1-model-comparison/6122a60d-8963-4889-b2f7-b3ccebddf07d-diagnostic.json)、[DeepSeek Pro](../../evaluation/r1-model-comparison/13adfca1-9ea9-4e5c-a6db-dfcb7819f028-diagnostic.json)。诊断只保留工具名、参数类型及有限的无效JSON末尾，不包含密钥或思考过程。

## 数组、日期与推荐质量覆盖边界

DeepSeek Flash及修正后的Pro返回合法数组和 `status=no_results`，明确固定测试来源不足，不捏造真实候选；Main完成ResearchSelection。这验证了一次无结果分支的委派和结构化输出。**候选为空，非空 proposedDate 的真实生成仍为 Not Exercised**；不能把这个结果宣传为日期生成或旅行推荐质量通过。日期拒绝/边界已有确定性测试，真实非空候选仍需真实来源阶段验证。

本次没有观察到全新捏造的工具名；初测发现的是已撤回工具被再次调用。Qwen Plus曾把 write_todos.todos 编码为字符串，该调用因撤回而被拒绝。Qwen Flash发生一次Schema修复后触及40KB输入上限：这是本次应用预算下未完成，不证明API不支持Schema。两次失败的Trace尚未读回时，保留Unavailable，不为补Trace重跑模型。

## 当前决定

- 不扩大到36/54次实验、不切换已验收产品默认模型。
- DeepSeek Flash是下一步少量真实来源测试的优先候选；Pro保留对照。理由限于本次委派完成情况和请求消耗，不称已选定生产模型。
- 下一步先验证非空候选、真实日期和实际证据，再决定批量实验；Qwen重复规划/未在预算内收敛继续按应用工具与提示配置共同排查。
- Claude保持配置/访问Blocked，不计入模型失败率。正式架构选择、真人推荐质量与R2验收均Pending。
