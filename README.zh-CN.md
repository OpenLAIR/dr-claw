<div align="center">
  <img src="public/favicon.png" alt="VibeLab" width="96" height="96">
  <h1>VibeLab: 面向科研全流程的通用 AI 研究助手</h1>
  <p><strong>在一个工作区里完成研究规划、执行与写作。</strong></p>
</div>

<p align="center">
<a href="https://github.com/OpenLAIR/VibeLab">
<img src="https://img.shields.io/github/stars/OpenLAIR/VibeLab?style=for-the-badge&logo=github" alt="GitHub Stars" />
</a>
<a href="https://github.com/OpenLAIR/VibeLab/blob/main/LICENSE">
<img src="https://img.shields.io/badge/License-GPL--3.0-blue?style=for-the-badge" alt="License" />
</a>
<a href="https://join.slack.com/t/vibe-lab-group/shared_invite/zt-3r4bkcx5t-iGyRMI~r09zt7p_ND2eP9A">
<img src="https://img.shields.io/badge/Join-Slack-4A154B?style=for-the-badge&logo=slack" alt="Join Slack" />
</a>
<a href="https://x.com/Vibe2038004">
<img src="https://img.shields.io/badge/Follow-on%20X-black?style=for-the-badge&logo=x" alt="Follow on X" />
</a>
<a href="./public/wechat-group-qr.jpg">
<img src="https://img.shields.io/badge/%E5%8A%A0%E5%85%A5-%E5%BE%AE%E4%BF%A1%E7%BE%A4-07C160?style=for-the-badge&logo=wechat&logoColor=white" alt="加入微信群" />
</a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文</a>
</p>

## Overview

VibeLab 是一个面向不同研究方向的通用 AI 研究助手，帮助研究者和团队完成从想法形成、实验推进到论文产出的全流程工作。它把关键研究环节整合到同一个空间中，让你把精力放在问题本身和迭代质量上，而不是工具切换与流程拼接。

## 亮点

- **🔬 Research Lab** — 端到端研究仪表盘：定义研究简报、生成任务流水线、追踪 Survey → Ideation → Experiment → Publication → Promotion 各阶段进度，一览参考论文、Idea（支持 LaTeX 数学公式渲染）和缓存产物
- **📚 100+ Research Skills** — 覆盖 Idea 生成、代码调研、实验开发与分析、论文写作、审阅回复与交付的技能库 — Agent 自动发现并作为任务级辅助
- **🗂️ 对话驱动的 Pipeline** — 在 Chat 中描述你的研究想法，Agent 使用 `inno-pipeline-planner` skill 交互式生成结构化研究简报和任务列表 — 无需手动选择模板
- **🤖 多 Agent 后端** — 使用 Claude Code 作为执行引擎；兼容 Claude Sonnet 4.5、Opus 4.5
<!-- - 同时支持 Cursor CLI 和 Codex；兼容 GPT-5.2 -->

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">更多功能</span></summary>

- **💬 交互式 Chat + Shell** — 与 Agent 对话或直接进入终端 — 与研究上下文并排使用
- **📁 文件 & Git 浏览器** — 语法高亮浏览文件、实时编辑、暂存变更、提交和切换分支，无需离开 UI
- **📱 响应式 & PWA 就绪** — 桌面、平板和移动端布局，底部选项卡栏、滑动手势和添加到主屏幕支持
- **🔄 会话管理** — 恢复对话、管理多个会话，跨项目追踪完整历史

</details>


## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) v20 或更高版本（**推荐 v22 LTS**，见 `.nvmrc`）
- 至少安装并配置以下 CLI 工具之一：
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  <!-- - [Cursor CLI](https://cursor.com/cli) -->
  <!-- - [Codex](https://developers.openai.com/codex/cli/) -->

### 安装

1. **克隆仓库：**
```bash
git clone https://github.com/OpenLAIR/VibeLab.git
cd VibeLab
```

2. **安装依赖：**
```bash
npm install
```

3. **配置环境：**
```bash
cp .env.example .env
# 编辑 .env 文件，设置端口等偏好配置
```

4. **检查运行时网络锁（网页搜索前务必检查）：**
```bash
echo "${CODEX_SANDBOX_NETWORK_DISABLED:-0}"
```

如果输出为 `1`，即使在 Settings 中放宽权限，网络请求仍可能被阻止。
需要在部署/启动层（shell profile、systemd、Docker、PM2）移除或覆盖该变量，然后重启 VibeLab。

5. **启动应用：**
```bash
# 开发模式（支持热重载）
npm run dev
```

6. **打开浏览器** 访问 `http://localhost:5173`（或您在 `.env` 中配置的端口）

## Research Lab — 快速示例

VibeLab 的核心功能是 **Research Lab**。

### Step 0 — 先在 Settings 配置任一 Agent

在生成研究流水线前，请先打开 **Settings**（齿轮图标）并至少配置一个 Agent：

- **Claude Code**：完成 CLI 登录并确认可用。若需要网页搜索，请在 Permissions 中允许 `WebSearch` 与 `WebFetch`。
<!-- - **Cursor CLI**：完成 CLI 登录并确认可用。若需要网页搜索，请允许可联网的 Shell 命令（例如 `Shell(curl)`、`Shell(wget)`、`Shell(python)`）。 -->
<!-- - **Codex**：完成 CLI 登录并选择合适的权限模式。 -->

只要配置好**任意一个** Agent 即可继续。网页搜索需要为当前 Agent 打开对应的网络相关权限。
<!-- 网页搜索可使用 Claude、Cursor 或 Codex，但需要为当前 Agent 打开对应的网络相关权限。 -->

### Step 1 — 打开 Chat，描述你的研究想法

VibeLab 默认打开 **Chat** 页面。如果尚未生成研究流水线，页面会显示引导提示。点击 **Use in Chat** 注入模板提示，或直接用自己的话描述研究想法。

### Step 2 — Agent 生成研究流水线

Agent 运行 `inno-pipeline-planner` skill，通过几轮问答了解你的研究主题、范围和目标。收集到足够信息后，自动生成 `.pipeline/docs/research_brief.json` 和 `.pipeline/tasks/tasks.json`。

### Step 3 — 查看任务并执行

切换到 **Research Lab** 查看生成的任务列表和研究简报。对任意任务点击 **Go to Chat** 或 **Use in Chat**，将其发送给 Agent 执行。

完整操作步骤请见下方 **使用指南**。

## 使用指南

启动 VibeLab 后，打开浏览器并按以下步骤操作。

### 第 1 步 — 创建或打开项目

首次打开 VibeLab 时，您会看到 **Projects** 侧边栏。您有两种选择：

- **打开已有项目** — VibeLab 会自动发现 Claude Code 的会话，点击任意项目即可打开。
<!-- 同时支持 Cursor 和 Codex 的会话。 -->
- **创建新项目** — 点击 **"+"** 按钮，选择本机的一个目录，VibeLab 会创建：`.claude/`、`.agents/`、`.cursor/`（含从应用 symlink 的 `skills/`）、预设目录（`Survey/references`、`Survey/reports`、`Ideation/ideas`、`Ideation/references`、`Experiment/code_references`、`Experiment/datasets`、`Experiment/core_code`、`Experiment/analysis`、`Publication/paper`、`Publication/homepage`、`Publication/slide`），以及在项目根目录的 **instance.json**（上述目录的路径为绝对路径）。

> **默认项目存储路径：** 新项目默认存储在 `~/vibelab` 目录下。可在 **Settings → Appearance → Default Project Path** 中修改，也可通过环境变量 `WORKSPACES_ROOT` 设置。该配置持久化在 `~/.claude/project-config.json` 中。

### 第 2 步 — 通过 Chat 生成研究流水线

创建或打开项目后，VibeLab 默认进入 **Chat** 页面。如果尚未生成研究流水线，页面会显示引导提示，并提供 **Use in Chat** 按钮注入模板提示。

描述你的研究想法 — 即使只是一个大概的方向也可以。Agent 会使用 `inno-pipeline-planner` skill 与你交互，然后生成：
- `.pipeline/docs/research_brief.json`（结构化研究简报）
- `.pipeline/tasks/tasks.json`（任务流水线）

### 第 3 步 — 在 Research Lab 查看并执行任务

切换到 **Research Lab** 查看生成的任务、进度指标和研究产物，然后执行任务：
1. 通过 **CLI 选择器** 选择后端（Claude Code）。
<!-- 同时支持 Cursor CLI / Codex。 -->
2. 在 **Research Lab** 中对 pending 任务点击 **Go to Chat** 或 **Use in Chat**。
3. Agent 执行任务并将结果写回项目。

### 第 4 步 — 开启网络访问（用于网页搜索，Claude）
<!-- 同样适用于 Cursor / Codex -->

如果 Agent 不能搜索网页，通常是当前权限设置过于严格。若已放开权限仍无法搜索，请确认已在 **快速开始** 第 4 步检查过 **运行时网络锁** — 若 `CODEX_SANDBOX_NETWORK_DISABLED` 为 `1`，仅改 Settings 无法解决。

1. 打开 **Settings**（侧边栏齿轮图标）。
2. 进入 **Permissions**，然后选择当前使用的 Agent：
- **Claude Code**：
  - 在 **Allowed Tools** 中允许 `WebSearch`、`WebFetch`。
  - 确认这两个工具不在 **Blocked Tools** 中。
  - 若希望减少确认弹窗，可开启 **Skip permission prompts**。
<!-- - **Cursor CLI**：
  - 在 **Allowed Shell Commands** 中添加所需命令（例如 `Shell(curl)`、`Shell(wget)`、`Shell(python)`、`Shell(node)`）。
  - 确认这些命令不在 **Blocked Shell Commands** 中。
  - 若希望减少确认弹窗，可开启 **Skip permission prompts**。
- **Codex**：
  - 在 **Permission Mode** 中切换到 **Bypass Permissions**（在需要网页访问时）。 -->
3. 返回 **Chat**，发送新消息并重新尝试网页搜索。

<!-- Codex 模式差异：
- **Default / Accept Edits**：仍是沙箱执行，网络可能继续受会话策略限制。
- **Bypass Permissions**：`sandboxMode=danger-full-access`，具有完整磁盘与网络访问权限。 -->

安全提示：
- 仅在可信项目/环境中使用更宽松的权限设置。
- 完成网页搜索后，建议切回更安全的设置。

### 第 5 步 — 解决"Workspace Trust"或首次运行错误

每个 Agent 首次在项目目录中执行代码时，可能需要进行一次性的信任确认或登录。如果 Chat 窗口卡住或弹出信任/认证提示，请切换到 VibeLab 内置的 **Shell** 标签页，在那里同意提示即可。

操作步骤：
1. 切换到 VibeLab 的 **Shell** 标签页。
2. 在 Shell 中同意 trust/auth 提示。
3. 返回 **Chat** 重新发送消息即可。

VibeLab 默认已经开启 trust 流程，因此通常**不需要**再手动输入额外的 trust 指令。

信任状态按目录持久保存，每个项目只需操作一次。

> **Shell 标签页无法使用？** 如果 Shell 标签页报 `Error: posix_spawnp failed`，请参阅 [docs/faq.zh-CN.md](docs/faq.zh-CN.md) 中的修复方法，然后重试。

您也可以随时切换到其他标签页：

| 标签页 | 功能说明 |
|--------|----------|
| **Chat** | **默认首屏。** 描述研究想法以生成流水线，或执行任务。支持流式响应、会话恢复和消息历史。 |
| **Research Lab** | 查看研究简报、任务进度和研究产物。简报和任务通过 Chat 生成。 |
| **Shell** | 直接进入 CLI 终端，完全的命令行控制。 |
| **Files** | 浏览项目文件树，语法高亮查看和编辑文件，创建/重命名/删除文件。 |
| **Git** | 查看差异、暂存更改、提交和切换分支 — 全部在 UI 中完成。 |

#### 研究技能（Skills）

VibeLab 当前以生成后的 **Pipeline Task List** 作为执行流水线。
项目内置了 **100+ 个 skills**（位于 `skills/`），用于辅助科研任务，包括 idea 探索、代码调研、实验开发/分析、论文写作、审阅与交付等。
Agent 会自动发现这些 skills，并在任务执行过程中按需调用。

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">移动端与平板</span></summary>

VibeLab 完全响应式设计。在移动设备上：

- **底部选项卡栏** — 方便拇指操作
- **滑动手势** — 触摸优化的控制方式
- **添加到主屏幕** — 可作为 PWA（渐进式 Web 应用）使用

</details>

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">架构</span></summary>

### 系统概览

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Agent     │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  Integration    │
│                 │    │                 │    │                │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 后端 (Node.js + Express)
- **Express 服务器** - 具有静态文件服务的 RESTful API
- **WebSocket 服务器** - 用于聊天和项目刷新的通信
- **Agent 集成 (Claude Code)** - 进程生成和管理
<!-- 同时支持 Cursor CLI / Codex -->
- **文件系统 API** - 为项目公开文件浏览器

### 前端 (React + Vite)
- **React 18** - 带有 hooks 的现代组件架构
- **CodeMirror** - 具有语法高亮的高级代码编辑器

</details>

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">安全与工具配置</span></summary>

**🔒 重要提示**: 所有 Claude Code 工具**默认禁用**。这可以防止潜在的有害操作自动运行。

### 启用工具

要使用 Claude Code 的完整功能，您需要手动启用工具：

1. **打开工具设置** - 点击侧边栏中的齿轮图标
3. **选择性启用** - 仅打开您需要的工具
4. **应用设置** - 您的偏好设置将保存在本地

**推荐方法**: 首先启用基本工具，然后根据需要添加更多。您可以随时调整这些设置。

</details>

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">贡献</span></summary>

我们欢迎贡献！请遵循以下指南：

#### 入门
1. **Fork** 仓库
2. **克隆** 您的 fork：`git clone <your-fork-url>`
3. **安装** 依赖：`npm install`
4. **创建** 特性分支：`git checkout -b feature/amazing-feature`

#### 开发流程
1. **进行更改**，遵循现有代码风格
2. **彻底测试** - 确保所有功能正常工作
3. **运行质量检查**：`npm run lint && npm run format`
4. **提交**，遵循 [Conventional Commits](https://conventionalcommits.org/) 的描述性消息
5. **推送** 到您的分支：`git push origin feature/amazing-feature`
6. **提交** 拉取请求，包括：
   - 更改的清晰描述
   - UI 更改的截图
   - 适用时的测试结果

#### 贡献内容
- **错误修复** - 帮助我们提高稳定性
- **新功能** - 增强功能（先在 issue 中讨论）
- **文档** - 改进指南和 API 文档
- **UI/UX 改进** - 更好的用户体验
- **性能优化** - 让它更快

</details>

安装与故障排除请参阅 [FAQ](docs/faq.zh-CN.md)。

## 许可证

GNU General Public License v3.0 - 详见 [LICENSE](LICENSE) 文件。

本项目是开源的，在 GPL v3 许可下可自由使用、修改和分发。

## 致谢

### 构建工具
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic 的官方 CLI
<!-- - **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor 的官方 CLI -->
<!-- - **[Codex](https://developers.openai.com/codex)** - OpenAI Codex -->
- **[React](https://react.dev/)** - 用户界面库
- **[Vite](https://vitejs.dev/)** - 快速构建工具和开发服务器
- **[Tailwind CSS](https://tailwindcss.com/)** - 实用优先的 CSS 框架
- **[CodeMirror](https://codemirror.net/)** - 高级代码编辑器

### 致谢与参考
- **[Claude Code UI](https://github.com/siteboon/claudecodeui)** — VibeLab 基于此项目。详见 [NOTICE](NOTICE)。
- **[AI Researcher](https://github.com/HKUDS/AI-Researcher/)**（HKUDS）— 研究流程与智能体研究灵感致谢与参考。

## 支持与社区

### 保持更新
- **Star** 此仓库以表示支持
- **Watch** 以获取更新和新版本
- **Follow** 项目以获取公告

---

<div align="center">
  <strong>VibeLab — 从想法到论文。</strong>
</div>
