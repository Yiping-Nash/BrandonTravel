# Academy M1–M6 与 R1 的对应关系

核对日期：2026-10-26。课程本地根目录为 `E:/CodexRepo/projects/lca-deepagents`；下表中的课程路径均相对此目录。正文为 `thinkific/src/` 的 Python 课程内容，源码为 `python/`。已审阅六个模块的正文及核心 Python 实现；不是观看视频、运行所有课程实验或完成真人考核的证明。

## 版本及阅读范围

本地共有 M1–M6 **26 个正文单元、87 个 Python 文件**（包括辅助文件）。课程根 `python/pyproject.toml` 固定 Deep Agents **0.7.0**；M6 的独立项目固定 `managed-deepagents==0.8.3`。BrandonTravel 实际环境是 Deep Agents **0.7.32**，不能把课程固定版本、当前网页和本地安装包视为同一版本。

| 单元 | 已读内容与本项目的应用 |
|---|---|
| M1.1 Overview | Harness 包含模型、工具、上下文管理；不自行实现推理循环。0.7 的 Planning 为显式启用。 |
| M1.2 Running a Deep Agent | `create_deep_agent(...).invoke/ainvoke` 是入口；最终消息不等于已验证的领域对象。 |
| M1.3 Models | 采用模型适配器，Qwen 必须实际验证 tool calling；不照搬 Anthropic 专属缓存/计价结论。 |
| M1.4 System prompt | 显式写只读、证据和未知信息规则；提示词不能承担授权职责。 |
| M1.5 Tools | `@tool`、结构化参数、自定义工具与框架工具并存；课程 SQL 示例的“只读”只是约定，不能直接用于生产权限。 |
| M1.6 MCP | 审阅 HTTP/MCP、工具筛选和 OAuth 模式；当前 AMap/Tavily SDK 足够，不为旅行研究额外引入 MCP 服务。 |
| M1.7 Messages/threads/checkpointers | 同一 `thread_id` 关联检查点；`MemorySaver` 是进程内状态，不是 Trip 数据库。 |
| M1.8 HITL | `interrupt_on` + `Command(resume=...)`；课程发送邮件工具是 mock。既有 Workspace 用户采纳命令继续作为写入边界。 |
| M1.9 Practice | 审阅综合示例；persona、工具、检查点和人工确认组合不能替代领域校验。 |
| M2.1 Environment | 工具能访问的环境由 Backend 与能力决定，模型文字不是隔离层。 |
| M2.2 Filesystem backends | State/Filesystem/Composite Backend、permission rules；R1 C 只使用内存文件。 |
| M2.3 Sandboxes/LocalShell | 云 Sandbox 的创建、初始化、执行、清理；LocalShell 的目录配置不是操作系统隔离。R1 不开放 Shell。 |
| M2.4 Interpreter | QuickJS 与程序化工具调用；不为有限旅行研究任务增加任意代码执行。 |
| M3.1 Summarization/context offloading | 摘要改变模型可见上下文，offloading 把大工具内容移到文件；保留来源和读取入口。课程强制缩小 profile 的做法仅用于演示。 |
| M3.2 Skills | YAML name/description 自动发现、正文按需读；C 使用只读 travel-research Skill。Skill 元数据不是安全边界。 |
| M3.3 Memory | `memory=[...]` 与 StoreBackend namespace；不同用户/Trip 不能共用无作用域记忆。R1 不实现偏好自动长期学习。 |
| M4.1 Delegation | 正式 task、子代理独立消息上下文、显式 Planning；文件与状态是否共享需另行设计。 |
| M4.2 Subagent team | Newsletter 的 editor + researcher 和工具收窄；本项目只比较一个 Research 类型，不照搬多研究者 fan-out。 |
| M4.3 Dynamic delegation/RLM | 对大语料程序化拆分、聚合与覆盖率；R1 候选有限，不采用 RLM、QuickJS 批量 task 或额外角色。 |
| M5.1 Putting it together | Sales assistant 综合案例；工具、权限、会话和运行时是不同层。 |
| M5.2 Local deployment | langgraph.json、Agent Server、assistants/threads/runs/store；本项目现有 FastAPI 不自动具备这些协议能力。 |
| M5.3 Sales assistant | make_graph、MCP mock mail、Skills、专项子代理、HITL；不复制邮件、SQL 和多写入角色。 |
| M5.4 Async subagents | AsyncSubAgent 通过 Agent Protocol 发起/检查/更新/取消任务；不是简单 asyncio.create_task。 |
| M5.5 Sandbox async agent | 每 thread 沙箱、初始化、TTL 和 async research；研究产物通过受控读取返回，不扩大到宿主目录访问。 |
| M6.1 Managed Deep Agents | 托管 Agent Server/Harness/Sandbox/上下文分发的职责；不等于必须迁移部署。 |
| M6.2 Deploying with MDA | 审阅 DVD analyst 的 identity、sandbox、instructions、Skill、channel、部署配置；R1 不部署托管资源或连接 Slack。 |

## 可定位的课程代码

| 模块 | 主要参考路径 | 学到的边界 |
|---|---|---|
| M2 | `python/m2/m2.2_agent.py`、`m2.3_sandbox_agent.py` | Composite 路由和只读目录；沙箱生命周期与宿主文件不混用。 |
| M3 | `python/m3/m3.1_summarization.py`、`m3.2_scratch_agent_skills.py` | 不依赖示例中私有 `_summarization_event` 状态键；Skill body 在读取后才进入上下文。 |
| M4 | `python/m4/m4_2_newsletter_agent.py`、`m4_3_manuscript_agent.py` | 用官方 task 委派；不复制全文收集、60 本书并发和动态执行。 |
| M5 | `python/m5/async_lab/main_agent/agent.py`、`sales_assistant_sandbox/agent.py` | 正式 async 子代理依赖 Agent Protocol；不要用产品 ResearchRun 状态冒充框架持久运行。 |
| M6 | `python/m6/dvd_rental_analyst/` | MDA 与本地 Deep Agents 不同包。email_report 仅返回字符串；初始化脚本修改 Sakila 日期和金额，属于教学数据。 |

课程部分工具会执行 SQL、发起云资源或模拟发送邮件。阅读这些示例不授予本项目运行这些操作的权限，也不证明其生产可用性。课程本地副本没有可核验的 Git 元数据及顶层许可证，本轮仅参考模式，不复制整套示例进入产品。

本项目在课程模式上的窄化：B/C使用官方aafter_agent钩子CaptureResearch保存子代理结构化结果，Main只作ResearchSelection，不重复生成研究事实；真实Qwen的数组参数失败促使read_pages改成单一evidence_id，由后端映射URL。两项都是公共扩展点/工具契约应用，没有移植课程自定义循环。对应失败和新旧版本区别见实验手册。

权限学习实例：工具因来源配额耗尽从可见列表撤下后，执行时也拒绝不在本轮offered集合里的调用。历史第9次一律撤下工具的收敛策略已取消，改为第7次起经公开Middleware提示剩余预算，保留12次硬上限；详见[model-comparison.md](model-comparison.md)。proposedDate使用date类型，禁止备选日期散文。结构通过、委派成功、来源质量与Trace验证仍是独立项目。

## 模型兼容性工作为什么仍沿用课程

- [M1.3 Models](E:/CodexRepo/projects/lca-deepagents/thinkific/src/m1/m1.3-models.md)：使用官方模型适配器。当前ChatOpenAI 1.7.2、ChatDeepSeek 1.1.1、ChatAnthropic 1.7.6，不自写供应商聊天协议。
- [M1.5 Tools](E:/CodexRepo/projects/lca-deepagents/thinkific/src/m1/m1.5-tools.md)：继续@tool与Pydantic输入输出；真实模型+固定工具用于隔离协议问题，不冒充实时研究。
- [M4.1 Delegation](E:/CodexRepo/projects/lca-deepagents/thinkific/src/m4/m4.1-delegation.md)：仍是一个官方task委派Research，保持父子预算和原子结果，不为不同模型写第二套Agent循环。
- [M5.3 Sales assistant](E:/CodexRepo/projects/lca-deepagents/thinkific/src/m5/m5.3-the-sales-assistant.md)：在应用组装层选择模型/工具/Middleware；测试CLI只是调度case，不代替框架Harness。

四模型首轮和两次定向复查的目的，是检查相同工具契约/框架配置能否工作，不是用少量固定来源结果做模型排行榜。Claude不兼容先在公共API边界排除，不修改LangChain内部强行适配。

## 执行与学习责任

| 范围 | 状态 |
|---|---|
| 六模块正文与核心 Python 源码对照 | 已审阅；包含 M1/M2/M6，不仅 M3–M5 |
| 本地 0.7.32 公共 API、task/ToolStrategy、Skills/权限/Planning 探针 | 集成负责人已执行，细节见 [experiments.md](experiments.md) 与 [runtime-report.md](runtime-report.md) |
| 课程原版所有模型、MCP、云沙箱、MDA、Slack 实验 | **Not Run**；未为学习目的部署收费基础设施 |
| 作者亲自解释架构、运行代表性权限/委派实验 | **Pending**；代码和说明不能替代作者完成学习 |

官方入口：[Academy 课程](https://academy.langchain.com/courses/foundation-introduction-to-deepagents)、[课程源码](https://github.com/langchain-ai/lca-deepagents)、[官方教程正文](https://langchain-ai.github.io/lca-lessons/deepagents/)。当前 API 以 [Deep Agents 文档](https://docs.langchain.com/oss/python/deepagents/overview)及本地安装包为准。
