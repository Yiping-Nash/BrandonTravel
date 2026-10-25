# Codex Execution Brief — 三天冲刺

## 权责
- Product Owner：用户，最终确认产品范围与体验。
- Product & Architecture Advisor：**当前 ChatGPT 对话**，负责重要产品/架构评审，不是自动在线的代理。
- Codex Lead：负责仓库准备、类型契约、任务拆分、集成、测试、总结。
- Codex Builders：Frontend / Workspace API / Agent 三条隔离实施线。

## 启动顺序
0. 检查用户指定本地路径和 git 状态；确认 `origin` 指向既有 BrandonTravel 仓库。**不要在旧版目录上直接清空或覆盖**。
1. 保护旧版：创建并验证 V1 归档 tag/branch，推送远端前按权限要求确认。新建 V2 工作分支（例如 `v2/rebuild`）并形成与旧代码无关的干净树；保留旧 Git 历史，不 `push --force`。
2. 将本开工包复制进新的 V2 工作区；检查参考源代码、许可证、组件版本和安装兼容性。
3. 初始化最小 React + Python 应用骨架，选择最节省整合成本的目录/包管理；建立 `env.example`、本地占位 `.env`、`.gitignore`。**用户自己填密钥**。服务端密钥不可前端暴露。
4. 从 `CONTRACTS.md` 产出可执行接口/类型与 mock 数据；提交一个单独可供各线程起点的基线 commit。冻结契约后再并行。
5. 创建 3 个独立 Codex worktree/分支或使用原生 subagent，按文件所有权分工，持续集成。

## 文件所有权（按 Lead 确定的真实路径调整）
- Frontend：`apps/web/**`，不改后端 schemas/API 定义；使用 mock 适配层起步。
- Workspace：`apps/api/domain/**`, `apps/api/routes/**`, `apps/api/db/**`；不改 Agent 代码或 UI。
- Agent：`agent/**` 或 `apps/api/agent/**`, `evaluation/**`；调用冻结 Workspace 读取 API；无直接写入 Trip 的权限。
- Lead 独占：共享 `packages/contracts/**`、根依赖/配置、集成脚本、部署、主分支合并。若跨界，发最小 change request。

## 三天执行策略
- Day 1：Lead 冻结契约、组件安装 smoke test。并行实现 UI 三视图、Trip/Idea/Activity 域 API、Deep Agents 模型及工具 smoke test。结束前得到前端 mock 连通 + 后端 API 连通 + Agent 真调用独立连通。
- Day 2：整合 CRUD/POI/Agent Suggestion，做读回及双向同步。优先修复根因，不扩展外围功能。
- Day 3：真实浏览器 E2E、Trace/评测、视觉修复、演示与 README。功能不达标时降级标注而不是编造成功。

## 决策协议
- Codex 自主处理：依赖安装、组件适配、普通 API 组织、bugfix、测试和基本技术实现。
- 必须提请用户/Advisor：移除 Day/Week/Kanban、改变 Ideas/Activity 语义、让 Agent 自动写入行程、替换 Deep Agents、添加复杂基础设施、扩大范围、放弃高优先级验收项。
- 技术阻塞应提出：实际错误、已做实验、2 个可行选项、推荐选项与成本。不要问用户已经提供过的决定。

## 每阶段报告（简短）
1. 产品功能：本阶段用户能实际做什么？
2. 工程实现：复用了什么，写了什么业务胶水？
3. 验证：真实执行的命令、E2E/Trace 链接或文件、通过和失败。
4. 待审决策：仅列不能自主解决的产品/架构事项。

## 初始 Codex Prompt
请先完整阅读 `README_START_HERE.md` 和链接的六份资料。你是 Engineering Lead，不是产品经理；产品决策由用户和 ChatGPT 顾问确认。先审查仓库和许可证，保护 V1 历史，以全新代码树初始化 V2，配置 env 模板，验证 Kibo Kanban / Full Calendar / Python Deep Agents 的真实安装和最小 API 调用。在合同基线提交之前不要启动互相冲突的并行施工。随后为 Frontend、Workspace、Agent 创建隔离任务，积极使用 Codex 原生 worktree/subagent，集成时必须运行跨视图/Agent 端到端验收。请自主做普通工程决策，不因细节反复提问；重大产品变更提交简短决策报告。三天目标是可信的可演示闭环，不是堆满未验功能的页面。
