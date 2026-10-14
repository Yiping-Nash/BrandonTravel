# 公开演示与复现

本仓库是历史演示基线 d94769d 的公开版本快照，不携带私人开发历史、账号、数据库或模型配置。

## 本次三段实际录制

- [正在创建：12秒](../demo/v2/01-creating.webm)
- [成形行程：13秒](../demo/v2/02-formed.webm)
- [真实AI协作：24秒](../demo/v2/03-collaborating.webm)
- [三次尝试、用量与Trace ID](../demo/v2/evidence/summary.json)
- [最终运行、已应用提案及前后状态](../demo/v2/evidence/applied-run.json)

候选数据位于 fixtures/portfolio-v2。交通时间为展示设定，未核验、未预订。首次模型运行触发上下文限制；第二次成功但录制脚本断言错误；第三次成功完成实录。累计6次模型请求，地图/天气/汇率0。网页确认是脚本点击，不是真人完整验收。

原录屏为实际页面帧约4–6fps，无音轨；GIF为约4fps节选。尚未合剪70秒成片。许可证和归属见LICENSE、UPSTREAM.md与credits。

## 使用批准的候选行程

先按README启动产品。以下脚本注册独立公开演示账号，通过正式API创建三份副本并读回；不覆盖原计划：

```powershell
node scripts/import-portfolio-v2.mjs
```

如使用不同端口，设置本次进程的WEB_URL。凭据只写Git忽略的.runtime/portfolio-v2-account.json。此步骤没有模型或地图调用。录制脚本为 scripts/record-portfolio-v2.mjs，发送消息会使用你自行配置的模型并消耗额度；先检查模型配置、预算和行程副本。公开素材已可直接播放，不需要运行录制。

---

以下保留历史录制流程与限制，不作为本次新场景运行记录：

## 安全的本地演示

使用虚构账号和计划；不使用你的真实账户做自动验收。先按 README 启动，并在启动前设置 TRAVEL_FACTS_ALLOW_NETWORK=false。不要发送模型聊天，避免消耗未批准预算。Dashboard 汇率截图由浏览器阻断，未声称取得实时汇率。

```powershell
node scripts/portfolio-demo.mjs --new-account
node scripts/portfolio-screens.mjs
```

第一个命令通过正式注册、Trip 创建及领域操作 API 创建 22 活动，读回校验。账号凭据在 Git 忽略的 .runtime/portfolio-account.json；不会输出 token/password。第二个命令需要本机 Edge 和已安装 Playwright，仅截图实际新版 UI。脚本将自动资料更新关闭，汇率查询阻断，不注入真实事实。

重置使用同一账号创建新副本，不删除或覆盖旧数据：

```powershell
node scripts/portfolio-demo.mjs .runtime/portfolio-account.json
```

登录凭据过期后在页面正常重新登录，或重新执行 --new-account；不要将账号文件提交。当前没有一键删除旧副本或公共匿名入口。

## 三个可重复场景

1. 编辑日期，将结束日期从 10/19 改为 10/17。确认退回数量；保存后 10/18–19 活动身份、时长和内容保留，按原日期分组。扩大后不自动恢复。
2. 打开计划状态里的重叠提醒。第一天午餐 12:00–13:00 与博物馆 12:30–14:30 重叠 30 分钟；点击问题定位，修改后检查更新。无地点事实时其他检查 UNKNOWN，不能认为全计划已验证。
3. 在取得真实模型预算后，要求 Brandon 将某未固定活动延后。核对 MCP 轨迹、提案差异、确认前 revision 不变、确认后只改授权活动，切换 /legacy?tripId=<ID> 核对同一状态。本轮没有新调用模型或录制这个场景，不能用模拟聊天伪装。

## 已准备的产品演示

演示入口：demo/index.html；视频：demo/portfolio-demo.webm，2分11秒，无音轨。实际页面帧录制包含日期编辑、分组、问题定位、API 构造提案、网页确认、读回及旧版核对。录屏不是本轮实时 LLM；历史真实 Qwen/MCP 的 S01-1 证据单独展示，并提供 State Diff、用量和 Trace ID。

本地展示独立于业务后端：

```powershell
node scripts/demo-preview.mjs
```

打开 http://127.0.0.1:4335/，保持终端打开。访客不能编辑计划或调用模型。浏览器原生 WebM 编码，没有安装 ffmpeg。

## 用户补充录屏提纲（可选）

Dashboard 20 秒 → 时间表／日期分组 40 秒 → 问题定位 30 秒 → 真实 Agent 提案／确认 50 秒 → 旧版一致性 20 秒。用隔离副本，不修改你的原山西计划。录屏必须标注实际模型、日期、来源限制；手机真机另记。

## 配置边界

数据库配置由 local-db 生成 .runtime/config.json。可选高德 Web 服务配置为 .runtime/amap.json，模型配置为 .runtime/model-api.json；不复制真实配置到公开仓库。高德 JS 地图需要另一类 JS API 凭据，Web 服务 Key 不能代替。Phoenix 用 node scripts/phoenix-start.mjs 单独启动，不是页面运行前提。

## 日常启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 start
node scripts/local-start.mjs
```

网页 http://localhost:4331/；API http://127.0.0.1:4332。前后端同一个启动命令；终端保持打开。端口占用时停止原终端，勿开第二份。
