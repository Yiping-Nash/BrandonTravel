# Portfolio 1.0 — Engineering Evidence

2026-10-26。这是实际执行记录，不是推荐质量的真人签收。输入 persona 为人工构造的演示旅行；标记为 live 的模型、高德和网页来源调用均真实发生。没有使用 mock 替代失败结果。

## 可复核交付

- [Product Owner Report](PRODUCT_OWNER_REPORT.md)（两页以内）
- [Developer Learning Guide](agent-learning/portfolio-guide.md)、[可复现 Demo](PORTFOLIO_DEMO.md)
- [全部运行摘要与失败记录](../evaluation/portfolio-evidence.json)、[Trace 执行树核验](../evaluation/portfolio-trace-verification.json)
- [Hero](screenshots/portfolio/hero.png)、[Board](screenshots/portfolio/board.png)、[Day](screenshots/portfolio/day.png)、[Research](screenshots/portfolio/research.png)、[Evidence](screenshots/portfolio/evidence.png)
- 实际浏览器录屏：[蓝图](demos/blueprint.webm)、[单日调整](demos/day-planning.webm)、[研究采纳](demos/research-adoption.webm)。没有生成或拼接虚构界面；研究录屏早于证据卡片可读性打磨，当前截图展示最后界面。

## 确定性与工程回归

| 检查 | 实际结果 | 范围与限制 |
|---|---|---|
| `python -m pytest -q --junitxml=data/portfolio/pytest.xml` | **332 passed, 15.13s** | 包含保留的第一轮/R1、契约、SQLite事务、取消/恢复、过期/跨Trip/重复确认、Agent权限、结构化输出及地图降级；来源和模型多为 fixture/mock。 |
| `npm run build --prefix apps/web` | **通过** | JS 583.88 KB，gzip 183.87 KB；保留单chunk超过500 KB警告。 |
| 原有 Chrome 工作台回归 | **6项通过** | 五项无付费模型回归最终合跑13.7s；真实Qwen聊天恢复另跑通过。涵盖拖拽/调整时长、版本冲突、迟到响应、时区/DST与窄屏。原保存Idea用例补充等待真正保存完成，未修改产品行为迁就测试。 |
| 新前端分支检查 | **真实Chrome + mocked API，通过** | 取消、轮询、恢复、Diff、过期、旧建议转Proposal、390px布局、失败重试ID、确认后刷新失败；不能据此证明模型质量。 |
| 独立 Code Review | **无剩余P0/P1/P2 findings in scope** | [Workspace](agent-learning/review-portfolio-workspace.md)、[Agent](agent-learning/review-portfolio-agent.md)、[Integration](agent-learning/review-portfolio-integration.md)。不同于对应模块开发上下文。 |

审查修复包括空网页正文被接受为证据、候选日期类型转换、确认已成功但列表刷新失败仍显示未保存。后续独立复验还覆盖共享确定性距离、坏JSON先计量再安全失败、生产POI绑定Schema与R1兼容。

## 三类真实浏览器旅程

每条从空白创建开始，明确填写日期与偏好；经历真实AI蓝图、预览时不写入、确认后写入、地图加载、手工编辑、刷新恢复。Research 在 UI 发起，查看来源，先预览保存Ideas，再确认，手动安排到日期并刷新。

| Trip | Blueprint / Workspace | 真实 Research 与采纳 | 需要如实保留的失败 |
|---|---|---|---|
| 山西古建 / 朋友 | 通过；三天7项初稿；真实单日时间调整另通过 | 双林寺，1候选，partial；高德+新华网/人民网；完整采纳与持久化通过 | 早期CLI研究两次超上下文；一次浏览器开发进程新旧Schema混用导致失败。修复后通过。 |
| 杭州亲子 | 通过；三天6项初稿 | 中国丝绸博物馆，1候选，partial；真实研究→Ideas→日程→刷新通过 | 蓝图首次JSON格式失败，显式重试成功。研究成功后测试选择器因新增技术详情变成多匹配；恢复既存Run完成采纳，没有重复模型调用。 |
| 上海长者 | 通过；三天8项初稿 | 上海邮政博物馆，1候选，partial；完整采纳与持久化通过 | 先后出现candidate字段层级、JSON引号未转义、POI引用为空。分别保留并修复具体反馈/失败分类/生产Schema，最终通过；没有换模型或放宽证据校验。 |

所有成功流程检查无浏览器运行时异常。应用不会自动把 `no_results` 视为推荐成功。当前这三个非空样本是功能演示证据，不能据此声称统计意义上的高成功率；跨代码版本的全部尝试不混成模型胜率。

## Trace 与调用量

已对以下实际执行树读回核验：

- [山西 Blueprint](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/e870c339-03be-495b-b386-3a053d4edc07/r/bd90bfe8-0291-4328-87ef-ab664f35514a?poll=true)：3次模型请求，根执行12.31s。
- [山西 Research](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/e870c339-03be-495b-b386-3a053d4edc07/r/6940d27e-4b3f-452e-b709-c94997f9b32f?poll=true)：8次模型请求，28.43s，真实task委派。
- [单日调整](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/e870c339-03be-495b-b386-3a053d4edc07/r/ded248cf-480c-4e12-8730-3c6799416587?poll=true)：2次模型请求，4.46s。首次读回未及时成功，后续只读核验通过，没有重跑模型。
- [杭州 Research](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/e870c339-03be-495b-b386-3a053d4edc07/r/b75c9b15-e95f-4137-baf1-25846e1c924b?poll=true)：8次模型请求，27.82s。
- [上海 Research](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/e870c339-03be-495b-b386-3a053d4edc07/r/3e5a73b1-1602-47f9-880a-b626c7e1d63b?poll=true)。

Trace 需要对应账号权限。核验包含模型/工具后代节点和6个平台Key的实际值扫描；不公开原始请求载荷。Portfolio Trace可能包含旅行上下文及来源，不能把脱敏等同于不上传旅行内容。LangSmith0.14.12仍支持的read_run/get_run_url已显示2027年移除预告，升级时需迁移公开API。

本轮Portfolio记录 **15次实际任务尝试、83次模型请求、354,264 input /24,576 output tokens，23次AMap POI、15次网页搜索、7次提取，22 Tavily credits**。包含失败调用，未用成功次数替代总量。均为已配置DeepSeek Flash；没有进行Pro/Claude新对照。原Qwen Chat恢复与Hero评估另保留Trace，地图/路线HTTP调用也不包含在此Agent工具计数中。

共享R1/Portfolio账本：**176/1000 Trace slots预留、106/1000 Tavily credits上界、¥66.7634保守预算占用**。这些不是实际账单：包含历史未知用量预留（此前¥45未释放）、每任务Trace/POI安全预留；本轮模型tokens按账本保守单价计算约¥1.36，不能据此认定平台实扣。后续费用以平台账单为准。36次架构对照和54次正式评测没有恢复执行。

## 推荐质量：人工 Pending

自动Schema/权限/引用校验不判断每句话语义。供Owner与Advisor优先审阅：

1. 山西初稿安排周一博物院，已注明开放未知，但仍应核对闭馆日后调整；这是草稿，不是可直接出发的保证。
2. 上海结果引用2023年开放规则，limitations注明2026年是否沿用未知；summary仍可能显得过于肯定。关于“可坐可停”的推断也缺乏设施依据，不应当作已验证的无障碍保证。
3. 杭州亲子推荐的实际体验课、未来开放与预约未知，需要审阅推荐理由是否充分贴合孩子与午休约束。

未填写AI冒充的人工分数。可继续通过Ideas/活动编辑完善；正式产品质量签收尚未完成。已实现范围和边界见 [Owner Report](PRODUCT_OWNER_REPORT.md)，未发布到主分支。
