# 上游归属与复用记录

基于 Open Sunsama，Copyright (c) 2024–2026 Circo，保留 LICENSE 非商业许可。
仓库：https://github.com/ShadowWalker2014/open-sunsama
固定提交：0eb237d9eb67373fb0c78690b6126d7d6e361368
获取方式：固定提交 ZIP。复用 apps/api、apps/web、packages、mcp、scripts 和根配置；不继承作者生产环境操作约定。

初步改造：工作区限 Web/API/MCP；关闭本地 workers；API 绑定本机；Web/API 同源代理；项目内 PostgreSQL/Bun；Web 构建去掉营销预渲染。非旅行模块源码暂保留，产品入口限于认证和旅行。
旅行领域、受限 MCP 提案工具已在 Sprint 02–03 实现。直接复用日历布局、拖动缩放、重叠排布、Radix UI、JWT认证和defineTool封装；新增旅行聚合、事务/版本/幂等和提案授权。修正拖动监听竞争、滚动偏移与尾随点击。上游通用任务API不作为旅行状态来源。

Sprint 04–06继续复用上游dnd-kit排序和MCP SDK/defineTool。新增地图与聊天领域适配，不引入上游通用任务写入作为旅行状态源。JWT新增登录sessionId以准确区分本次用量，旧JWT兼容。
