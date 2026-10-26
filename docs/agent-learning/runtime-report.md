# R1 工程与运行检查点

2026-10-26。R1 的 CLI、官方 Deep Agents A/B/C 图、只读研究契约、证据适配器、预算和 LangSmith 评测入口已实现。**R1 尚未验收，R2 未开始。** 以下区分工程测试、真实来源探针、模型兼容性和人工推荐质量。

## 运行方式

在 `E:\CodexRepo\projects\BrandonTravel2`，`.env` 已准备并被 Git 忽略。六个平台 Key 已填写；可选 workspace ID 和价格覆盖项为空不代表缺少必需 Key。Claude 的访问与 ToolStrategy 兼容性问题见 [模型对照](model-comparison.md)。

```powershell
uv sync --frozen
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m evaluation.research_cli summary
# 真实 Qwen + 高德 + Tavily，会使用已批准的 API 额度
.\.venv\Scripts\python.exe -m evaluation.research_cli demo --trip hangzhou --task 1 --architecture A
# 真实模型 + 固定工具的协议隔离测试，不是实时旅行研究
.\.venv\Scripts\python.exe -m evaluation.research_model_compare
```

真实 Demo 路径：选择合成 Trip → get_trip_snapshot → 地点/网页来源 → ResearchResult → 服务端引用/日期/上下文验证 → 保存本地运行记录及 LangSmith Trace。B/C 增加 Main 的官方 task 委派；C 使用只读 Skill 和 StateBackend。CLI 不连接 Workspace 数据库，不产生已确认行程写入；Ideas/Itinerary 接入属于 R2。

## 已执行检查

- 全量 Python：**233 passed，8.47 秒**，包含原有 Workspace/Agent 基线、新研究契约、真实框架 Fake Model 测试、官方适配器、候选执行路径、预算和权限回归。
- `uv lock --check --offline`：通过，77 个包；锁定 Deep Agents0.7.32、LangChain1.4.7、LangGraph1.2.17、LangSmith0.14.12 及模型适配器。不是声称在全新机器上已重装验证。
- 前端 build：本阶段此前已通过，保留552.96KB体积警告；本轮是 CLI/后端研究改动，未新增 UI 功能或重新做浏览器视觉验收。第一轮截图、浏览器结果保留，不能当作新增 Research UI 的测试证据。
- 独立 Code Review：已修复所发现的预算预留、SDK重试、数据集内容验证、SQLite连接关闭、候选元数据及 Claude 调用前阻断问题；参见 [审查记录](review-r1.md)。
- 真人推荐评分、架构讲解和产品验收：**Pending**。没有用 AI 评分替代作者或 Advisor。

## 已有真实来源 Demo

以下为不同修订下的成功探针，用于查看实际调用链，不能合并计算当前版本成功率：

| 路径 | 原始记录 | 已验证 Trace |
|---|---|---|
| A 杭州研究 | [e0137baf](../../evaluation/r1-results/e0137baf-830a-4e2c-b1b5-6a804cd73de1.json) | [查看](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/55b3a23a-9cbf-403a-93ab-852acadde052/r/e0137baf-830a-4e2c-b1b5-6a804cd73de1?poll=true) |
| B 成都委派研究 | [0d9736df](../../evaluation/r1-results/0d9736df-2d78-4a16-a756-17ae5a911bb2.json) | [查看](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/55b3a23a-9cbf-403a-93ab-852acadde052/r/0d9736df-2d78-4a16-a756-17ae5a911bb2?poll=true) |

B 成都曾用176.135秒，接近180秒上限，不称稳定。所有失败尝试均保留在 `evaluation/r1-results/`，包含最早超时、数组编码错误、日期文字错误以及预算终止；版本通过 sourceFingerprint 分开。

## 目前不通过的门槛与后续顺序

1. 模型小批对照及共享失败的应用层诊断见 [model-comparison.md](model-comparison.md)，先看证据，不按参数规模选择模型。
2. A/B/C 36 次公平架构对照、选定架构54次正式 Dataset/Experiment：**Not Run**；入口已实现、离线测试通过不等于正式实验通过。不得宣称达到51/54。
3. 真实来源推荐质量需要作者审阅证据与取舍；代表性材料见 [human-review.md](human-review.md)，全部评分保持 Pending。
4. LangSmith 某些读取/上传曾遇网络错误。只展示已从服务端读回的 Trace URL，不为补 Trace 重跑模型。直接连接曾返回200、配置代理曾 ConnectError，属于网络诊断，不能归因于千问质量。

暂无充分证据选择 A/B/C 最终架构或宣布某个模型稳定。小批兼容性失败解决后才决定扩大实验；不增加重试次数、不修改框架内部实现、不自动进入 R2。

<!-- ACTUAL_TOTALS -->

## 本检查点累计记录

- 共29个任务记录：23个既有探针/真实来源尝试，加本次6个真实模型与固定工具兼容性任务。历史失败不删除，不跨版本合并成功率。
- 服务端读回22条根Trace；其余保留未验证状态。
- 既有探针已知usage按Qwen公开价格估算约¥1.323918，含部分usage缺失，不能当完整账单。本次模型小批保守费用上界估算合计¥1.879879，与前者口径不同，不直接相加宣称实付。
- 台账占用：116/1000 Trace预留；Tavily credits上界84/1000（含固定工具模拟任务的保守占用，不等于真实API消费）；现金预算记账¥59.1757/100。现金记账包含早期未知usage保留的¥45及其他保守预留，**不是花费¥59**。
- 六次模型兼容性结果及每次Token/耗时/费用/Trace完整列于[模型对照报告](model-comparison.md)。真实非空日期生成、正式54次门槛和人工质量依旧未完成。
