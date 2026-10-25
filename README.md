# BrandonTravel2

可运行的 AI 原生旅行工作区：人安排日程，Workspace 保存唯一可信状态，Brandon 研究并提出需确认的建议。

技术：React 19 / Vite / Kibo UI Kanban / yassir-jeraidi Full Calendar；Python FastAPI / SQLite；Deep Agents / LangChain / Qwen3.8-Flash / LangSmith；高德 Web 服务 POI。

## 启动

环境：Node.js 22+、Python 3.11+、uv；浏览器测试默认使用本机 Chrome。本次验证环境 Node 24.20.0 / Python 3.13.7。

在项目根目录执行：

```powershell
uv sync --frozen
npm ci --prefix apps/web
# .env 已准备且被 Git 忽略。新克隆时先复制：
# Copy-Item .env.example .env
```

在 `.env` 填写 `DASHSCOPE_API_KEY`、`AMAP_WEB_SERVICE_KEY`、`LANGSMITH_API_KEY`。模型默认 `qwen3.8-flash`，百炼 Key 与 endpoint 的地域必须匹配。详见 [配置说明](docs/CONFIGURATION.md)。服务端密钥不会进入浏览器。

一条命令启动两个服务，Ctrl+C 结束：

```powershell
powershell -File scripts/dev.ps1
```

或在两个终端分别启动：

```powershell
.venv\Scripts\python -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8000
npm run dev --prefix apps/web -- --port 5173 --strictPort
```

- 产品页面：http://127.0.0.1:5173/
- API 文档：http://127.0.0.1:8000/docs
- 健康检查：http://127.0.0.1:8000/api/health
- 持久化文件：`data/brandontravel.sqlite3`，重启服务不会清空。
- 只读 UI 骨架：http://127.0.0.1:5173/?demo=1 。可编辑版本从首页点击“打开演示旅行”创建。

## 完整 Demo（约 5 分钟）

1. 首页点击“创建旅行”，输入杭州、起止日期，创建后刷新。也可点击“打开演示旅行”，生成明确标注的五天、12 活动、3 Ideas 示例。
2. Ideas → 添加 Idea，记录自由文本；Itinerary → 添加活动，不设置地点和具体时间。刷新后两者仍在。
3. Explore → 搜索“西湖”或“龙井茶馆”；查看高德真实 POI、地址和经纬度，点击“保存到 Ideas”。“在高德地图查看”打开地图定位外链。
4. Ideas → 加入日程 → 选择日期。原候选保留，日程产生独立 Activity。
5. Board 拖动卡片跨日期或调整顺序；Day 在“未定时间”区点击活动，设定起止时间；Week 拖动时间事件或拖动下沿调整时长。回 Board、刷新，日期/时间/顺序保持一致。越界拖拽会报错并恢复。
6. 展开左侧 Brandon，选择“真实 Agent · Qwen”，发送：**第一天是不是太满？请读取最新行程，用高德搜索龙井茶馆，给出可保存到 Ideas 的真实地点建议，并区分事实和未核实判断。**
7. 回复下方会显示读取版本、实际工具名称、来源、未核实项与建议卡片。此时 Ideas/Activities 不变。点击“保存到 Ideas”或“加入指定日”，才执行 Workspace 采纳命令。
8. 点击“查看 LangSmith Trace”。刷新页面会恢复最近有效会话，检查“已采纳”状态与持久化记录；“新建对话”可显式开启新会话。

本机已验证的完整旅行 URL 和真实 Trace 位于 [浏览器 E2E 证据](evaluation/browser-real-e2e.json)。这些是本机数据库中的 ID，新克隆请重新创建演示旅行。

还准备了四组可编辑的风格测试旅行：[亲子慢游](http://127.0.0.1:5173/?trip=6bda6434-f17c-4787-822d-6355c90b9f18)、[密集打卡](http://127.0.0.1:5173/?trip=969e6f3f-b91e-4e27-9c55-767f62003601)、[朋友美食](http://127.0.0.1:5173/?trip=7aa1987f-f2e8-4b64-80fc-ea1c86749a19)、[跨周文化独旅](http://127.0.0.1:5173/?trip=035e035e-166a-4bef-bdb6-abd6b9b9d4ba)。新环境运行 `.venv\Scripts\python scripts/persona_trips.py --evaluate` 可通过真实 API 重新生成并调用真实模型评估；随后运行 `node scripts/browser-personas.mjs` 验证四种风格的页面与持久化。

## 真实能力与明确限制

- **真实**：SQLite CRUD/版本冲突、三视图统一命令、真实高德搜索、Qwen Deep Agents 工具调用与结构化建议、用户确认、聊天持久化、LangSmith 执行树。
- **演示**：示例旅行由固定数据通过真实 API 创建；Chat 选择“演示模式”才使用离线规则回复，始终标注且没有假 Trace。`?demo=1` 是只读 fixture。
- **未实现**：嵌入式地图（使用真实高德定位外链）、订票/支付、多人协作、生产认证、流式聊天。营业时间、交通和预约不视为已验证事实。
- 当前是 **localhost 单用户 Demo**，不应直接暴露公网。API 仅监听 loopback 并限制浏览器 Origin/Host。
- Activity 时间为 Trip IANA 时区下的本地 `YYYY-MM-DDTHH:mm`；无时间活动不占小时网格；暂不支持跨午夜，拒绝 DST 歧义/不存在时间。
- 最大旅行跨度 61 天；七天周视图可连续导航。Agent 每轮最多搜索三次，模型与整体调用均有超时。
- LangSmith 隐藏所有输入/输出，保留节点、模型、工具、耗时及元数据；旅行内容不会写入 Trace payload。
- 外部模型偶尔可能返回可重试错误。不同风格验收中记录过一次 HTTP 502，手动重试成功；错误不会伪装成模型回答或写入已确认行程。

## 验证

```powershell
.venv\Scripts\python -m pytest -q
npm run build --prefix apps/web
# 先启动 API 和前端；默认使用已安装 Chrome
apps\web\node_modules\.bin\playwright.cmd test --config playwright.config.mjs
# 下列脚本会实际调用已配置的外部服务，并产生模型/POI 用量：
.venv\Scripts\python -m evaluation.smoke_real
.venv\Scripts\python scripts/e2e_api.py
.venv\Scripts\python -m evaluation.verify_trace
```

真实运行结果、产品关口截图和已修复问题见 [验收记录](docs/VALIDATION.md)，独立审查见 [Code Review](docs/REVIEW.md)。

## 仓库与复用

原仓库：https://github.com/Yiping-Nash/BrandonTravel 。V1 归档 `archive/v1-before-v2-20261026` 指向 `1de429e38fb047084986d1e9577fe3deecde0f6d`；V2 分支 `v2/rebuild` 保留该父历史，使用全新代码树，无 force push。

源码及许可见 [DEPENDENCIES](docs/DEPENDENCIES.md)、[Frontend 集成说明](apps/web/README.md)、`licenses/`。未复制 Mindtrip 品牌、代码或图片。最小共享契约见 [API_FROZEN](docs/API_FROZEN.md) 和 `packages/contracts/`。
