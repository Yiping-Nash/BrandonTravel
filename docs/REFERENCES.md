# 已选参考与复用规则

| 来源 | 角色 | 地址 | 处理方式 |
|---|---|---|---|
| Mindtrip | 主产品/交互参考 | https://mindtrip.ai/ | 按用户提供截图研究，不复制专有实现/素材 |
| Kibo UI Kanban | 选定看板组件 | https://www.kibo-ui.com/components/kanban | 官方 CLI：`npx kibo-ui add kanban`，先核查依赖/版本/授权 |
| Shadcn Full Calendar | 选定 Day/Week 日历组件 | https://github.com/yassir-jeraidi/full-calendar | 文档注册表：`npx shadcn@latest add "https://calendar.jeraidi.dev/r/full-calendar.json"`；MIT，先运行原版 |
| Deep Agents | Agent 强制框架 | https://github.com/langchain-ai/deepagents | Python create_deep_agent、tools、按需 subagent；以官方文档 API 为准 |
| LangSmith | Agent Trace/评测 | https://docs.langchain.com/langsmith | 真实执行留痕，后续评价集 |
| 高德地图开放平台 | 国内 POI 与地图 | https://lbs.amap.com/ | Web 服务/JS API 按真实接口与许可选择，不能编造数据 |
| FloatTrip | 辅助研究 | https://github.com/shouzhuoshouzhuo/FloatTrip | 日程 + 地图布局思路参考，非默认基础源码 |
| Open Sunsama | 辅助产品研究 | https://github.com/ShadowWalker2014/open-sunsama | 候选与日程的关系参考，不直接拷贝源码 |

## 研究已定，不允许无上限重做选型
- 不再广泛搜索 Kanban 或日历框架。首先研究并集成 Kibo UI 与已指定 Full Calendar，只有实际兼容性阻塞时再提出替代方案。
- 拿到组件最新可用版本的 package.json、源文件与 LICENSE，并记录版本/commit。先运行现成项目/示例，识别 React/Next.js/Tailwind/shadcn 版本约束。
- 原则为 Adopt > Adapt > Build。领域特有的协调代码、状态映射和 API 必须自己实现并测试。
- 若使用任何新外部代码/素材，须确认许可与来源。截图仅用于内部设计参考；公开展示避免第三方受保护的界面资产直接复制。
