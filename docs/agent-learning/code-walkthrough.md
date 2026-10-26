# 从 CLI 到证据结果：代码导读

以下引用当前 R1 实际文件，不代表所有在线实验已通过。执行结果单独看 [runtime-report.md](runtime-report.md)，避免把设计说明当成验收。

1. [research_fixtures.py](../../evaluation/research_fixtures.py) 的 build_brief 从原四个 persona 或新增山西/北京/上海长者配置构造新的 Pydantic 对象。每次构建互不共享可变状态；task 2 模拟移动活动及部分采纳，保留原 ID、Idea 和九天行程。scenarios() 产生六个业务 Trip × 三任务 = 18；密集上海为额外回归。
2. [research_contracts.py](../../apps/api/agent/research_contracts.py) 的 ResearchBrief 检查 Trip 归属及 contextHash。哈希包含偏好、日期、活动、Ideas 等真实上下文，排除更新时间、版本和未采纳 Suggestions，避免无关元数据变化制造过期结果。
3. [research_cli.py](../../evaluation/research_cli.py) 读取根 .env，检查配置，再通过 BudgetLedger.reserve 预留预算。execute 先写 attempt 记录，再建立 LangSmith trace，运行图，最后 flush/read-back 核对 Trace 并保存状态。未读回不能称为已验证 Trace。
4. [research.py](../../apps/api/agent/research.py) 的 build_research_graph 使用正式 create_deep_agent、ToolStrategy、TodoListMiddleware、StateBackend 和自定义 Middleware。A 直接输出ResearchResult；B/C 的Main仅有快照和task，Research子代理输出ResearchResult，CaptureResearch.aafter_agent保存深拷贝，Main只输出ResearchSelection。C额外提供Skill与临时文件能力。公开handle_errors回调只允许一次schema修复，计入共享预算。
5. ResearchBoundary检查序列化UTF-8输入（基线150KB、候选40KB），计入父子共用预算；从第7次调用起通过公开Middleware附加剩余预算提示。已移除历史第9次一律清空工具策略。执行处仍检查静态allowed与本轮offered，拒绝配额耗尽后撤下的工具、未知工具、错误subagent_type和第二次委派；toolDenials保留证据。结构错误响应usage也计入预算。这是框架扩展点，不替代模型循环。
6. [research_sources.py](../../apps/api/agent/research_sources.py) 的Sources绑定唯一Brief。AMap按目的地限定搜索；Tavily search/extract使用官方SDK。模型工具read_pages只收一个evidence_id，服务端查本次网页证据并映射URL；未知ID拒绝。底层提取URL也必须已观察，并拒绝明显本地/私网/带凭据URL。适配器统一产生证据ID、内容哈希、检索时间、类型和日志。
7. run_research对ainvoke设置180秒总超时。A取最终ResearchResult；B/C要求Main的useResearchResult=true且存在已捕获子结果，再原样验证子结果。检查已读取快照、所需委派、引用和快照未变。网络错误保留安全错误类型；部分白名单错误另有errorCode，schema错误只保留位置/类型；来源不完整不能静默当完整研究。
8. [research_evaluate.py](../../evaluation/research_evaluate.py) 使用 LangSmith Dataset/Examples/aevaluate，18 个固定任务、3 次重复、并发 2；自动 evaluator 只给确定性检查分，humanReview 为 Pending。

## 四个应亲自跟踪的边界

**来源**：Sources.add 分配 ev:... 引用。模型不能通过写一个看似真实 URL 或 ID 创造证据。validate_result 拒绝未观察 ID，但没有自动证明 claim 与原文含义一致。

Candidate.proposedDate已从宽泛字符串改为date | None：schema先拒绝散文或多个备选日期，领域校验再检查Trip起止范围。这属于缩窄输出契约，不由模型自行判断是否满足日期类型。

**权限**：框架 filesystem permissions 只负责框架文件工具。自定义 AMap/Web 工具、Trip 范围、模型次数、禁止采纳分别由适配器和 Middleware 负责。Skills 中的“只读”不能代替服务端限制。

**预算**：[research_budget.py](../../evaluation/research_budget.py) 使用 SQLite 原子预留；保守预留/结算值与供应商账单、唯一 Trace 实际数量是不同指标。未知 usage 不可算成零成本。A/B/C 比较使用实际 token、时间、来源调用和失败记录。

当前基线任务预留4元、4个Trace槽和6个Tavily credits；候选兼容试验统一预留35元并使用40KB输入保护，采用各自预算费率结算，不直接套用Qwen基线价格。旧缺usage记录继续保留当时预留。作者确认的1000免费Tavily credits独立限额。正式aevaluate前另预留56个外层Trace槽；Dataset逐项核对18条输入fingerprint。

CLI按sourceFingerprint/架构/工具模式分组；smoke/compare每轮最多2个任务，两条都失败时熔断，manifest把其余标为Not Run。不能把中止批次当完整对照，也不能合并不同源码版本凑够54次。

[research_models.py](../../evaluation/research_models.py)的build_candidate现使用官方ChatOpenAI、ChatDeepSeek、ChatAnthropic，构造时不发请求，不静默降级到其他模型。[research_model_compare.py](../../evaluation/research_model_compare.py)串行组织同一B/上海长者案例；循环对象是独立case，不是模型/工具轮次。execute仍调用同一run_research。Claude在网络及预算预留前因ToolStrategy强制any不兼容而排除；不能说它已通过。四模型首轮及两次定向复查详见[model-comparison.md](model-comparison.md)。

这一实现对应Academy M1.3模型适配、M1.5正式工具、M4.1 task委派、M5.3使用create_deep_agent组装应用；没有另起Agent Harness、HTTP推理循环或宽松JSON兜底解析。

**写入**：R1 不调用 Workspace 采纳命令，也不把候选自动转换成 Activity。现有产品 [service.py](../../apps/api/agent/service.py) 与领域采纳流程仍独立。UI 接入必须先生成可审阅 Suggestion，再让用户触发原有命令。

## 对应测试入口

| 文件/命令 | 检查什么 | 不证明什么 |
|---|---|---|
| [test_research_contracts.py](../../evaluation/test_research_contracts.py) | 18任务/7Trip、旧 persona、编辑变体、跨 Trip、哈希、假引用、日期、POI/体验区分 | 推荐是否符合真实偏好或官方规则 |
| [test_research_runtime.py](../../evaluation/test_research_runtime.py) | 非法工具、共享预算、官方 task/ToolStrategy、Skill/权限、来源配额与异常 | 真实 Qwen 或网页稳定性 |
| research_cli ... --replay | 真实 Qwen + 固定工具，隔离模型/框架问题 | 真实外部来源或旅行事实 |
| research_cli ... | 实际供应商调用、延迟、引用、Trace | 自动等同真人质量验收 |

ToolFake 只用于确定性组件测试，必须与 live 分开。故障注入通过替换适配器依赖实现；没有虚构的 --faults CLI 开关。
