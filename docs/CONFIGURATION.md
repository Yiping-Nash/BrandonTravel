# 本地服务配置

编辑项目根目录 `.env`，不要提交，也不要把密钥贴到聊天。`.env.example` 只包含空占位。

| 变量 | 平台与用途 | 必需程度 |
|---|---|---|
| DASHSCOPE_API_KEY | 阿里云百炼 / Model Studio API Key，真实 Qwen 调用 | 真实 Agent 必需 |
| AGENT_MODEL | 默认 `qwen3.8-flash` | 已填 |
| AGENT_BASE_URL | 默认北京地域 `https://dashscope.aliyuncs.com/compatible-mode/v1`；必须与 Key 地域匹配 | 已填，可按控制台修改 |
| AMAP_WEB_SERVICE_KEY | 高德开放平台 → 应用 → 添加 Key → **Web 服务**，后端搜索 POI、静态地图和驾车路线 | 地点与地图必需 |
| DEEPSEEK_API_KEY | DeepSeek 官方 API，LangChain ChatDeepSeek 适配 | 默认 Portfolio 规划和研究必需 |
| PORTFOLIO_MODEL | 默认 `deepseek-flash`；显式 profile，不自动换模型 | 蓝图、单日方案、Research 共用 |
| TAVILY_API_KEY | Tavily 官方搜索与页面提取 | 真实 Research 必需 |
| LANGSMITH_API_KEY | LangSmith → Settings → API Keys | 可核查 Trace 必需 |
| LANGSMITH_PROJECT | `BrandonTravel2` | 已填 |
| LANGSMITH_ENDPOINT | `https://api.smith.langchain.com`，如账号使用 EU 则使用对应端点 | 已填 |
| LANGSMITH_WORKSPACE_ID | 多 workspace API Key 时填写目标 workspace ID | 按账号需要 |

不需要 OpenAI Key。Day 使用服务端代理的高德真实静态地图，支持缩放和活动定位；需要连续交互导航时打开高德链接。Web 服务 Key 不进入浏览器，无需另建 JavaScript API Key。路线是高德驾车参考，最多缓存30分钟，不代表其他出行方式或现场实际耗时。

模型参考：https://help.aliyun.com/en/model-studio/qwen3-8-flash 。按账号控制台的当前地域可用性为准；模型不支持或额度错误会原样分类为上游错误，不擅自换模型。

配置后重启 API。`GET /api/health` 仅返回是否配置的布尔值，不返回 key。演示模式是明确选择的离线规则示例；真实模式缺 Key 时返回配置错误，绝不偷偷回退。

本地单用户 Demo 仅监听 127.0.0.1，不具备多用户身份认证，不应直接暴露公网。
