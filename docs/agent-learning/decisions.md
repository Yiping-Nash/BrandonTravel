# R1 决策记录

日期：2026-10-26。批准依据：[PLAN.md](../../PLAN.md) 及用户最后三项调整。技术实现由工程团队完成；产品验收与真实人工评分由作者/Advisor 完成。

| 决策 | 依据与取舍 | 当前状态 |
|---|---|---|
| 以正式 create_deep_agent/task/ToolStrategy/Backend/Middleware 实现 | 0.7.32 本地接口与官方文档相符；不修改框架内部、不手写模型循环 | 已实施于 R1 |
| A/B/C 都是有效候选，R1 通过与赢家解耦 | 同预算研究产品能力；不为证明 Subagent 优越而设计评分 | 已批准；最终赢家待实验 |
| 只有一个 Research 类型 | 目前只需要偏好研究，不增加 planner/verifier/writer 多角色 | 已实施 |
| B/C原样保留Research子结果 | 用公开CaptureResearch.aafter_agent保存结构化对象，Main只返回ResearchSelection，减少抄写引入的schema/引用错误 | 最新修订已实施；完整真实回归未完成 |
| read_pages只接收单一证据ID | 真实Qwen多次把URL数组编码为字符串；服务端从已观察证据映射URL，保持来源边界 | 最新修订已实施；旧失败保留 |
| 一次官方结构修复 | ToolStrategy公开handle_errors回调、共享计数；显式根字段和原生JSON数组，不手工宽松解析 | 已实施；仍受12次/180秒限制 |
| 执行层检查动态工具可用性 | 配额耗尽时撤下工具；调用必须属于allowed和本轮offered。取消历史第9次一律清空策略，改为第7次起提醒预算 | 已实施，12次硬上限不变；详见model-comparison |
| 单一强类型候选日期 | proposedDate采用date或null，拒绝多个备选日期和解释文字，再校验Trip范围 | 已实施 |
| 正式适配器复用同一图 | 官方ChatOpenAI/ChatDeepSeek/ChatAnthropic；比较CLI组织独立案例，不组织模型工具循环 | 四候选有限试验已执行；Claude因ToolStrategy不兼容排除，产品模型未自动切换 |
| 单项状态问题直接回答 | 避免简单日程分析支付委派开销；仍需读取最新快照 | 已实施 |
| Evidence 由工具适配器创建，模型仅引用 | 防止凭空 ID/地点；结构校验不能代替语义真实性判断 | 已实施，人工支持性检查 Pending |
| R1 只使用独立合成 Trip，结果不写 Workspace | 保持第一轮权威状态及用户采纳边界 | 已实施；R2 尚未接入 |
| C 使用只读 Skill 与 StateBackend 临时文件 | 学习并测量渐进加载/笔记价值；不读取宿主仓库、不开放 execute | 已实施；收益待实验 |
| 不引入持久 Memory | 偏好已有 Trip 权威来源；避免跨用户泄漏与自动学习错误偏好 | R1 不做 |
| 正式 AsyncSubAgent 仅审阅 | 需要 Agent Protocol 运行服务；当前 CLI 不需要持久异步基础设施 | Not Run；不阻塞同步 R1 |
| AMap + Tavily，官方规则按需提取 | POI 是位置依据，网页是带日期事实/体验来源；不互相冒充 | 已有真实调用，稳定性看运行报告 |
| 小红书不作为必需依赖 | 社区浏览器自动化不等于官方查询 API 或获准采集；账号/平台权限未核实 | 本轮不接入 |
| 额度作为上限 | LangSmith1,000 unique traces、作者确认的Tavily1,000免费credits分开；R1 API支出上限100元 | 基线150KB/4元预留，候选40KB/35元统一预留，均有框架余量；旧缺usage预留不改，不为花完预算增加测试 |
| 自动检查与质量判断分开 | Pass schema/引用不代表推荐优质；AI 整理不能冒充人 | humanReview=Pending |

## 架构选择记录要求

最终选择应链接固定任务、A/B/C 36 次对照和选定架构 54 次评测，包含所有失败、缺失 usage、来源波动、延迟和费用估算限制。如果批次未完成或来源阻塞，状态写 Incomplete/Blocked，不凭单条成功宣布胜出。A 的可靠性、成本和质量更合适时选择 A；B/C 只有获得实际收益才增加其维护成本。

第一条真实 B 研究出现超时，详见 [experiments.md](experiments.md)。这说明需要控制上下文和收敛，并不能单独证明 B 不可用或 A 更好。任何调参后结果应单独记录 revision，防止不同配置混入同一公平对照。

真实研究历史：A杭州与B成都曾成功，后者176.135秒接近总超时；一个完整B smoke cohort为3/6通过；更早结构错误中止批次不混入该cohort。最新完整pytest为233 passed / 8.47秒，前端build保留体积警告。正式36/54仍Not Run，不足以选定架构或宣布R1验收。

有限探针A长者/B北京/C杭州当时status=Pass但Trace未验证，不能覆盖历史失败。固定工具四模型首轮只有DeepSeek Flash结构通过且no_results；移除第9次清空工具策略后的两次定向复查已完成：Qwen Plus仍达到12次预算失败，DeepSeek Pro结构通过且Trace已验证，但no_results、候选为空。两者均未出现拒绝/无法解析的工具调用，非空日期生成未覆盖。六条pilot不产生真实研究质量或模型赢家结论，不扩展36/54，不改变产品基线；[model-comparison.md](model-comparison.md)与[human-review.md](human-review.md)保留证据和Pending人工结论。

## R2 之前仍需确认的结果

- 自动技术门槛：原有回归与新检查通过，54 次中至少51次、每场景至少2/3，零越权/串 Trip/假引用/工具绕过，Trace 可查。
- 人工质量门槛：作者评阅代表性候选及来源；评分均值目标4/5、每Trip3.5/5。未完成保持 Pending。
- 展示证据与候选的最小 UI 接入，不改变 Board/Day/Week 权威语义。没有通过验收前，不自动开展 R2 产品集成。

以上延续已批准计划，不要求重新开展产品设计或增加新的架构决策会议。
