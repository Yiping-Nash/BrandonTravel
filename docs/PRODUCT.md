# BrandonTravel2 — Product Spec v2.0（冻结施工范围）

## 定位
AI 原生的个人旅行研究与日程工作区。**人负责安排，Workspace 管理可信状态与规则，Brandon 负责研究、理解与建议。** 面向中国大陆旅行需求，优先做个人求职展示的端到端成品。

## 主要参考与差异
- **Mindtrip**：借鉴按 Trip 组织聊天、Ideas、Itinerary、Explore、偏好采集、地点详情和地图的交互信息结构；只作为产品交互参考，不复制非授权源码、素材或品牌。
- **BrandonTravel2 的强化**：Itinerary 是日程操作核心，使用横向日期 Kanban + Day/Week 时间网格共用一份 Trip State；强调旅行中查看、讨论、快速调整行程。
- AI 不强制作为首页入口。首页只需「创建/进入旅行」「探索地点/推荐」两个明确目的；自然语言是可选的意图入口。

## 核心实体与语义
- 一个 Trip 有目的地、旅行起止日期、Trip Preferences、Ideas、Itinerary、相关聊天会话。
- **Idea**：候选活动/地点，可以来源于用户手动创建、POI 搜索或 Agent 推荐；可以没有具体地点。
- **Itinerary Activity**：归属某天的安排，有顺序，可选具体开始/结束时间。时间未固定时仍属于当天安排，但不能凭空生成已确认时间。
- 一个 Activity 可以引用一个 Idea，但创建日程安排不必依赖 Idea。保存 Idea 与把 Idea 加入 Itinerary 是两种不同操作；加入后不自动清除原候选。
- **撤销 Bubble 独立概念**：不开发 Bubble 专用状态、动画或机会窗口算法。使用 `start/end nullable` 区分未固定时间与已定时间。
- 预订状态独立于活动的时间状态；“计划了”不等于“购票/预约完成”。MVP 不实现真实预订业务。

## 用户旅程
1. 创建 Trip（地点、日期、可选偏好），打开一个围绕 Trip 的工作区。
2. 手动或通过高德 POI 搜索地点，保存 Idea；手动新增的非地点活动同样有效。
3. 将 Idea 添加到 Itinerary 的某一天；在 Kanban 中跨日期移动、排序；在 Day/Week 视图中编辑带具体时间的事件。各视图双向同步并持久化。
4. 通过同一 Trip 下的 Brandon Chat 让 Agent 读取**最新**旅行状态、评价是否过满、研究景点或餐饮。Agent 以语言 + 结构化候选给建议。
5. 用户单独确认建议之后才写入 Ideas/Itinerary；Agent 默认无直接改写计划的权限。

## MVP 必须实现
- Trip 创建/选择（单用户 Demo 即可）；持久化。
- Ideas 候选列表、POI 搜索接入（需 API Key），以及无地点的自定义活动。
- Itinerary 三视图：Kanban / Day / Week；双向数据一致；活动创建、排序、跨日期移动、时间编辑、删除与刷新恢复。
- Trip 聊天：真实调用 Python Deep Agents 主 Agent，能够读取 Trip Snapshot；基本研究工具、结构化建议和用户采纳。
- 至少一个真实工具调用的行程评价；LangSmith Trace 可核查；可复现 E2E 演示。

## 优先但可延后
- 简短、可跳过的旅行偏好引导与持久化；可在 Trip 设置中编辑。
- 地图联动与活动详情，优先做 POI 定位、地点详情（不必达到 Mindtrip 的富媒体内容规模）。
- 初级交通/时间约束检查；日期修改/跨周导航的可用性。

## 明确不做
- Bubble 复杂机制；自动购买、酒店航班报价与交易；商业化地点内容数据库；社交/游记/媒体；多人协作；全天候后台监控；复杂长期记忆；多 Agent 网络；为了展示技术而引入 MCP、RAG、微服务或额外基础设施。
- 不复制 Mindtrip 的商标、照片及受保护的专有代码。外部内容要记录来源，不把模型猜测冒充实时事实。

## 展示核心
产品价值：高效的人类日程操作 + AI 研究与建议；工程价值：成熟组件复用 + Python Deep Agents/LangChain + LangSmith 可观测性 + 可信数据契约。
