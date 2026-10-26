# R1 评测与人工审阅指南

确定性检查由程序运行；Codex 整理失败样本、证据和可选 AI 辅助评价。**没有作者实际评分就没有真人评审结论。** 本轮每条记录的 humanReview 默认 Pending。

## 数据集与真实场景

[research_fixtures.py](../../evaluation/research_fixtures.py) 生成6个业务Trip，每个3种任务（只读分析、复杂研究、编辑/部分采纳后再研究），共18个不同输入；基础日期固定2026-11-02，可重新构建，但固定日期不保证未来规则有效。第7个密集上海保留第一轮过满/冲突回归。

| Trip | 必须考查的偏好与状态 | 人工应判断的研究质量 |
|---|---|---|
| 山西古建摄影 | 木构/摄影、每日密度、已确认晋祠、不凭空定跨城车程 | 建筑主题匹配、不同候选取舍、位置与开放证据 |
| 杭州亲子 | 午休、每天最多两个主要活动、雨天只是条件假设 | 儿童适配与室内替代，是否为了多列地点挤掉休息 |
| 成都美食 | 同行辣度差异、不早起 | 可操作的辣度沟通与选择、体验与广告未知的表达 |
| 北京文化 | 已确认安排、计划不等于预约 | 官方规则的适用日期、来源冲突、是否承诺未证实开放 |
| 上海长者 | 短步行、休息、设施与台阶不明 | 无障碍证据是否真实，是否明确需要电话确认 |
| 西安九天独旅 | 跨周、第八九天、已采纳项、返程 | 不重复、文化价值、合理日期与留白 |
| 密集上海回归 | 已定时间重叠 + 未定时活动仍存在 | 是否实际指出已有冲突而非空泛说“可以放松” |

## 自动评测的职责和盲区

[research_evaluate.py](../../evaluation/research_evaluate.py) 的 deterministic_checks 检查结构引用、快照不变、模型/来源预算、快照读取、复杂研究有真实网页返回及候选、没有采纳/写日程工具。L0/L1 另验证跨Trip、假引用、日期、技能权限、异常、预算预留和官方图能力。

record.status=Pass 是运行/结构校验结果；scenarioPass 才是所有场景确定性检查的合取。partial 可以是诚实降级，但其推荐是否足够有用仍由质量评阅决定。没有真实网页或候选的复杂研究即使 JSON 合法，也不应被视为完整产品场景通过。

自动检查**不证明**：原文支持 claim 的语义、网页发布者可信、资料仍适用未来出行日期、偏好取舍合理、无障碍确实存在、内容没有广告。URL 有效、引用存在、模型说已验证都不等于这些事实已成立。

## LangSmith 流程

1. fixtures 的序列化内容产生 fingerprint，Dataset 名称带 fingerprint；18 个 Example 的 inputs 保存 Brief，reference outputs 仅标注写入边界和人工Pending，不伪造“标准推荐”。
2. 正式 `Client.aevaluate` 运行 target，3次重复、并发2；target 调用同一 CLI execute，不建立另外一套推理逻辑。
3. metadata 标注 synthetic、architecture、dataset_fingerprint、human_review；确定性 evaluator 返回9项检查与总分（包括 trace_verified），不调用 AI judge。
4. result 关联 Dataset/Experiment 和逐次 Trace。Trace flush/read-back 后才能标记 verified；子 span 不重复算 unique trace，评测外层根 trace/重试也须纳入总额度。
5. 对照相同场景、revision、模型、数据工具和总预算；报告所有失败及阻塞，不能用重跑成功覆盖原记录。真实工具与 fixture 工具的结果分组。

当前实现也逐项核对远端18条输入内容，拒绝数量正确但内容被改写的数据集；在aevaluate启动前额外预留54个target根Trace及2个编排槽。summary按sourceFingerprint、架构和工具模式分组，只对完整18×3的正式evaluation cohort计算放行门槛。smoke/compare的熔断manifest保留Not Run；零散Demo、不同源码版本、提前中止批次不能拼凑51/54。

当前学习样本包含A真实研究成功、B真实研究成功和B六任务smoke的3个失败；这些足够分析数组参数、超时、schema修复和重复结构化输出问题，**不足以作正式A/B/C优劣结论**。最新代码用CaptureResearch保留子结果、Main只选择，read_pages接收单证据ID；新旧结构不能混作同一实验。正式36/54执行状态以运行报告为准。

新增有限探针（fingerprint前缀29ac8989）：A上海长者8次/51.473秒、B北京12次/88.28秒、C杭州11次/75.06秒，三者status=Pass但traceVerified=false。确定性评估的trace_verified项因此失败，不能把它们叫作scenarioPass或完整真实闭环通过。B恰好到12次上限，可靠性余量仍需验证。这三项不同场景也不能直接相互排名架构。

当前完整pytest为233 passed / 8.47秒，包含此前新增回归；人工质量仍Pending。动态offered权限、强类型单日期、来源及硬预算保持自动门槛。历史第9次清空工具策略已移除，改为第7次起预算提醒；新旧sourceFingerprint必须分组。

四模型兼容试验使用相同B/上海长者Brief、真实模型、固定工具、40KB输入及12次/180秒边界：首轮DeepSeek Flash结构Pass但no_results；其余输入上限、预算或子结果JSON失败。这个Pass不包含有用候选、真实来源或真人质量。两次定向复查只针对Qwen Plus/DeepSeek Pro，不把新旧配置结果混合排名。Claude在ToolStrategy不兼容检查前被排除，Agent试验Not Run，HTTP403模型列表不是质量分。详见[model-comparison.md](model-comparison.md)。

两次定向复查现已完成：Qwen Plus预算失败且Trace未验证；DeepSeek Pro结构Pass、Trace已验证，但no_results/空候选。两者都没有拒绝/无法解析的工具调用；这支持诊断部分协议问题，不证明有用推荐。非空日期生成标Not Exercised。六条pilot的可审阅材料见[human-review.md](human-review.md)，人工质量与R1/R2验收仍Pending，不再追加实时测试。

比较模块只调度case，模型与工具轮次完全由Deep Agents执行；对应课程M1.3模型、M1.5工具、M4.1委派、M5.3应用组装，见[course-mapping.md](course-mapping.md)。不得为修复一次兼容失败引入自写Harness，也不得为了跑满预算扩大样本。

正式依据：[Evaluate an application](https://docs.langchain.com/langsmith/evaluate-llm-application)、[Observability concepts](https://docs.langchain.com/langsmith/observability-concepts)。添加 feedback 可能影响保留期/计费，预算口径以 [LangSmith billing](https://docs.langchain.com/langsmith/billing) 与账户实际使用为准。

## 作者审阅卡（待填写）

每个Trip至少选一条代表性成功结果；另选全部主要失败类型、来源不全、信息冲突和最差结果。A/B/C 对比使用同一场景并排显示，包含全部候选、证据摘录/链接/检索日期、工具轨迹和成本/延迟，不只展示最佳输出。

| 字段 | 填写规则 |
|---|---|
| taskId / runId / architecture / revision | 从原始结果取，不手工猜测 |
| Trace / 原始 JSON / 关键 Evidence | 可点击并可追溯；没有来源写 Missing |
| 偏好匹配、证据支持、可操作性、不确定性表达 | 每项1–5分；空值=未评，不是0分 |
| 1分锚点 | 明显违背硬约束、捏造关键事实或不能使用 |
| 3分锚点 | 基本相关，但取舍笼统、来源弱或关键缺口较大 |
| 5分锚点 | 紧贴偏好/当前Trip、证据支持、未知明确、足以帮助决策 |
| reviewer / reviewedAt / notes | 作者真实填写；Codex 只能标注 AI-assisted 的独立意见 |
| humanReview | Pending / Reviewed；没有真实 reviewer 保持 Pending |

质量平均分只对已人工评阅项计算，同时报告覆盖率；禁止把未评项填满或把AI评分当成作者评分。作者可要求展开疑点来源，不需审阅全部96次任务。

## 放行规则

技术门槛与架构赢家分离：原有/新增确定性检查通过，选定架构54次至少51次 scenarioPass、每场景至少2/3，零未经授权写入/串Trip/伪造证据引用/工具绕过，记录与Trace完整。人工判断独立 Pending，质量目标均值4/5、每Trip3.5/5；人工未完成时不能宣称R1最终验收，也不自动进入R2。
