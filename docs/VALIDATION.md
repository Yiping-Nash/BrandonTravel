# 执行证据与产品关口

日期：2026-10-26（Asia/Shanghai）。所有下述结果来自实际执行，不以构建成功替代浏览器操作。

## 产品关口 1 — 工作区骨架

- 页面：http://127.0.0.1:5173/；只读 fixture：`?demo=1`。
- Chrome 实测 Board、Day、Week、Ideas，无页面运行时错误。
- 截图：`screenshots/checkpoint-1-board.png`、`checkpoint-1-day.png`、`checkpoint-1-week.png`、`checkpoint-1-ideas.png`。
- 用户反馈日程大体没问题，希望风格更干净顺滑，并指出聊天回复不可见；已按反馈调整及复测。

## 产品关口 2 — 真实闭环

- 页面和 Trace 的精确 URL：`evaluation/browser-real-e2e.json`。
- Chrome 实际输入、点击、拖拽；真实调用高德与 Qwen3.8-Flash。
- 保存 POI → Agent 读取最新快照/搜索 → 未采纳 Ideas/Activities 不变 → 用户点击采纳 → 刷新确认状态和会话持久化。
- 截图：`screenshots/checkpoint-2-before-confirm.png`、`checkpoint-2-complete.png`、`e2e-real-poi.png`。
- 用户/Advisor 此关口回复“暂无”必须调整意见。

## 已运行的自动化

| 检查 | 实际结果 |
|---|---|
| 首次冻结契约 | 7 passed |
| Workspace 域/SQLite/API | 23 passed + 独立并发与跨 Trip 探针通过 |
| HTTP 集成 | 5 passed |
| Agent 评估 | 20 passed，含 Trace 后代泄漏、当地日期与写入边界 |
| 全部 Python 回归 | 55 passed，5.02s |
| 前端 TypeScript + Vite production build | passed |
| 最终 Chrome E2E | 7 passed，37.2s；0 failed / skipped / flaky |
| 四种风格 Chrome 补充测试 | 4/4 通过 Board、Day、Week、刷新持久化，跨周导航通过，0 pageErrors |
| 真实服务 API 端到端 | passed，`evaluation/integrated-e2e-result.json` |
| LangSmith 完整执行树 | 41 节点，3 个 llm 节点，2 个工具节点；所有 inputs/outputs 隐藏，未发现三项密钥 |

持久化测试重新打开 SQLite repository；浏览器测试重新载入页面。日期/时间/顺序由同一域命令保存，日历与看板没有独立权威存储。

最终 Chrome 七项覆盖：聊天收起/展开/刷新恢复、延迟 GET 不覆盖新版本、导航后的旧命令不重新打开 Trip、纽约浏览器 DST 下上海日程保持三小时、基础工作区闭环、真实 Qwen/高德建议采纳闭环、原生日历拖拽/resize/越界回滚/390px 窄屏。

## 不同旅行风格验收

行程均为明确标注的人工构造测试数据，通过真实 Workspace API 创建；Agent 使用真实 Qwen3.8-Flash。记录见 `evaluation/persona-results.json`、`evaluation/persona-browser-results.json`；截图见 `screenshots/persona-*-*.png`。

| 风格 | 数据 | 验证重点 |
|---|---|---|
| 亲子慢游 · 杭州 | 5 天 / 9 活动 / 4 未定时间 | 午休、孩子体力与灵活安排；读取真实偏好 |
| 密集打卡 · 上海 | 5 天 / 13 活动 / 3 未定时间 | 首日 7 项、累计 795 分钟；正确识别 10:00–10:30 重叠 |
| 朋友美食 · 成都 | 5 天 / 10 活动 / 8 未定时间 | 首日四项全部未定时间仍是当天计划，不能凭 0 定时分钟判断空闲 |
| 跨周文化独旅 · 西安 | 9 天 / 10 活动 / 5 未定时间 | 九日看板、第二周事件、低强度抵达日与灵活偏好 |

四组均确认 Agent 读取最新版本，未直接改写 Ideas/Activities。密集打卡第一次模型调用 HTTP 502，手动重试 200；保留失败状态，首次错误正文未保存，不能据此断言具体上游原因。首次回复对未定时间的措辞有误，随后加强提示并留下独立语义复测 `evaluation/persona-semantic-recheck.json`，原始结果保留用于比较。

## 实测发现并修复

1. 首次 Chrome 白屏：React effect 返回 `scrollIntoView()` 值被视为 cleanup。修复为明确 void 的 effect；后续 0 pageErrors。
2. Kibo 卡片时间标签使用 `fixed` 与 Tailwind 定位类冲突。改为 `time-fixed`，截图验证不再重叠。
3. 日历入口动画导致即时截图淡出不可读；移除入口渐变，保留真实事件布局。
4. 全局 button reset 覆盖日历事件的 Tailwind 背景/边框，补充明确事件边界样式。
5. 独立 Agent 审查发现 Trace 验证只遍历直接子节点；已递归检查全部后代，增加深层泄漏失败回归。
6. 最终集成审查发现旧响应覆盖、新旧 Trip 导航竞态、聊天保存非原子以及浏览器 DST 污染旅行墙上时间；全部修复并由独立审查者复核。
7. 用户反馈“Agent 没有回复”：后台实际已有真实回复，前端默认新会话造成不可见。新增会话恢复、请求中的问题显示、收起面板不中断回复；原问题“今天日程是不是太满？”在真实 Chrome 中重测通过，刷新保留回复。
8. 按用户反馈，UI 调整为白色/浅灰、深色正文、轻边框与克制交互；现有 checkpoint 截图更新为反馈后的版本。

运行浏览器补充测试时前端 worker 的临时服务结束导致一次 ECONNREFUSED；服务改由 Lead 持有后复测通过。不是产品行为测试通过的替代证据。

## 外部工具限制

Codex 浏览器工具与原生 Review 的 Windows 沙箱初始化失败。浏览器改用本机真实 Chrome/Playwright；Review 改用与开发者分离的独立上下文，逐条执行限定范围的只读检查与测试。尝试给予原生 Review 全盘权限被自动审批拒绝，未执行。

生产构建仍提示约 552 kB 主 bundle 的体积优化建议，不影响本地演示；本轮优先交付可验证闭环。
