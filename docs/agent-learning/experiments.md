# R1 实验手册与已知执行事实

本页提供可复现步骤；最终累计数量、批次结果和架构选择以 [runtime-report.md](runtime-report.md) 及原始 JSON 为准。**命令存在不代表已经执行；单次兼容性通过不代表研究质量通过。**

## 准备与无需外部 API 的检查

在仓库根 `E:/CodexRepo/projects/BrandonTravel2` 使用现有虚拟环境。根 `.env` 中的 Key 只由后端加载，不打印、不提交。真实模式需要 DASHSCOPE_API_KEY、LANGSMITH_API_KEY、AMAP_WEB_SERVICE_KEY（以现有配置名为准）和 TAVILY_API_KEY；以 CLI preflight 为最终检查。模型继续使用配置的 qwen3.8-flash。

```powershell
.\.venv\Scripts\python.exe -m pytest evaluation/test_research_contracts.py evaluation/test_research_runtime.py evaluation/test_research_budget.py evaluation/test_research_evaluate.py -q
.\.venv\Scripts\python.exe -m evaluation.research_cli fixtures
.\.venv\Scripts\python.exe -m evaluation.research_cli summary
```

fixtures 只构建合成状态；summary 只读已有记录。现有第一轮测试仍需保持，不以新增研究测试替代 Workspace、Agent、浏览器回归。

## 最短真实 CLI Demo

```powershell
.\.venv\Scripts\python.exe -m evaluation.research_cli demo --trip hangzhou --task 0 --architecture A
.\.venv\Scripts\python.exe -m evaluation.research_cli demo --trip hangzhou --task 1 --architecture A
.\.venv\Scripts\python.exe -m evaluation.research_cli demo --trip hangzhou --task 1 --architecture B
.\.venv\Scripts\python.exe -m evaluation.research_cli demo --trip beijing --task 1 --architecture C
```

task 0 是只读状态分析；task 1 是偏好研究；task 2 是“用户已移动/部分采纳后的最新状态”研究。密集行程回归可选 `--trip shanghai_dense --task 0`，九天跨周可选 `--trip xian --task 2`。这些命令会消耗模型/API/Trace 额度，只在需要验证相应差异时执行。

查看 `evaluation/r1-results/<runId>.json` 的 brief、result、evidence、sourceEvents、toolCalls、status、errorType、traceVerified、traceUrl、token/秒数。核对真实网页日期和 claim，再决定是否可推荐；不要只看最后一句回答。

## 分层批次

```powershell
.\.venv\Scripts\python.exe -m evaluation.research_cli smoke --architecture A
.\.venv\Scripts\python.exe -m evaluation.research_cli compare
.\.venv\Scripts\python.exe -m evaluation.research_cli evaluate --architecture A
```

smoke 为 6 个任务；compare 为 6 个复杂场景 × A/B/C × 2 次 = 36；evaluate 为 18 个固定任务 × 3 次 = 54。evaluate 的架构参数应替换为证据支持的选择，A 完全允许。批次计划不是已运行数量；失败/阻塞也保留，不能只统计成功样本。

`--replay` 使用**真实 Qwen + 固定工具返回**，便于隔离供应商波动；它不是缓存真实网页回放，更不是 live 数据源验收。L1 fake model 与 replay 都必须单独标记。确定性故障注入在 pytest 中执行，不额外浪费模型配额。

## 已执行的兼容性证据

集成负责人报告的启动探针：真实 Qwen 通过官方 task + ToolStrategy，4 次模型调用、2,347 input tokens、188 output tokens、5.22 秒，工具为 fixture、Trace 关闭。此记录只支持模型/框架协议兼容，不能作为真实研究 Trace。

本地 Memory、Filesystem、Skills、权限、Planning 探针经修正后 7 项通过；旧 Agent 基线 20 项通过。这些初始探针的依据是执行会话记录，没有独立归档的探针文件，不能虚构下载链接。Planning 必须显式加入 TodoListMiddleware，这是课程/0.7 API 的预期行为，不是需要修补框架内部的缺陷。正式可重复回归入口是本页 pytest 文件。

集成负责人最新完整运行pytest：**233 passed / 8.47秒**；前端build通过，但保留552.96KB产物体积警告。此前159/174项属于旧版本，不替代最新回归。这些结果不代表36次对照、54次正式评测或真人质量通过；后续改动的最终检查以runtime-report为准。

此前3项SQLite连接关闭回归已纳入后续完整测试。替代模型现在通过官方ChatOpenAI 1.7.2、ChatDeepSeek 1.1.1、ChatAnthropic 1.7.6构造；基线CLI与独立兼容性CLI分开，产品默认模型没有自动切换。模型构造成功、真实协议通过和旅行质量通过是三个不同结论。

## 当前真实运行进度（不是最终验收）

| 原始记录 | 结果 | 解释 |
|---|---|---|
| [A 杭州研究 e0137baf](../../evaluation/r1-results/e0137baf-830a-4e2c-b1b5-6a804cd73de1.json) / [Trace](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/55b3a23a-9cbf-403a-93ab-852acadde052/r/e0137baf-830a-4e2c-b1b5-6a804cd73de1?poll=true) | Pass；8次模型调用，91.132秒；Trace已读回 | 真实模型和来源的单次成功，不是A最终胜出 |
| [B 成都研究 0d9736df](../../evaluation/r1-results/0d9736df-2d78-4a16-a756-17ae5a911bb2.json) / [Trace](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/55b3a23a-9cbf-403a-93ab-852acadde052/r/0d9736df-2d78-4a16-a756-17ae5a911bb2?poll=true) | Pass；10次调用，176.135秒；Trace已读回 | 成功但接近180秒上限，不能称稳定 |
| B六任务smoke，sourceFingerprint前缀e833d8aa | 3/6 Pass；山西/杭州直接分析、成都研究通过；北京/上海长者/西安研究失败 | 三个失败均达到12次调用；实际数组参数错误循环是修订依据，不删除失败 |
| 更早B smoke，fingerprint前缀66b6f130 | 前两项StructuredOutputValidationError，批次停止 | 与后来的6项smoke分组；剩余Not Run，不合并成同一批 |
| 正式A/B/C36次对照、选定架构54次评测 | **Not Run（本页更新时）** | 不从零散Demo推断技术门槛达标；人工质量仍Pending |

上述成功样本与当前修订不是同一sourceFingerprint，不能当成最新代码重测结果。最新修订：CaptureResearch.aafter_agent保留原子结果、Main只给ResearchSelection；read_pages改为单一evidence_id；ToolStrategy最多修复一次；显式JSON根字段；Qwen流式、5000输出token、75秒调用超时，180秒/12次总上限不变。后续运行必须单独记录并按源码fingerprint比较。

基线CLI的smoke/compare每轮最多2个任务，两条都失败则停止并写manifest，其余Not Run。基线新任务预留4元、150KB输入保护；候选试验统一35元预留、40KB输入保护，两者各留50KB框架余量，都是预算保护而非账单。旧缺usage预留继续保留。Tavily1000免费credits与LangSmith1000 traces分开，不能为跑满数量绕过预算。

### 最新有限探针：结构通过，Trace未验证

| 原始记录 | 模型调用 / 用时 | 当前证据状态 |
|---|---|---|
| [A 上海长者 79518db8](../../evaluation/r1-results/79518db8-e7f4-41d8-b17b-61a9f22e37e2.json) | 8次 / 51.473秒 | status=Pass；traceVerified=false，无已验证Trace链接 |
| [B 北京 17228d70](../../evaluation/r1-results/17228d70-e2d6-4e36-abb2-5926095fb274.json) | 12次 / 88.28秒 | status=Pass；traceVerified=false，达到调用次数上限 |
| [C 杭州 f76e27c0](../../evaluation/r1-results/f76e27c0-ffe8-4c18-af83-d7b25a69e14c.json) | 11次 / 75.06秒 | status=Pass；traceVerified=false，无已验证Trace链接 |

三者同一sourceFingerprint前缀29ac8989；它们不是同场景对照，也不属于36/54正式批次。按现有确定性评估，Trace未验证会使scenarioPass失败。本页不猜测上传失败原因，也不生成未验证URL冒充证据。后续若原始记录完成读回，以运行报告记录恢复依据。

历史版本曾在第9次调用撤下全部检索工具，最新已取消，改为第7次起经公开Middleware提示剩余预算。12次硬上限、来源配额、allowed/offered执行检查不变；配额撤下后的工具仍拒绝。proposedDate保持date | None。纠正后的两次定向重测与旧版本隔离，详见[model-comparison.md](model-comparison.md)。

### 四模型有限兼容试验（不是实时旅行质量评测）

同一B/上海长者案例，真实模型+固定工具，首轮fingerprint前缀8a9f530f：Qwen Flash因输入上限失败；DeepSeek Flash结构Pass、no_results、7次调用/13.518秒；Qwen Plus达到12次预算失败；DeepSeek Pro因无效JSON/缺有效子结果失败。无候选的结构通过不证明推荐有效，也没有测试非空日期推荐能力。

两次定向重测已完成：Qwen Plus（d28c4c33）因12次预算失败，26.471秒，未出现拒绝/无法解析的工具调用，Trace未验证；DeepSeek Pro（6ecb7c7f）结构Pass，9次/16.731秒，同样无上述工具错误，Trace已验证，但result=no_results且候选为空。非空日期生成为Not Exercised，不能把结构通过当推荐质量通过。六条pilot原始记录与链接见[model-comparison.md](model-comparison.md)，人工审阅材料见[human-review.md](human-review.md)。

Claude Agent试验仍Not Run：ToolStrategy强制any与Sonnet5.5不兼容，调用前排除；Key格式纠正后模型列表仍HTTP403，不据此归咎模型质量。本轮停止扩展，不新增36/54批次；产品基线不变，R1/R2验收和人工质量均Pending。

复现入口为`.\.venv\Scripts\python.exe -m evaluation.research_model_compare`；支持`--profiles`选择命名候选。它只组织独立测试案例，真实模型/工具循环仍由create_deep_agent和task执行。课程对应M1.3/M1.5/M4.1/M5.3见[course-mapping.md](course-mapping.md)。本学习文档刷新没有发起额外API请求。

## 第一条真实研究失败样本（保留，不覆盖）

原始记录：[b26e219a-1407-4ff4-a398-68e5a0e6ea25.json](../../evaluation/r1-results/b26e219a-1407-4ff4-a398-68e5a0e6ea25.json)。杭州 task 1、B、真实 Qwen + 真实工具，最终 **Fail / OpenAITimeoutError**，160.712 秒，11 次模型尝试，已记录 150,999 input / 924 output tokens；其中一部分请求缺 usage，不能把已知 token 当成完整账单。来源调用 AMap 2、Web 4、extract 3，Tavily 记账 5 credits。

Trace 已读回：[失败运行 Trace](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/55b3a23a-9cbf-403a-93ab-852acadde052/r/b26e219a-1407-4ff4-a398-68e5a0e6ea25?poll=true)。它证明真实调用和失败可追踪，不证明 Demo 成功。大量上下文及预算耗尽后的工具重复是后续收敛改动的依据；是否改善必须看新 attempt，不能回写此失败为成功。

## 作者亲手完成的三个小实验（Pending）

1. 同一个 task 1 对照 A/B，打开 Trace 找 task 子树，解释 token 和失败差异；允许结论是 A 更合适。
2. 运行权限测试，确认未知写工具没有执行 handler；在 C 测试中观察 Skill 可读、不可改写。解释为什么系统提示词不够。
3. 比较同一 Trip task 1/task 2 的 brief.contextHash、活动日期和已采纳项，确认最新状态取代旧聊天理解；说明 R2 采纳前仍需再查当前哈希。

作者是否实际完成、对推荐质量的评分和架构解释均为 **Pending**，不由 Codex 代签。
