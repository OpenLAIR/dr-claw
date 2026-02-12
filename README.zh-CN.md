<div align="center">
  <img src="public/logo.svg" alt="Vibe Lab" width="64" height="64">
  <h1>Vibe Lab</h1>
</div>

[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Cursor CLI](https://docs.cursor.com/en/cli/overview) 和 [Codex](https://developers.openai.com/codex) 的桌面端和移动端界面，集成了 **Research Lab** 用于 AI 驱动的研究自动化。您可以在本地或远程使用它来查看项目和会话、管理研究流水线，并从任何地方（移动端或桌面端）进行修改。

 [English](./README.md) | [中文](./README.zh-CN.md)

## 截图

<div align="center">

<table>
<tr>
<td align="center">
<h3>桌面视图</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>显示项目概览和聊天界面的主界面</em>
</td>
<td align="center">
<h3>移动端体验</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>具有触摸导航的响应式移动设计</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI 选择</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>在 Claude Code、Cursor CLI 和 Codex 之间选择</em>
</td>
</tr>
</table>



</div>

## 功能特性

- **Research Lab（研究实验室）** - 结构化的研究仪表盘：一览研究概况、参考论文、生成的 Idea（支持 LaTeX 数学公式的 Markdown 渲染）、流水线状态和缓存产物
- **InnoFlow Skills（研究流水线技能）** - 内置模块化研究流水线技能（编排器、资源准备、Idea 生成、代码调研、实验开发、实验分析、论文撰写），逐步引导 Agent 执行
- **响应式设计** - 在桌面、平板和移动设备上无缝运行,您也可以在移动端使用 Claude Code、Cursor 或 Codex
- **交互式聊天界面** - 内置聊天界面,与 Claude Code、Cursor 或 Codex 无缝通信
- **集成 Shell 终端** - 通过内置 shell 功能直接访问 Claude Code、Cursor CLI 或 Codex
- **文件浏览器** - 交互式文件树,支持语法高亮和实时编辑
- **Git 浏览器** - 查看、暂存和提交您的更改。您还可以切换分支
- **会话管理** - 恢复对话、管理多个会话并跟踪历史记录
- **模型兼容性** - 适用于 Claude Sonnet 4.5、Opus 4.5 和 GPT-5.2


## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) v20 或更高版本
- 至少安装并配置以下 CLI 工具之一:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  - [Cursor CLI](https://docs.cursor.com/en/cli/overview)
  - [Codex](https://developers.openai.com/codex)

### 安装

1. **克隆仓库:**
```bash
git clone https://github.com/bbsngg/VibeLab.git
cd VibeLab
```

2. **安装依赖:**
```bash
npm install
```

3. **配置环境:**
```bash
cp .env.example .env
# 编辑 .env 文件，设置端口等偏好配置
```

4. **启动应用:**
```bash
# 开发模式（支持热重载）
npm run dev
```

5. **打开浏览器** 访问 `http://localhost:3001`（或您在 `.env` 中配置的端口）

## Research Lab — 快速示例

Vibe Lab 的核心功能是 **Research Lab**：一个 AI 驱动的研究流水线，只需输入研究主题，即可自动生成创新 Idea、编写实验代码、运行实验并分析结果。

以下是一个典型的研究流程：

### 1. 描述你的研究任务

在 Vibe Lab 中打开项目，切换到 **Chat** 标签页，输入类似以下内容：

```
Task: Train a neural network model for biomedical question answering using the
BioASQ factoid QA dataset. The task is to develop a model that can accurately
answer biomedical questions given supporting document contexts. The model should
leverage neural architectures to improve over traditional IR-based methods, with
a focus on handling domain-specific biomedical terminology and concepts.

Related papers:
- Making neural QA as simple as possible but not simpler
- Global vectors for word representation
- Continuous space word vectors obtained by applying word2vec to abstracts of biomedical articles
- Bidirectional attention flow for machine comprehension
- Learning to answer biomedical questions: OAQA at BioASQ 4B
```

**编排器** 技能会自动将此识别为 *idea 级别* 任务，构建所需元数据，并启动流水线。

### 2. 流水线自动逐步执行

```
编排器 (Orchestrator)        →  判断输入成熟度，设置工作区
  ↓
资源准备 (Prepare Resources)  →  搜索 GitHub，克隆参考仓库，下载论文
  ↓
Idea 生成 (Idea Generation)  →  生成 5 个多样化 Idea，选择并精炼最佳方案
  ↓
代码调研 (Code Survey)       →  获取额外仓库，调研代码库中的可复用组件
  ↓
实验开发 (Experiment Dev)    →  创建实现计划，编写完整项目代码，
                                与 Judge Agent 迭代优化，提交实验（3-10 epochs）
  ↓
实验分析 (Experiment Analysis) →  分析结果，绘制图表，给出改进建议，
                                  实现改进，运行进一步实验
```

每个步骤都会产生缓存产物（JSON 日志），您可以在 **Research Lab** 仪表盘中查看。

### 3. 在仪表盘中查看结果

切换到 **Research Lab** 标签页，可以看到：

- **研究概览** — 您的任务、选中的 Idea、流水线模式
- **生成的 Idea** — 以富 Markdown 渲染，支持 LaTeX 数学公式
- **流水线产物** — 按阶段分组，内置查看/编辑器
- **实验结果** — 训练日志、评估指标、分析报告、图表

所有数据存储在项目目录的 `instance.json`、`pipeline_config.json`、`Ideation/` 和 `Experiment/` 中。

> **提示**：您也可以直接提供一份 *完整的实现计划* 而不是研究主题。编排器会将其识别为 *plan 级别*，跳过 Idea 生成，直接进入代码调研和实验开发阶段。

## 安全与工具配置

**🔒 重要提示**: 所有 Claude Code 工具**默认禁用**。这可以防止潜在的有害操作自动运行。

### 启用工具

要使用 Claude Code 的完整功能,您需要手动启用工具:

1. **打开工具设置** - 点击侧边栏中的齿轮图标
3. **选择性启用** - 仅打开您需要的工具
4. **应用设置** - 您的偏好设置将保存在本地

<div align="center">

![工具设置模态框](public/screenshots/tools-modal.png)
*工具设置界面 - 仅启用您需要的内容*

</div>

**推荐方法**: 首先启用基本工具,然后根据需要添加更多。您可以随时调整这些设置。

## 使用指南

启动 Vibe Lab 后，打开浏览器并按以下步骤操作。

### 第 1 步 — 创建或打开项目

首次打开 Vibe Lab 时，您会看到 **Projects** 侧边栏。您有两种选择：

- **打开已有项目** — Vibe Lab 会自动发现 Claude Code、Cursor 和 Codex 的会话，点击任意项目即可打开。
- **创建新项目** — 点击 **"+"** 按钮，选择本机的一个目录，Vibe Lab 会为您设置工作区。

### 第 2 步 — 选择 CLI 后端

在项目视图中，点击 **CLI 选择器**（侧边栏顶部）以选择要使用的 Agent 后端：

| 后端 | 使用场景 |
|------|----------|
| **Claude Code** | Anthropic 的通用编程 Agent |
| **Cursor CLI** | Cursor IDE 内置 Agent |
| **Codex** | OpenAI 的 Codex Agent |

您可以随时切换后端，不会丢失项目上下文。

### 第 3 步 — 开始工作

您可以通过以下方式与项目交互：

| 标签页 | 功能说明 |
|--------|----------|
| **Chat** | 向选定的 CLI Agent 发送提示。支持流式响应、会话恢复、消息历史、代码块和文件引用。 |
| **Shell** | 直接进入 CLI 终端，完全的命令行控制。 |
| **Files** | 浏览项目文件树，语法高亮查看和编辑文件，创建/重命名/删除文件。 |
| **Git** | 查看差异、暂存更改、提交和切换分支 — 全部在 UI 中完成。 |
| **Research Lab** | *（见下文）*用于 AI 驱动研究流水线的结构化仪表盘。 |

### 第 4 步（可选） — 使用 Research Lab

**Research Lab** 标签页专为结构化、多步骤的 AI 研究设计。它提供：

- **研究概览** — 目标论文、任务描述、实例 ID、类别、流水线模式（Plan / Idea）
- **参考论文** — 所有参考论文，附带类型标签
- **最终选定 Idea** — 富 Markdown 渲染，支持 LaTeX 数学公式（KaTeX）、GFM 表格、代码块。支持一键复制和折叠展开
- **流水线配置** — 实例路径、任务级别、类别、数据集
- **研究产物** — 日志文件按流水线阶段分组，支持展开/折叠导航和内置查看/编辑器

数据从项目内的 `instance.json`、`pipeline_config.json`、`Ideation/` 和 `Experiment/` 目录加载。

#### InnoFlow 研究流水线

Vibe Lab 在 `skills/` 目录下内置了模块化研究技能。创建项目时会自动以 symlink 方式链接到 `<project>/.claude/skills/`，Agent 可自动发现并遵循。

**流水线概览**（Idea 模式）：

```
编排器 → 资源准备 → Idea 生成 → 代码调研 → 实验开发 → 实验分析 → 论文撰写
```

| 技能 | 用途 |
|------|------|
| **inno-research-orchestrator** | 入口：判断输入成熟度（plan / idea），构建 instance JSON，设置工作区 |
| **inno-prepare-resources** | GitHub 搜索、克隆参考仓库、下载 arXiv 论文 |
| **inno-idea-generation** | 生成 N 个多样化 Idea，选择并精炼最佳方案 |
| **inno-code-survey** | Phase A: 为选中 Idea 获取额外仓库；Phase B: 全面的代码调研 |
| **inno-experiment-dev** | 创建实现计划、编写项目代码（含 Judge 反馈循环）、提交实验 |
| **inno-experiment-analysis** | 分析实验结果、绘制图表、给出代码建议、实现改进 |
| **inno-paper-writing** | 撰写可投稿的 ML/AI 论文，含 LaTeX 模板、引用验证和会议审查清单（NeurIPS、ICML、ICLR、ACL、AAAI、COLM） |

要启动研究流程，打开 **Chat** 标签页并描述您的研究任务（例如 *"我想研究生物医学问答"*）。编排器技能会引导 Agent 完成整个流水线。

### 移动端与平板

Vibe Lab 完全响应式设计。在移动设备上：

- **底部选项卡栏** — 方便拇指操作
- **滑动手势** — 触摸优化的控制方式
- **添加到主屏幕** — 可作为 PWA（渐进式 Web 应用）使用

## 架构

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
- **Agent 集成 (Claude Code / Cursor CLI / Codex)** - 进程生成和管理
- **文件系统 API** - 为项目公开文件浏览器

### 前端 (React + Vite)
- **React 18** - 带有 hooks 的现代组件架构
- **CodeMirror** - 具有语法高亮的高级代码编辑器




### 贡献

我们欢迎贡献!请遵循以下指南:

#### 入门
1. **Fork** 仓库
2. **克隆** 您的 fork: `git clone <your-fork-url>`
3. **安装** 依赖: `npm install`
4. **创建** 特性分支: `git checkout -b feature/amazing-feature`

#### 开发流程
1. **进行更改**,遵循现有代码风格
2. **彻底测试** - 确保所有功能正常工作
3. **运行质量检查**: `npm run lint && npm run format`
4. **提交**,遵循 [Conventional Commits](https://conventionalcommits.org/)的描述性消息
5. **推送** 到您的分支: `git push origin feature/amazing-feature`
6. **提交** 拉取请求,包括:
   - 更改的清晰描述
   - UI 更改的截图
   - 适用时的测试结果

#### 贡献内容
- **错误修复** - 帮助我们提高稳定性
- **新功能** - 增强功能(先在 issue 中讨论)
- **文档** - 改进指南和 API 文档
- **UI/UX 改进** - 更好的用户体验
- **性能优化** - 让它更快

## 故障排除

### 常见问题与解决方案


#### "未找到 Claude 项目"
**问题**: UI 显示没有项目或项目列表为空
**解决方案**:
- 确保已正确安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- 至少在一个项目目录中运行 `claude` 命令以进行初始化
- 验证 `~/.claude/projects/` 目录存在并具有适当的权限

#### 文件浏览器问题
**问题**: 文件无法加载、权限错误、空目录
**解决方案**:
- 检查项目目录权限(在终端中使用 `ls -la`)
- 验证项目路径存在且可访问
- 查看服务器控制台日志以获取详细错误消息
- 确保您未尝试访问项目范围之外的系统目录


## 许可证

GNU General Public License v3.0 - 详见 [LICENSE](LICENSE) 文件。

本项目是开源的,在 GPL v3 许可下可自由使用、修改和分发。

## 致谢

### 构建工具
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic 的官方 CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor 的官方 CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - 用户界面库
- **[Vite](https://vitejs.dev/)** - 快速构建工具和开发服务器
- **[Tailwind CSS](https://tailwindcss.com/)** - 实用优先的 CSS 框架
- **[CodeMirror](https://codemirror.net/)** - 高级代码编辑器

## 支持与社区

### 保持更新
- **Star** 此仓库以表示支持
- **Watch** 以获取更新和新版本
- **Follow** 项目以获取公告

### 赞助商
- [Siteboon - AI powered website builder](https://siteboon.ai)
---

<div align="center">
  <strong>Vibe Lab — 为 Claude Code、Cursor 和 Codex 社区精心打造。</strong>
</div>
