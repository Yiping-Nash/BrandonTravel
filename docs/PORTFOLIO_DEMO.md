# Portfolio 1.0 Demo 操作路径

更新：2026-10-26。本文是可运行操作说明，**不是所有路径已通过验收的声明**。集成负责人已完成一次真实山西 Research 的 UI 闭环：返回 partial、1 个双林寺候选，依据高德、新华网/人民网，开放与预约仍未知，并通过预览确认和刷新验证。此单次成功不代表所有问题都稳定成功；人工质量评审仍 **Pending**。无候选结果、固定来源和演示数据不能代替成功研究。

## 启动与配置

在仓库根目录执行：

```powershell
uv sync --frozen
npm ci --prefix apps/web
# 只有新克隆且没有 .env 时，复制模板；不要覆盖已填的密钥。
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
powershell -File scripts/dev.ps1
```

默认页面 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)，API [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)。数据库默认 `data/brandontravel.sqlite3`。集成负责人使用的 **18000 / 5174 是隔离验收端口**，不是默认运行方式，不必复制测试数据库或切换端口才能演示。

`.env` 填服务器配置，不在浏览器输入密钥：

| 变量 | 当前用途 |
|---|---|
| `PORTFOLIO_MODEL` | Portfolio 显式规划/研究模型 profile；代码默认 `deepseek-flash`，可选 `deepseek-pro` / `qwen-flash` / `qwen-plus`，不自动降级 |
| `DEEPSEEK_API_KEY` | 选择 DeepSeek profile 时需要 |
| `DASHSCOPE_API_KEY`、`AGENT_MODEL`、`AGENT_BASE_URL` | 保留的 Main Chat Qwen；Portfolio 选 Qwen 时也使用相应百炼配置 |
| `AMAP_WEB_SERVICE_KEY` | 真实 POI、服务端高德地图/路线参考 |
| `TAVILY_API_KEY` | 深入研究的网页搜索与摘录 |
| `LANGSMITH_API_KEY`、`LANGSMITH_PROJECT` | 真实 Portfolio 执行 Trace；项目名称增加 `-Portfolio` 后缀 |

具体 profile 的官方适配器与环境变量在 `evaluation/research_models.py`；按模板填写，不擅自改模型 ID。填好后重启 API。`/api/health` 的旧能力字段主要对应 Main Chat，不是全部 Portfolio 依赖已可用的证明。当前本地单用户运行，不包含公网认证或多人协作。

## 一条完整路径

1. 首页点 **创建旅行**，只填名称也可以。创建后应显示日期待定；Ideas 可以先记想法，日历和 AI 规划/研究要求补充旅行信息。不要把 `?demo=1` 的只读固定数据当作真实工作区。
2. 打开 **旅行设置/旅行偏好**，依次展开 Where / When / Who，填写目的地、完整日期、同行人和偏好。保存后刷新，检查值仍在。下面表中的日期是明确选择的演示输入，不是软件默认值。
3. 点 **AI 旅行蓝图**，检查要求后点 **生成变更预览**。这是一次真实模型调用，会使用配置的平台额度。查看新增/修改/删除动作和未知假设；确认前 Ideas/Activities 应未改变。
4. 点 **确认应用变更**，应显示“已确认并保存”。收起 AI 面板回到 Board，拖动或编辑活动；Day/Week 展示同一份数据。若后台报告过期，不应强行覆盖新状态，应按最新旅行重新生成。
5. 切到 **Day**，选择日期。左侧 Chat 显示正在看的日期，中间日历保留未定时间活动，右侧高德地图显示有坐标的真实地点；选中地点可以查看活动，地图支持重新请求缩放。无坐标会明确显示缺口，不填假地点。最多显示 10 个地图标记，完整活动仍在列表中。
6. 查看时间重叠、未定时间、地点缺失与移动参考。驾车参考与直线距离分别标注；不把它们当实时交通、公交耗时或已预订行程。点 **讨论这一天** 可生成只针对选中日期的调整，再经过 Diff 确认。普通聊天仍可使用，但不等于自动修改安排。
7. 点 **深入研究**，使用一个具体问题，例如“结合现有安排，为两位古建筑爱好者找 1–2 个尚未安排的太原或晋中地点，用政府或官方机构资料解释推荐理由，并标明预约和开放信息的缺口”。开始后可以继续编辑；刷新会恢复任务记录，取消会保留取消状态。为减少无效调用，不反复启动相同宽泛问题。
8. 研究完成后检查 summary、候选理由、偏好匹配、取舍、fact/inference、来源链接、检索时间及局限。旅行快照显示名称/目的地/日期/偏好/活动数量，POI 显示地点、地址、坐标和高德链接；内部 ID、校验值及原始结构化资料保留在“技术详情”，网页摘录继续显示。`partial` 必须说明缺口；`failed` 或 `no_results` 不算本步骤的候选交付。若 Trip 在研究期间已变更，旧结果可看但采纳会被拒绝，需按最新内容重新研究。
9. 点候选的 **预览保存到 Ideas**，或选择日期后 **预览加入日程**。此时仍只是 Proposal。审阅 Diff 后确认，检查目标列表中的单条新增；重复确认不能重复插入。刷新后核对研究结果、方案状态和新活动/Idea 均保留。
10. 打开可用的 **查看执行 Trace**，核对本次问题、模型、工具和委派树；保存对应截图、响应和 run ID。URL 存在不等于 Trace 已核验。记录人工对推荐和来源的评语，未审阅标记 **Pending**。

## 三种明确的演示输入

| 场景 | 日期 / 同行人 | 偏好与重点 |
|---|---|---|
| 山西 · 与古建相遇 | 2026-11-02 至 11-04；朋友结伴 | 两位古建与雕塑爱好者，以太原、晋中为主；节奏舒缓，不重复计算景区和内部子地点 |
| 杭州 · 亲子慢周末 | 2026-11-07 至 11-09；亲子家庭 | 两成人及六岁孩子；自然、动手体验、午后休息，避开登山和夜间活动 |
| 上海 · 长者建筑漫步 | 2026-11-12 至 11-14；长者同行 | 建筑与博物馆；避免连续步行超过 30 分钟，午休，少跨城 |

这些是演示 persona，不是真实出行或预订信息。已有 `scripts/portfolio-browser.mjs` 自动化脚本覆盖空白创建、设置、真实蓝图、确认、地图及手动编辑刷新，**当前脚本不覆盖 Research 采纳链**。它默认面向负责人隔离验收端口；如明确要在默认本地服务重新运行，可显式指定：

```powershell
$env:PORTFOLIO_URL = 'http://127.0.0.1:5173'
node scripts/portfolio-browser.mjs shanxi
```

该命令创建新 Trip 并真实调用外部服务，产生用量；不要为看页面或凑测试数量重复执行。截图、视频和检查结果保存在 `data/portfolio/browser/<scenario>-<timestamp>/`。每次读取该目录的 `results.json`，不能因脚本存在就写“通过”。

对刚创建的 Trip，新增脚本实际覆盖单日方案与 Research 采纳（会消耗外部服务额度）：

```powershell
node scripts/portfolio-followup.mjs day YOUR_TRIP_ID
# 默认问题为山西双林寺；其他旅行请明确设置自己的问题
$env:RESEARCH_QUESTION = '结合当前旅行和偏好，研究一个尚未安排的真实地点；列出证据和未知项。'
node scripts/portfolio-followup.mjs research YOUR_TRIP_ID
```

最终工程验证已完成山西、杭州、上海三类真实核心旅程，包含失败后的恢复与修复；对应机器可读摘要、Trace和局限见 [Engineering Evidence](PORTFOLIO_EVIDENCE.md)。这不替代真人推荐质量评审。

## 看证据时区分四件事

- **真实运行**：必须有实际 API 响应、模型/来源记录和可核验 Trace；本轮已记录上述山西 partial 候选闭环；不把该结果推广为所有场景通过。
- **离线浏览器验证**：真实 Chrome 操作，但 API 全部 intercepted/mocked。本轮已检查研究取消、轮询、证据、候选→Diff、刷新恢复、旧聊天建议预览和移动端布局；它证明交互分支，不能证明推荐质量。
- **自动约束测试**：`pytest` 验证契约、事务、跨 Trip、过期、权限与错误处理。Workspace 独立审查修复候选推荐日期 fallback 后，相关 74 项测试通过；详细命令及范围见 [Workspace review](agent-learning/review-portfolio-workspace.md)。这不是整个项目“全部通过”。
- **人工产品评审**：推荐是否值得去、证据是否支持、路线节奏是否合理，由用户/Advisor 审阅代表性样本；状态仍 **Pending**。AI 可整理失败和对照，不能替代真人评分。

实现原理与最小学习实验见 [portfolio-guide.md](agent-learning/portfolio-guide.md)。旧 R1/R2 测试、Trace、质量门槛继续保留；本指南不改写其历史结果。

真实山西研究依据：[公开运行摘要](../evaluation/portfolio-evidence.json)（含成功、失败及来源索引）与 [LangSmith Trace](https://smith.langchain.com/o/4564f8ef-ab59-4775-ac79-da753311319b/projects/p/e870c339-03be-495b-b386-3a053d4edc07/r/6940d27e-4b3f-452e-b709-c94997f9b32f?poll=true)（需对应账号权限）。结果由集成负责人核验；本文未额外发起模型或来源调用。
