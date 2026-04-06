<div align="center">
  <img src="public/dr-claw.png" alt="Dr. Claw" width="128" height="128">
  <h1>Dr. Claw: 面向科研全流程的通用 AI 研究助手</h1>
  <p><strong>在一个工作区里完成研究规划、执行与写作。</strong></p>
</div>

<p align="center">
<a href="https://github.com/OpenLAIR/dr-claw">
<img src="https://img.shields.io/badge/%F0%9F%A6%9E-Dr.%20Claw-7C3AED?style=for-the-badge" alt="Dr. Claw" />
</a>
<a href="https://openlair.github.io/dr-claw">
<img src="https://img.shields.io/badge/%F0%9F%8C%90-%E4%B8%BB%E9%A1%B5-2563EB?style=for-the-badge" alt="主页" />
</a>
<a href="https://www.npmjs.com/package/dr-claw">
<img src="https://img.shields.io/npm/v/dr-claw?style=for-the-badge&logo=npm&color=CB3837" alt="npm version" />
</a>
<a href="https://github.com/OpenLAIR/dr-claw/blob/main/LICENSE">
<img src="https://img.shields.io/badge/License-GPL--3.0%20%2B%20AGPL--3.0-blue?style=for-the-badge" alt="License: GPL-3.0 + AGPL-3.0" />
</a>
<br/>
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

## 目录

- [Overview](#overview)
- [最新动态](#最新动态)
- [亮点](#亮点)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [接入 OpenClaw](#接入-openclaw)
- [Research Lab - 快速示例](#research-lab-quick-example)
- [使用指南](#使用指南)
- [补充说明](#补充说明)
- [贡献](#贡献)
- [FAQ](./docs/faq.zh-CN.md)
- [许可证](#许可证)
- [引用](#引用)
- [致谢](#致谢)
- [支持与社区](#支持与社区)

## Overview

Dr. Claw 是一个面向不同研究方向的通用 AI 研究助手，帮助研究者和团队完成从想法形成、实验推进到论文产出的全流程工作。它把关键研究环节整合到同一个空间中，让你把精力放在问题本身和迭代质量上，而不是工具切换与流程拼接。

<strong>产品截图</strong>

<p align="center">
  <img src="public/screenshots/new_claw.png" alt="Dr. Claw 对话界面" width="1000">
</p>


<details>
<summary><strong>理念：杠杆化认知</strong></summary>

<p align="center">
  <img src="public/leveraged-cognition.png" alt="Leveraged Cognition" width="900">
</p>

**纯手工太慢，完全交给 AI 又太平庸，Vibe Researching 才是新的范式。** Dr. Claw 以 **Agentic Execution** 放大你的 **Research Taste**，让你既能更快推进、更大胆探索，也始终守住科研严谨性的底线。

</details>

## 最新动态

- 🖥️ **桌面应用** `2026-04-06` — Dr. Claw 现已支持原生桌面应用！下载 `.dmg`（macOS）或 `.exe`（Windows）安装包，从 [GitHub Releases](https://github.com/OpenLAIR/dr-claw/releases) 即刻体验。
- 🗂️ **多标签侧边栏** `2026-04-06` — Research Lab 和文件浏览器合并为右侧可切换标签页，所有信息一目了然。
- 📂 **文件预览浮层** `2026-04-06` — 内联预览项目文件，配合药丸切换和侧边浏览器，告别频繁切换窗口！
- 💬 **终端聊天** `2026-04-06` — 终端爱好者的福音！运行 `dr-claw chat`，用任意 OpenRouter 模型开启完整 Agent 会话，无需浏览器。
- 🎛️ **推理强度控制** `2026-03-30` — 精调 AI 思考深度！Codex 推理强度和 Gemini 思维力度选择器现已内置于 Chat 中。
- 🖥️ **本地 GPU 检测** `2026-03-30` — Dr. Claw 自动检测本地 GPU 资源，让你的硬件随时待命。
- 🌐 **OpenRouter 接入** `2026-03-28` — 一个 API Key 解锁数百种模型（GPT-5、Claude、Gemini、DeepSeek、Llama、Kimi 等），全球模型尽在掌握！
- 🔄 **会话恢复** `2026-03-26` — 会话中途出错？别慌——点击重试按钮，从断点处继续。

<details>
<summary><strong>更早的更新</strong></summary>

- 📡 **端口自动回退** `2026-03-26` — 默认端口被占用？Dr. Claw 自动寻找可用端口，省心省力。
- 🏷️ **智能 Prompt 加载** `2026-03-26` — 任务自动加载至 Chat 并显示徽章下拉菜单，点击即可开始！
- 🏷️ **会话阶段标签** `2026-03-26` — 会话自动标记研究阶段，每段对话处于什么状态一目了然。
- ✍️ **审稿回复技能** `2026-03-24` — 全新 Rebuttal 技能，将审稿意见转化为高质量的回复稿。
- 🧑‍💻 **多会话支持** `2026-03-21` — 并行运行多个会话并自动命名，多项目同时推进不在话下！
- 🗑️ **回收站** `2026-03-21` — 误删了项目？别担心——回收站里随时可以恢复。
- 🤖 **Dr. Claw CLI & OpenClaw** `2026-03-21` — 完整的命令行控制加 OpenClaw 集成，支持移动端语音驱动的研究管理。
- 📚 **参考文献库** `2026-03-20` — 精简的文献选择器加本地 Zotero 支持，文献管理井井有条。
- 🔀 **Git 版本控制** `2026-03-20` — 暂存、提交、差异对比、切换分支，全部在应用内完成，内置版本控制。
- 📰 **资讯看板** `2026-03-14` — 在工作区内实时追踪研究相关动态，热门论文再也不会错过！

</details>

## 亮点

- **🔬 Research Lab** — 端到端研究仪表盘：定义研究简报、生成任务流水线、追踪 Survey → Ideation → Experiment → Publication → Promotion 各阶段进度，一览参考论文、Idea（支持 LaTeX 数学公式渲染）和缓存产物
- **⚡ Auto Research** — 可直接从 Project Dashboard 一键顺序执行研究任务，实时打开对应 session，并在运行完成后发送邮件通知
- **📚 100+ Research Skills** — 覆盖 Idea 生成、代码调研、实验开发与分析、论文写作、审阅回复与交付的技能库 — Agent 自动发现并作为任务级辅助
- **🗂️ 对话驱动的 Pipeline** — 在 Chat 中描述你的研究想法，Agent 使用 `inno-pipeline-planner` skill 交互式生成结构化研究简报和任务列表 — 无需手动选择模板
- **🤖 多 Agent 后端** — 可在 Claude Code、Gemini CLI、Codex 和 OpenRouter 之间切换作为执行引擎

### 流水线产出物

| | 产出物 | 存储位置 | 说明 |
|---|---|---|---|
| 📚 | 文献综述 | `Survey/reports/` | 基于 arXiv、Semantic Scholar 和网络来源的带引用文献综述 |
| 💡 | 研究创意 | `Ideation/ideas/` | 多维度评估打分的头脑风暴输出 |
| 🔬 | 实验代码 | `Experiment/core_code/` | 由"计划 → 实现 → 评判"循环产出的代码 |
| 📊 | 分析结果 | `Experiment/analysis/` | 统计分析、表格和论文级图表 |
| 📝 | 论文草稿 | `Publication/paper/` | IEEE/ACM 格式学术论文，含引用和 LaTeX 数学公式 |
| 🎞️ | 学术展示 | `Promotion/slides/` | 演示文稿、TTS 语音旁白和演示视频 |

> 完整产出物列表和项目目录结构请参见 [docs/pipeline-outputs.md](docs/pipeline-outputs.md)。

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">更多功能</span></summary>

- **💬 交互式 Chat + Shell** — 与 Agent 对话或直接进入终端 — 与研究上下文并排使用
- **📁 文件 & Git 浏览器** — 语法高亮浏览文件、实时编辑、暂存变更、提交和切换分支，无需离开 UI
- **📱 响应式 & PWA 就绪** — 桌面、平板和移动端布局，底部选项卡栏、滑动手势和添加到主屏幕支持
- **🔄 会话管理** — 恢复对话、管理多个会话，跨项目追踪完整历史

</details>

### 功能截图

<details>
<summary><strong>展开查看截图</strong></summary>

<p><strong>Project Dashboard</strong> — 从项目总览进入，查看状态并启动端到端自动化流程。</p>
<p align="center">
  <img src="public/screenshots/project_dashboard.png" alt="项目看板界面" width="1000">
</p>

<p><strong>Skill Library</strong> — 浏览覆盖想法生成、实验推进与论文写作的技能库。</p>
<p align="center">
  <img src="public/screenshots/skill_library.png" alt="技能库界面" width="1000">
</p>

<p><strong>News Dashboard</strong> — 在同一工作区内跟踪研究相关的资讯更新。</p>
<p align="center">
  <img src="public/screenshots/news_dashboard.png" alt="新闻看板界面" width="1000">
</p>

</details>


## 快速开始

> **桌面应用（Beta）：** 想跳过以下安装步骤？可以直接从 [GitHub Releases](https://github.com/OpenLAIR/dr-claw/releases) 下载最新的 `.dmg`（macOS）或 `.exe`（Windows）安装包运行。桌面应用目前为 Beta 版本 — 如需更稳定的体验，请按照下方完整安装步骤操作。

### 前置要求

- [Node.js](https://nodejs.org/) v20 或更高版本（**推荐 v22 LTS**，见 `.nvmrc`）
- 至少安装并配置以下 CLI 工具之一：
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  - [Gemini CLI](https://geminicli.com/docs/get-started/installation/)
  - [Codex CLI](https://developers.openai.com/codex/cli/)
- 国内用户可以配置 [OpenRouter](#配置说明)
- 部分系统需要原生构建工具来安装 `node-pty`、`better-sqlite3` 等依赖；如果 `npm install` 失败，请查看 [FAQ](docs/faq.zh-CN.md)。

Cursor Agent 支持正在开发中，即将推出。

### 方式一：npx 一键启动（推荐）

无需克隆仓库或手动配置，直接运行：

```bash
npx dr-claw
```

或全局安装后使用：

```bash
npm install -g dr-claw
dr-claw
```

打开浏览器访问 `http://localhost:3001`，创建账户即可开始使用。

### 方式二：从源码安装（开发者）

1. **克隆仓库：**
```bash
git clone https://github.com/OpenLAIR/dr-claw.git
cd dr-claw
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

如需自定义端口、认证或工作区设置，请参阅 [docs/configuration.zh-CN.md](docs/configuration.zh-CN.md)。

4. **启动应用：**
```bash
# 开发模式（支持热重载）
npm run dev
```

5. **使用应用**

Dr. Claw 提供两种使用方式：**前端 UI** 和 **纯终端模式**。UI 提供更丰富的可视化，但偶尔可能遇到 bug；纯终端模式更加稳定轻量。

#### 方式 A：前端 UI

<details>
<summary><strong>在浏览器中打开 Web UI</strong></summary>

打开浏览器访问 `http://localhost:5173`（或您在 `.env` 中配置的端口）。

</details>

#### 方式 B：纯终端模式

<details>
<summary><strong>使用 CLI 工具搭配你偏好的 Agent</strong></summary>

<p align="center">
  <img src="public/screenshots/terminal_example1.png" alt="终端工作流示例" width="800">
</p>

打开**第二个终端**（保持第一个终端中的 `npm run dev` 运行），安装 `drclaw` CLI 工具：

```bash
pip install -e ./agent-harness
```

使用创建账户时设置的用户名和密码登录：

```bash
drclaw auth login --username 你的用户名 --password 你的密码
```

安装至少一个 Agent CLI（如果尚未安装）：

| Agent | 安装命令 | 认证方式 |
|-------|---------|---------|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude` → 按提示完成 OAuth |
| Gemini CLI | `npm install -g @google/gemini-cli` | `gemini` → Google 登录，或 `export GOOGLE_API_KEY=...` |
| Codex CLI | `npm install -g @openai/codex` | `codex login`，或 `export OPENAI_API_KEY=...` |
| **OpenRouter** | 无需安装 CLI | `export OPENROUTER_API_KEY=sk-or-...`（在 [openrouter.ai/keys](https://openrouter.ai/keys) 获取密钥）|

> **OpenRouter** 允许你通过单个 API 密钥使用*任意*模型（GPT-5、Claude、Gemini、DeepSeek、Llama、Mistral、Qwen 等）。在 UI 中选择模型或在 `.env` 中设置 `OPENROUTER_MODEL`。

进入你要工作的项目目录，启动任一 Agent：

```bash
cd /path/to/your/project
claude    # 或: gemini | codex
```

`dr-claw/skills/` 中的技能会在项目创建时自动软链接到项目的 `.claude/skills/` 目录，Agent 无需额外配置即可自动发现。你也可以在会话中手动引用任意技能：

```
> Read .claude/skills/inno-experiment-analysis/SKILL.md and follow it to analyze my results.
```

</details>

#### 方式 C：OpenRouter 终端对话

<details>
<summary><strong>使用任意 OpenRouter 模型的轻量终端对话</strong></summary>

如果你想要一种轻量级的纯终端体验，使用任意 [OpenRouter](https://openrouter.ai/) 模型，可以使用内置的 `dr-claw chat` 命令。无需浏览器或 UI — 直接在终端中进行具备完整工具调用能力（文件读写、Shell、Grep、Glob、网页搜索/抓取）的智能体对话。

```bash
# 确保已设置 OPENROUTER_API_KEY（或使用 --key 传入）
export OPENROUTER_API_KEY=sk-or-...

# 使用任意模型启动对话
node server/cli.js chat --model moonshotai/kimi-k2.5
```

也可以直接传入 API 密钥：

```bash
node server/cli.js chat --model anthropic/claude-sonnet-4 --key sk-or-your-key
```

| 参数 | 说明 |
|------|------|
| `--model <slug>` | OpenRouter 模型标识（如 `moonshotai/kimi-k2.5`、`anthropic/claude-sonnet-4`、`deepseek/deepseek-r1`）|
| `--key <key>` | OpenRouter API 密钥（默认使用 `OPENROUTER_API_KEY` 环境变量）|

浏览所有可用模型：[openrouter.ai/models](https://openrouter.ai/models)。

</details>

#### 方式 D：桌面应用

<details>
<summary><strong>作为独立桌面应用运行（macOS 和 Windows）</strong></summary>

```bash
# 开发模式（启动 Electron 并支持热重载）
npm run desktop:dev

# 构建可分发的安装包（.dmg / .exe）
npm run desktop:dist
```

桌面架构、IPC 桥接和 CI/CD 发布流程的详细说明请参阅 [electron/README.md](electron/README.md)。

</details>

如果后续 Agent 网页搜索不可用，请查看[网页搜索排障](#troubleshooting-web-search-zh)。

## 接入 OpenClaw
<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">把 Dr. Claw 变成移动端友好、支持语音的研究秘书</span></summary>

> OpenClaw 通过 `drclaw` CLI 连接 Dr. Claw，提供项目控制、智能摘要和主动通知 — 随时随地在手机或聊天中使用。

### 架构

```
┌─────────────────────────────────────────────────────────────┐
│  用户（手机 / 聊天 / 语音）                                    │
│    ↕                                                        │
│  OpenClaw  ── 秘书层 ──────────────────────────────────┐    │
│    │  执行本地 `drclaw ...`              接收推送消息    │    │
│    ↓                                        ↑          │    │
│  drclaw CLI  ── 稳定控制面 ────────────────────────┐   │    │
│    │  JSON + openclaw.* schema          WebSocket  │   │    │
│    ↓                                        │      │   │    │
│  Dr. Claw 服务                           Watcher ──┘   │    │
│    (项目、会话、pipeline、产物)                          │    │
└─────────────────────────────────────────────────────────────┘
```

集成分三层：

| 层级 | 功能 |
|------|------|
| **控制面** | OpenClaw 在本地执行 `drclaw --json ...` 命令 |
| **结构化契约** | JSON 响应携带版本化的 `openclaw.*` schema |
| **主动推送** | 事件驱动的 watcher 把重要变化推送到飞书 / Lark |

---

### 快速接入（6 步）

<details>
<summary><strong>前置条件</strong></summary>

- Dr. Claw 服务已启动（`npm run dev` 或 `drclaw server on`）
- 至少有一个项目和一个执行后端（Claude Code、Gemini CLI 或 Codex）
- OpenClaw 具备本地 shell / `exec` 能力
- *（可选）* 飞书 / Lark channel 用于推送通知

</details>

**1. 启动服务**

```bash
npm install && npm run dev       # 或: drclaw server on
drclaw --json auth status        # 验证连通性
```

> `drclaw server status` 只报告 `drclaw server on` 拉起的 daemon。如果用 `npm run dev` 启动，它可能显示 `STOPPED`，但 `http://localhost:3001` 实际可用 — 以 `auth status` 为准。

**2. 安装 CLI**

```bash
pip install -e ./agent-harness
drclaw --help
```

如果 PATH 中没有 `drclaw`：

```bash
PYTHONPATH=agent-harness python3 -m cli_anything.drclaw.drclaw_cli --help
```

**3. 登录认证**

```bash
drclaw auth login --username <user> --password <pass>
drclaw --json projects list      # 应返回你的项目列表
```

**4. 关联 OpenClaw**

```bash
drclaw install --server-url http://localhost:3001
# 带推送 channel：
drclaw install --server-url http://localhost:3001 --push-channel feishu:<chat_id>
```

这会复制 Dr. Claw skill、安装 wrapper 脚本，并保存服务地址和 CLI 路径。

**5. 验证核心流程**

从 OpenClaw 执行以下四个命令 — 如果都返回有效 JSON，说明集成已就绪：

```bash
drclaw --json projects list                            # 解析项目
drclaw --json chat waiting                             # 等待回复的会话
drclaw --json digest portfolio                         # 跨项目汇总
drclaw --json workflow status --project <project>      # 单项目状态
```

**6. 回复会话**

```bash
drclaw --json chat waiting                             # 选择会话
drclaw --json chat reply --project <proj> --session <sid> -m “按方案 B 继续。”
drclaw --json chat waiting --project <proj>            # 确认已处理
```

多轮项目讨论：

```bash
drclaw --json chat project --project <proj> --session <sid> -m “总结当前 blockers。”
```

---

### 结构化 Schema

面向机器的命令返回版本化的 `openclaw` 字段：

| Schema | 用途 |
|--------|------|
| `openclaw.turn.v1` | ��轮对话摘要 |
| `openclaw.project.v1` | 项目摘要（状态、计数、下一步操作） |
| `openclaw.portfolio.v1` | 跨项目概览与建议 |
| `openclaw.daily.v1` | 每日摘要 |
| `openclaw.report.v1` | 移动端报告 |
| `openclaw.event.v1` | Watcher 事件与派生 signal |

**客户端消费建议：**

| 场景 | 读取字段 |
|------|---------|
| 判断是否需要打断用户 | `openclaw.decision.needed` |
| 快捷操作 / 语音建议 | `openclaw.next_actions` |
| 紧凑展示 | `openclaw.turn.summary` 或 `openclaw.focus` |
| 处理 watcher 通知 | `openclaw.event.v1.event.signals` |

> 只要有 `openclaw` 字段，就不要只依赖原始 `reply` 文本。

正式契约文档：[`agent-harness/cli_anything/drclaw/SCHEMA.md`](agent-harness/cli_anything/drclaw/SCHEMA.md)

---

### 主动 Watcher

Watcher 订阅 Dr. Claw WebSocket 事件，只在真正值得提醒时推送通知。

```bash
# 配置推送 channel
drclaw openclaw configure --push-channel feishu:<chat_id>

# 管理 watcher
drclaw --json openclaw-watch on --to feishu:<chat_id>
drclaw --json openclaw-watch status
drclaw --json openclaw-watch off
```

**工作流程：**

```
WebSocket 事件 → 项目解析 → snapshot 对比 → signal 推导
                                                ↓
                   去重 (6h TTL) ← 稳定签名 + signal kinds
                                                ↓
                   openclaw agent --deliver → 飞书 / Lark 消息
                          (回退：bridge 直接发送)
```

**派生 signal：**

| Signal | 含义 |
|--------|------|
| `human_decision_needed` | Agent 请求工具调用权限 |
| `waiting_for_human` | 会话等待用户输入 |
| `blocker_detected` / `blocker_cleared` | 任务阻塞 / 解除阻塞 |
| `task_completed` | 任务完成 |
| `next_task_changed` | 推荐的下一个任务已变更 |
| `attention_needed` | 需要关注 |
| `session_aborted` | 会话执行中止 |

状态文件：`~/.drclaw/openclaw-watcher-state.json` | 日志：`~/.drclaw/logs/openclaw-watcher.log`

---

### 串行化本地 Turn

当 OpenClaw 反复调用 `openclaw agent --local` 时，使用 wrapper 脚本避免 session lock 冲突：

```bash
agent-harness/skills/dr-claw/scripts/openclaw_drclaw_turn.sh \
  --json -m “Use your exec tool to run \`drclaw --json digest portfolio\`. Return only raw stdout.”
```

> **原则：稳定的串行调用永远优于冒险的并发调用。**

---

### 接入自检清单

当以下场景全部通过时，你的 OpenClaw 集成就已完成：

- [ ] OpenClaw 能列出 Dr. Claw 项目
- [ ] OpenClaw 能识别等待中的会话
- [ ] OpenClaw 能成功回复一个会话
- [ ] OpenClaw 能产出 `digest portfolio` 汇总
- [ ] OpenClaw 在飞书 / Lark 收到至少一条 watcher 推送

此时 OpenClaw 就已经成为 Dr. Claw 的移动秘书。用户可以自然地说：

> *”看看哪些项目在等我回复。”*
> *”总结一下这个项目的进展和 blockers。”*
> *”替我回复这个会话：按方案 B 继续，做完汇报。”*
> *”给我一个跨项目进展汇总，推荐今天优先处理什么。”*
> *”我有个新想法 — 建个项目，和我讨论清楚，然后开始规划。”*

</details>

## 配置说明

Dr. Claw 会从 `.env` 读取本地配置。对大多数用户来说，只需要把 `.env.example` 复制为 `.env`；但以下几个配置项最常需要尽早调整：

- `PORT`：后端服务端口
- `VITE_PORT`：前端开发服务器端口
- `HOST`：前后端服务绑定地址
- `JWT_SECRET`：当你要把 Dr. Claw 暴露到 localhost 之外时必须设置
- `WORKSPACES_ROOT`：新项目工作区的默认根目录

完整环境变量说明和部署注意事项见 [docs/configuration.zh-CN.md](docs/configuration.zh-CN.md)。

Auto Research 的邮件通知配置在应用内的 **Settings → Email**。当前 v1 支持 Claude Code、Codex、Gemini 和 OpenRouter 作为执行引擎进行无人值守研究任务执行；如果运行中断，系统会自动回收僵尸 run，避免其长期停留在 `running` 状态。

<details>
<summary><strong>OpenRouter 配置</strong></summary>

[OpenRouter](https://openrouter.ai/) 作为一等公民集成，让你通过**一个 API 密钥**访问数百个模型（GPT-5、Claude、Gemini、DeepSeek、Llama、Mistral、Qwen、Kimi 等）。

#### 配置

1. 在 [openrouter.ai/keys](https://openrouter.ai/keys) 获取 API 密钥。
2. 通过以下三种方式之一设置密钥：
   - **环境变量：** `export OPENROUTER_API_KEY=sk-or-...`
   - **`.env` 文件：** 在项目 `.env` 中添加 `OPENROUTER_API_KEY=sk-or-...`
   - **UI 界面：** 进入 **Settings → OpenRouter** 并粘贴密钥

#### 在 UI 中使用 OpenRouter

1. 打开项目并进入 **Chat**。
2. 在 **Choose Your AI Assistant** 下点击 **OpenRouter**。
3. 在下拉菜单中搜索模型（会从 OpenRouter 获取完整列表），或输入自定义模型标识。
4. 开始对话 — Agent 具备与 Claude、Gemini、Codex 相同的工具调用能力（文件读写、Shell、Grep、Glob、网页搜索/抓取、Todo）。

OpenRouter 同样可用于 Project Dashboard 上的 **Auto Research** — 选择它作为提供方并选择任意模型。

#### 在终端中使用 OpenRouter

无需浏览器。`dr-claw chat` CLI 提供完整的智能体终端会话：

```bash
# 基本用法
node server/cli.js chat --model moonshotai/kimi-k2.5

# 指定 API 密钥
node server/cli.js chat --model deepseek/deepseek-r1 --key sk-or-your-key
```

CLI 支持与 UI 相同的工具（文件读写、Shell、Grep、Glob、网页搜索、网页抓取、Todo）。输入你的消息，Agent 将自主执行多步骤研究任务。

#### 默认模型

在 `.env` 中设置 `OPENROUTER_MODEL` 以更改未指定模型时的默认值：

```env
OPENROUTER_MODEL=moonshotai/kimi-k2.5
```

如未设置，默认使用 `anthropic/claude-sonnet-4`。

</details>

<a id="research-lab-quick-example"></a>

## Research Lab — 快速示例

Dr. Claw 的核心功能是 **Research Lab**。

<details>
<summary><strong>Research Lab 截图</strong></summary>

<p align="center">
  <img src="public/screenshots/research_lab.png" alt="Research Lab 工作流" width="1000">
</p>

</details>

典型流程如下：

1. 在 **Settings** 中配置一个受支持的 Agent。
2. 如果希望收到完成通知，在 **Settings → Email** 中配置邮件信息。
3. 在 **Chat** 中描述你的研究想法。
4. 让 Agent 生成 `.pipeline/docs/research_brief.json` 和 `.pipeline/tasks/tasks.json`。
5. 在 **Research Lab** 中查看流水线，并把任务发送回 **Chat** 执行，或者在 Project Dashboard 上点击 **Auto Research** 让系统顺序执行全部任务。

完整操作步骤请见下方 **使用指南**。

## 使用指南

启动 Dr. Claw 后，打开浏览器并按以下步骤操作。

<details>
<summary><strong>第 1 步 — 创建或打开项目</strong></summary>

首次打开 Dr. Claw 时，您会看到 **Projects** 侧边栏。您有两种选择：

- **打开已有项目** — Dr. Claw 会自动发现已注册项目，以及来自 Claude Code、Codex、Gemini 的关联会话。
- **创建新项目** — 点击 **"+"** 按钮，选择本机的一个目录，Dr. Claw 会创建：`.claude/`、`.agents/`、`.gemini/` 等 Agent 目录、标准工作区元数据、链接的 `skills/` 目录、预设研究目录（`Survey/references`、`Survey/reports`、`Ideation/ideas`、`Ideation/references`、`Experiment/code_references`、`Experiment/datasets`、`Experiment/core_code`、`Experiment/analysis`、`Publication/paper`、`Promotion/homepage`、`Promotion/slides`、`Promotion/audio`、`Promotion/video`），以及项目根目录下的 **instance.json**（上述目录的绝对路径写入其中）。Cursor Agent 支持即将推出。

> **默认项目存储路径：** 新项目默认存储在 `~/dr-claw` 目录下。可在 **Settings → Appearance → Default Project Path** 中修改，也可通过环境变量 `WORKSPACES_ROOT` 设置。该配置持久化在 `~/.claude/project-config.json` 中。

</details>

<details>
<summary><strong>第 2 步 — 通过 Chat 生成研究流水线</strong></summary>

创建或打开项目后，Dr. Claw 默认进入 **Chat** 页面。如果尚未生成研究流水线，页面会显示引导提示，并提供 **Use in Chat** 按钮注入模板提示。

<details>
<summary><strong>Chat 截图</strong></summary>

<p align="center">
  <img src="public/screenshots/chat.png" alt="Chat 界面" width="1000">
</p>

</details>

描述你的研究想法 — 即使只是一个大概的方向也可以。Agent 会使用 `inno-pipeline-planner` skill 与你交互，然后生成：
- `.pipeline/docs/research_brief.json`（结构化研究简报）
- `.pipeline/tasks/tasks.json`（任务流水线）

</details>

<details>
<summary><strong>第 3 步 — 在 Research Lab 查看并执行任务</strong></summary>

切换到 **Research Lab** 查看生成的任务、进度指标和研究产物，然后执行任务：

<details>
<summary><strong>任务执行截图</strong></summary>

<p align="center">
  <img src="public/screenshots/task_list.png" alt="任务列表与执行流程" width="1000">
</p>

</details>

1. 通过 **CLI 选择器** 选择后端（Claude Code、Gemini CLI 或 Codex）。
2. 在 **Research Lab** 中对 pending 任务点击 **Go to Chat** 或 **Use in Chat**。
3. Agent 执行任务并将结果写回项目。

</details>

<details>
<summary><strong>可选项 — 在 Project Dashboard 中运行 Auto Research</strong></summary>

如果你希望 Dr. Claw 端到端自动执行整条任务流水线，可以使用 **Auto Research**：
1. 打开 **Settings → Email**，配置 `Notification Email`、`Sender Email` 和 `Resend API Key`。
2. 确认项目中已经存在 `.pipeline/docs/research_brief.json` 和 `.pipeline/tasks/tasks.json`。
3. 打开 **Project Dashboard**，在项目卡片上点击 **Auto Research**。
4. 点击 **Open Session** 可随时跳转到本次运行创建的 Claude session。
5. 所有任务完成后，Dr. Claw 会发送完成通知邮件；如果 session 中途被打断，系统会自动恢复 stale run，避免它一直卡在 `running` 状态。

</details>

<details>
<a id="troubleshooting-web-search-zh"></a>
<summary><strong>第 4 步 — 网页搜索排障</strong></summary>

如果 Agent 不能搜索网页，通常是当前权限设置过于严格。除此之外，也需要确认当前进程是否仍然启用了运行时网络锁。

1. 检查运行时网络锁：
```bash
echo "${CODEX_SANDBOX_NETWORK_DISABLED:-0}"
```

如果输出为 `1`，即使在 Settings 中放宽权限，网络请求仍可能被阻止。需要在部署或启动层（shell profile、systemd、Docker、PM2）移除或覆盖该变量，然后重启 Dr. Claw。

2. 打开 **Settings**（侧边栏齿轮图标）。
3. 进入 **Permissions**，然后选择当前使用的 Agent：
- **Claude Code**：
  - 在 **Allowed Tools** 中允许 `WebSearch`、`WebFetch`。
  - 确认这两个工具不在 **Blocked Tools** 中。
  - 若希望减少确认弹窗，可开启 **Skip permission prompts**。
- **Gemini CLI**：
  - 选择合适的 **Permission Mode**。
  - 若需要网页访问，在 **Allowed Tools** 中允许 `google_web_search` 与 `web_fetch`。
  - 确认它们不在 **Blocked Tools** 中。
- **Codex**：
  - 在 **Permission Mode** 中切换到 **Bypass Permissions**（在需要网页访问时）。
4. 返回 **Chat**，发送新消息并重新尝试网页搜索。

Codex 权限模式说明：
- **Default / Accept Edits**：仍是沙箱执行，网络可能继续受会话策略限制。
- **Bypass Permissions**：`sandboxMode=danger-full-access`，具有完整磁盘与网络访问权限。

安全提示：
- 仅在可信项目/环境中使用更宽松的权限设置。
- 完成网页搜索后，建议切回更安全的设置。

</details>

<details>
<summary><strong>第 5 步 — 解决"Workspace Trust"或首次运行错误</strong></summary>

每个 Agent 首次在项目目录中执行代码时，可能需要进行一次性的信任确认或登录。如果 Chat 窗口卡住或弹出信任/认证提示，请切换到 Dr. Claw 内置的 **Shell** 标签页，在那里同意提示即可。

操作步骤：
1. 切换到 Dr. Claw 的 **Shell** 标签页。
2. 在 Shell 中同意 trust/auth 提示。
3. 返回 **Chat** 重新发送消息即可。

Dr. Claw 默认已经开启 trust 流程，因此通常**不需要**再手动输入额外的 trust 指令。

信任状态按目录持久保存，每个项目只需操作一次。

> **Shell 标签页无法使用？** 如果 Shell 标签页报 `Error: posix_spawnp failed`，请参阅 [docs/faq.zh-CN.md](docs/faq.zh-CN.md) 中的修复方法，然后重试。

您也可以随时切换到其他标签页：

| 标签页 | 功能说明 |
|--------|----------|
| **Chat** | 从这里开始。用它描述研究想法、生成流水线，并用所选 Agent 执行任务。 |
| **Survey** | 查看当前项目的论文、文献图谱、笔记和调研阶段任务。 |
| **Research Lab** | 在一个视图里查看研究简报、任务列表、进度和已生成的产物。 |
| **Skills** | 浏览已安装的 Skills，查看内容，并导入本地 Skills。 |
| **Compute** | 在一个位置管理计算资源并运行实验工作负载。 |
| **Shell** | 需要直接使用 CLI、处理 trust 提示或手动执行命令时，使用内置终端。 |
| **Files** | 浏览、打开、创建、重命名和编辑项目文件，并支持语法高亮。 |
| **Git** | 不离开应用即可查看差异、暂存更改、提交和切换分支。 |

</details>

<details>
<summary><strong>研究技能（Skills）</strong></summary>

Dr. Claw 当前以生成后的 **Pipeline Task List** 作为执行流水线。
项目内置了 **100+ 个 skills**（位于 `skills/`），用于辅助科研任务，包括 idea 探索、代码调研、实验开发/分析、论文写作、审阅与交付等。
Agent 会自动发现这些 skills，并在任务执行过程中按需调用。

</details>

## 补充说明
<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">移动端、架构与安全配置</span></summary>

### 移动端与平板

Dr. Claw 完全响应式设计。在移动设备上：

- **底部选项卡栏** — 方便拇指操作
- **滑动手势** — 触摸优化的控制方式
- **添加到主屏幕** — 可作为 PWA（渐进式 Web 应用）使用

### 架构

#### 系统概览

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Agent     │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  Integration    │
│                 │    │                 │    │                │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

#### 后端 (Node.js + Express)
- **Express 服务器** - 具有静态文件服务的 RESTful API
- **WebSocket 服务器** - 用于聊天和项目刷新的通信
- **Agent 集成 (Claude Code、Gemini CLI、Codex、OpenRouter)** - 负责进程拉起、流式输出与会话管理
- **文件系统 API** - 为项目公开文件浏览器

#### 前端 (React + Vite)
- **React 18** - 带有 hooks 的现代组件架构
- **CodeMirror** - 具有语法高亮的高级代码编辑器

### 安全与工具配置

**🔒 重要提示**: 各 Agent 的权限都是按提供方独立配置的。在开启宽松的文件、Shell 或网页访问前，请先检查 **Settings → Permissions**。

#### 启用工具

为了安全地使用网页搜索和高权限工具：

1. **打开 Settings** - 点击侧边栏中的齿轮图标
2. **选择 Agent** - Claude Code、Gemini CLI 或 Codex
3. **按需启用** - 仅开启当前任务需要的工具或权限模式
4. **应用设置** - 您的偏好设置将保存在本地

**推荐方法**: 优先使用最保守的权限模式，只在确实需要时放宽配置。

</details>

## 贡献
<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">展开内容</span></summary>

我们欢迎贡献！请遵循以下指南：

#### 入门
1. **Fork** 仓库
2. **克隆** 您的 fork：`git clone <your-fork-url>`
3. **安装** 依赖：`npm install`
4. **创建** 特性分支：`git checkout -b feature/amazing-feature`

#### 开发流程
1. **进行更改**，遵循现有代码风格
2. **彻底测试** - 确保所有功能正常工作
3. **运行质量检查**：`npm run typecheck && npm run build`
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

本仓库包含一个组合作品。

其中，源自 Claude Code UI 的上游部分继续适用 GNU General Public License v3.0（GPL-3.0）；Dr. Claw Contributors 的原创修改与新增部分适用 GNU Affero General Public License v3.0（AGPL-3.0）。

完整许可证文本与适用范围说明请参见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

## 引用

如果这个项目对你的研究有帮助，欢迎引用我们的工作：

```bibtex
@misc{song2026drclaw,
  author       = {Dingjie Song and Hanrong Zhang and Dawei Liu and Yixin Liu and Zongxia Li and Zhengqing Yuan and Siqi Zhang and Lichao Sun},
  title        = {Dr. Claw: An AI Research Workspace from Idea to Paper},
  year         = {2026},
  organization = {GitHub},
  url          = {https://github.com/OpenLAIR/dr-claw},
  homepage     = {https://openlair.github.io/dr-claw},
}
```

## 致谢

### 构建工具
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic 的官方 CLI
- **[Gemini CLI](https://geminicli.com/docs/get-started/installation/)** - Google 的 Gemini 命令行智能体
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - 用户界面库
- **[Vite](https://vitejs.dev/)** - 快速构建工具和开发服务器
- **[Tailwind CSS](https://tailwindcss.com/)** - 实用优先的 CSS 框架
- **[CodeMirror](https://codemirror.net/)** - 高级代码编辑器

### 致谢与参考
- **[Claude Code UI](https://github.com/siteboon/claudecodeui)** — Dr. Claw 基于此项目。详见 [NOTICE](NOTICE)。
- **[AI Researcher](https://github.com/HKUDS/AI-Researcher/)**（HKUDS）— 研究流程与智能体研究灵感致谢与参考。

## 支持与社区

### 保持更新
- **Star** 此仓库以表示支持
- **Watch** 以获取更新和新版本
- **Follow** 项目以获取公告

---

<div align="center">
  <strong>Dr. Claw — 从想法到论文。</strong>
</div>
