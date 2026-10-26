# 官方 API、课程与开源参考核对

核对日期2026-10-26。区分本地已安装实现、已读网页、已执行探针和未执行部署；不因官方当前网页存在某API，就假定旧课程或本地版本具有相同默认行为。

## 本地版本 / 许可证

| 包 | 已安装版本 | 包元数据许可证 | 本轮用途 |
|---|---|---|---|
| deepagents | 0.7.32 | MIT | 官方 Harness/task/Backend/Skills |
| langchain | 1.4.7 | MIT | 工具、Middleware、ToolStrategy |
| langchain-core | 1.7.0 | MIT | 模型/消息/工具协议 |
| langgraph | 1.2.17 | MIT | 图执行与状态基础 |
| langsmith | 0.14.12 | MIT | Trace、Dataset、Experiment、aevaluate |
| langchain-openai | 1.7.2 | MIT | Qwen 的 OpenAI-compatible 适配器 |
| langchain-deepseek | 1.1.1 | MIT | DeepSeek候选正式适配器 |
| langchain-anthropic | 1.7.6 | MIT | Claude候选构造；当前ToolStrategy路径未放行 |

版本来自本地安装包元数据；每次 live record 也保存版本，升级后应重新执行兼容性测试。模型托管服务条款与Python包许可证是两个问题。

## 公共 API 依据及本项目使用方式

| 能力 | 正式 API / 参考 | 本地应用与验证边界 |
|---|---|---|
| 模型与 Harness | create_deep_agent；[官方源码](https://github.com/langchain-ai/deepagents) | 使用配置Qwen，经真实工具调用探针；不修改site-packages |
| task 委派 | subagents 配置的 name/description/model/tools/system_prompt；[Subagents](https://docs.langchain.com/oss/python/deepagents/subagents) | B/C 只有 research，关闭 general-purpose；父子共享应用预算 |
| 结构化输出 | ToolStrategy(Pydantic schema)；[Structured output](https://docs.langchain.com/oss/python/langchain/structured-output) | A/Research输出ResearchResult，B/C Main输出ResearchSelection；公开handle_errors回调只允许一次schema修复，计入共享预算；域校验仍在应用端 |
| Filesystem Backend | StateBackend / FilesystemBackend / CompositeBackend / StoreBackend；[Backends](https://docs.langchain.com/oss/python/deepagents/backends) | C 使用StateBackend，不挂载本地仓库；持久性由Backend/检查点决定 |
| Skills | skills=[路径]；[Skills](https://docs.langchain.com/oss/python/deepagents/skills) | 发现元数据、按需读正文；C限制技能写入 |
| Memory | memory=[文件路径]；[Memory](https://docs.langchain.com/oss/python/deepagents/memory) | 审阅namespace与Store；R1不启用自动长期偏好学习 |
| Planning | TodoListMiddleware 显式传入；课程M1.1/M1.5/M4.1 | 0.7 起 opt-in；不能假设默认已有write_todos |
| 应用策略 | AgentMiddleware.awrap_model_call / awrap_tool_call / aafter_agent；[Custom middleware](https://docs.langchain.com/oss/python/langchain/middleware/custom) | 权限、次数、usage与子结果捕获使用公共扩展点；CaptureResearch原样保留子结果，不让Main重抄；不手写模型循环 |
| 文件权限 | FilesystemPermission；[Permissions](https://docs.langchain.com/oss/python/deepagents/permissions) | 文件权限不覆盖自定义工具或Shell；另做应用授权 |
| AsyncSubAgent | Agent Protocol/graph_id/url 与任务状态工具；[Async subagents](https://docs.langchain.com/oss/python/deepagents/async-subagents) | 已读M5源码；未部署Agent Server/异步服务，不声称已验证恢复 |
| LangSmith eval | Dataset/Examples/Client.aevaluate；[Evaluation](https://docs.langchain.com/langsmith/evaluate-llm-application) | 自动确定性评分，真人Pending；Trace结果单独读回 |
| Managed Deep Agents | define_deep_agent/identity/sandbox/channels；[MDA overview](https://docs.langchain.com/langsmith/python/managed-deep-agents-overview) | 课程独立包0.8.3，未部署，不作为R1前置条件 |

兼容性结果和真实失败样本见 [experiments.md](experiments.md)。本地公共API可调用与Qwen真实研究质量是两个门槛；不会为适配模型去更改框架内部。

真实Qwen运行暴露了“数组参数被编码成字符串”和重复抄写结构化结果的失败。当前修订采用更窄的`read_pages(evidence_id: str)`工具契约、显式根字段提示、一次正式ToolStrategy修复、aafter_agent捕获子结果；模型客户端构造时启用流式、5000输出token上限、75秒单调用超时且关闭SDK自动重试。这些是公共API配置/应用契约调整，不是放宽证据与权限校验。旧版本失败不能算成新版本通过。

历史修订曾在第9次模型请求清空可用工具，现已取消；当前从第7次起经公开Middleware附加剩余预算提醒，12次硬上限、来源配额和allowed/offered执行检查不变。Candidate.proposedDate保持date类型。应用配置纠正与模型能力应分开判断，详细证据见[model-comparison.md](model-comparison.md)。

候选已通过官方ChatOpenAI/ChatDeepSeek/ChatAnthropic组装。四个真实模型+固定工具首轮：Qwen Flash输入上限失败、DeepSeek Flash结构通过但no_results、Qwen Plus12次预算失败、DeepSeek Pro缺少有效子结果/无效JSON失败。它们不证明真实研究质量；两次定向复查状态由[model-comparison.md](model-comparison.md)记录。

Claude Agent试验仍Not Run：本地ToolStrategy会绑定tool_choice=any，Sonnet5.5不支持此强制选择；构造器省略参数不能覆盖后续框架行为。候选在调用前排除，不修改框架内部。另一个只读模型列表请求在Key格式修正后HTTP403，不能据此认定模型能力低或Key必定无效。官方依据及安全配置记录见同一比较报告。本学习文档未额外发起供应商API。

## 成熟参考的采用边界

| 参考 | 已核对的实现 | 采用 / 不采用 |
|---|---|---|
| [lca-deepagents](https://github.com/langchain-ai/lca-deepagents) 本地Python/Thinkific M1–M6 | 26正文单元、Backend/Skill/Memory、Newsletter task、async_lab、MDA示例 | 采用正式API模式；不复制课程SQL“只读”提示词、mock邮件、宽宿主目录、动态执行和全文落盘。没有本地Git/许可证就不编造commit/license。 |
| [open_deep_research](https://github.com/langchain-ai/open_deep_research/tree/1b7d2e80db9faa586165c60e09096dbbfd483a64) | deep_researcher.py 的brief/研究/压缩；tests/run_evaluate.py 的官方aevaluate | 参考问题澄清、证据压缩、数据集评测；不移植其自定义多阶段循环、多研究者与高开销重试。仓库已归档；[MIT许可证](https://github.com/langchain-ai/open_deep_research/blob/main/LICENSE)。 |
| [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp/tree/7797fd375aba02dcd33afe143f6bee13e5870859) | 社区浏览器自动化、登录态与页面数据提取路径；Apache-2.0代码 | 仅作可行性风险审阅，不纳入R1。开源代码许可不等于小红书平台采集许可；没有验证账号/授权/稳定性就不称为可用依赖。 |

课程示例提示词只能约束模型行为，不形成技术授权。MemorySaver/InMemoryStore 不自动变成生产持久数据库；StateBackend 不自动变成长期用户资料库；Skills 的 allowed-tools 等元信息也不能取代本项目强制工具边界。

## 数据源事实与风险边界

AMap 已用于真实 POI 搜索，提供地点事实，不提供可推定的个人体验或无障碍保证。Tavily 使用官方Python客户端 search/extract，真实记录已出现返回，仍可能有过期、二手、截断或冲突资料。网页成功提取不代表获得全文长期再分发许可，因此保留有限摘录、出处和检索时间，不照搬课程原文全文归档流程。

官方景点页优先支持开放/预约等规则，但未来出行日期、临时关闭和是否预约成功必须另行确认。小红书可用性及商业平台授权未完成验证；不绕人机验证，不自动登录/采集，不用第三方抓取服务承诺生产能力。R1 缺少体验来源时明确降级，不伪装为已经完成多源体验研究。
