<div align="center">
  <img src="public/drclaw.jpg" alt="Dr. Claw" width="96" height="128">
  <h1>Dr. Claw: Your AI Research Assistant</h1>
  <p><strong>Full-stack research workspace.</strong></p>
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
<img src="https://img.shields.io/badge/Join-WeChat-07C160?style=for-the-badge&logo=wechat&logoColor=white" alt="Join WeChat" />
</a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文</a>
</p>

## Table of Contents

- [Overview](#overview)
- [Highlights](#highlights)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Research Lab - Quick Example](#research-lab-quick-example)
- [Usage Guide](#usage-guide)
- [FAQ](./docs/faq.md)
- [License](#license)
- [Acknowledgments](#acknowledgments)
- [Support & Community](#support--community)

## Overview

Dr. Claw is a general-purpose AI research assistant designed to help researchers and builders execute end-to-end projects across different domains. From shaping an initial idea to running experiments and preparing publication-ready outputs, Dr. Claw keeps the full workflow in one place so teams can focus on research quality and iteration speed.

## Highlights

- **🔬 Research Lab** — Structured dashboard for end-to-end research: define your brief, generate a pipeline of tasks, track progress across Survey → Ideation → Experiment → Publication → Promotion, and inspect source papers, ideas (rendered with LaTeX math), and cache artifacts — all at a glance
- **📚 100+ Research Skills** — A curated library spanning idea generation, code survey, experiment development & analysis, paper writing, review response, and delivery — automatically discovered by agents and applied as task-level assistance
- **🗂️ Chat-Driven Pipeline** — Describe your research idea in Chat; the agent uses the `inno-pipeline-planner` skill to interactively generate a structured research brief and task list — no manual templates needed
- **🤖 Multi-Agent Backend** — Seamlessly switch between Claude Code, Gemini CLI, and Codex as your execution engines

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">More Features</span></summary>

- **💬 Interactive Chat + Shell** — Chat with your agent or drop into a full terminal — side by side with your research context
- **📁 File & Git Explorer** — Browse files with syntax highlighting, live-edit, stage changes, commit, and switch branches without leaving the UI
- **📱 Responsive & PWA-Ready** — Desktop, tablet, and mobile layouts with bottom tab bar, swipe gestures, and Add-to-Home-Screen support
- **🔄 Session Management** — Resume conversations, manage multiple sessions, and track full history across projects

</details>


## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher (**v22 LTS recommended**, see `.nvmrc`)
- At least one of the following CLI tools installed and configured:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  - [Gemini CLI](https://geminicli.com/docs/get-started/installation/)
  - [Codex CLI](https://developers.openai.com/codex/cli/)
- Some systems need native build tools for dependencies like `node-pty` and `better-sqlite3`. If `npm install` fails, see [FAQ](docs/faq.md).

Cursor agent support is in progress and coming soon.

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/OpenLAIR/VibeLab.git
cd VibeLab
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your preferred settings (port, etc.)
```

Need custom ports, auth, or workspace settings? See [docs/configuration.md](docs/configuration.md).

4. **Start the application:**
```bash
# Development mode (with hot reload)
npm run dev
```

5. **Open your browser** at `http://localhost:5173` (or the port you configured in `.env`)

If agent web search does not work later, see **Troubleshooting Web Search** below.

## Configuration

Dr. Claw reads local settings from `.env`. For most users, the only required step is copying `.env.example` to `.env`, but these are the settings you are most likely to adjust early:

- `PORT`: backend server port
- `VITE_PORT`: frontend dev server port
- `HOST`: bind address for the frontend and backend
- `JWT_SECRET`: required before exposing Dr. Claw beyond localhost
- `WORKSPACES_ROOT`: default root for new project workspaces

For the full environment reference and deployment notes, see [docs/configuration.md](docs/configuration.md).

<a id="research-lab-quick-example"></a>

## Research Lab — Quick Example

The core feature of Dr. Claw is the **Research Lab**.

The typical flow is:

1. Configure one supported agent in **Settings**.
2. Describe your research idea in **Chat**.
3. Let the agent generate `.pipeline/docs/research_brief.json` and `.pipeline/tasks/tasks.json`.
4. Review the pipeline in **Research Lab** and send tasks back to **Chat** for execution.

For full step-by-step operations, see **Usage Guide** below.

## Usage Guide

After starting Dr. Claw, open your browser and follow the steps below.

### Step 1 — Create or Open a Project

When you first open Dr. Claw you will see the **Projects** sidebar. You have two options:

- **Open an existing project** — Dr. Claw auto-discovers registered projects and linked sessions from Claude Code, Codex, and Gemini.
- **Create a new project** — Click the **"+"** button, choose a directory on your machine, and Dr. Claw will set up the workspace: agent folders such as `.claude/`, `.agents/`, `.gemini/`, standard workspace metadata, linked `skills/` directories, preset research dirs (`Survey/references`, `Survey/reports`, `Ideation/ideas`, `Ideation/references`, `Experiment/code_references`, `Experiment/datasets`, `Experiment/core_code`, `Experiment/analysis`, `Publication/paper`, `Promotion/homepage`, `Promotion/slides`, `Promotion/audio`, `Promotion/video`), and **instance.json** at the project root with absolute paths for those directories. Cursor agent support is coming soon.

> **Default project storage path:** New projects are stored under `~/dr-claw` by default. You can change this in **Settings → Appearance → Default Project Path**, or set the `WORKSPACES_ROOT` environment variable. The setting is persisted in `~/.claude/project-config.json`.

### Step 2 — Generate Your Research Pipeline via Chat

After creating or opening a project, Dr. Claw opens **Chat** by default. If no research pipeline exists yet, an onboarding banner appears with a **Use in Chat** button that injects a starter prompt.

Describe your research idea — even a rough one is fine. The agent uses the `inno-pipeline-planner` skill to ask clarifying questions and then generates:
- `.pipeline/docs/research_brief.json` (your structured research brief)
- `.pipeline/tasks/tasks.json` (the task pipeline)

### Step 3 — Review in Research Lab and Execute Tasks

Switch to **Research Lab** to review the generated tasks, progress metrics, and artifacts. Then execute tasks:
1. Choose a CLI backend from the **CLI selector** (Claude Code, Gemini CLI, or Codex).
2. In **Research Lab**, click **Go to Chat** or **Use in Chat** on a pending task.
3. The agent executes the task and writes results back to the project.

### Step 4 — Troubleshooting Web Search

If the agent cannot search webpages, your current permission settings are likely too restrictive. Also check whether a runtime network lock is still active for the process.

1. Check the runtime network lock:
```bash
echo "${CODEX_SANDBOX_NETWORK_DISABLED:-0}"
```

If the output is `1`, network requests can remain blocked even if Settings permissions are opened. Remove or override this variable in your deployment or startup layer (shell profile, systemd, Docker, PM2), then restart Dr. Claw.

2. Open **Settings** (gear icon in sidebar).
3. Go to **Permissions**, then choose your current agent:
- **Claude Code**:
  - Enable `WebSearch` and `WebFetch` in **Allowed Tools**.
  - Ensure they are not present in **Blocked Tools**.
  - Optionally enable **Skip permission prompts** if you want fewer confirmations.
- **Gemini CLI**:
  - Choose an appropriate **Permission Mode**.
  - Allow `google_web_search` and `web_fetch` in **Allowed Tools** when web access is required.
  - Ensure they are not present in **Blocked Tools**.
- **Codex**:
  - In **Permission Mode**, switch to **Bypass Permissions** when web access is required.
4. Return to **Chat**, start a new message, and retry your web-search prompt.

Codex permission mode notes:
- **Default / Accept Edits**: sandboxed execution; network may still be restricted by session policy.
- **Bypass Permissions**: `sandboxMode=danger-full-access` with full disk and network access.

Security note:
- Use permissive settings only in trusted projects/environments.
- After finishing web search tasks, switch back to safer settings.

### Step 5 — Resolve "Workspace Trust" or First-Run Errors

Each agent may require a one-time trust confirmation before it can execute code in your project directory. If Chat freezes or shows a trust prompt, switch to the **Shell** tab inside Dr. Claw and approve the prompt there.

Steps:
1. Switch to the **Shell** tab in Dr. Claw.
2. Approve the trust/auth prompt shown in Shell.
3. Return to **Chat** and resend your message.

By default, trust flow is already enabled in Dr. Claw, so you usually do **not** need to manually run extra trust commands.

The trust decision is persisted per directory — you only need to do this once per project.

> **Shell tab not working?** If the Shell tab shows `Error: posix_spawnp failed`, see [docs/faq.md](docs/faq.md) for the fix, then retry.

You can switch tabs at any time:

| Tab | What it does |
|-----|-------------|
| **Chat** | Start here. Use it to describe your research idea, generate a pipeline, and run tasks with the selected agent. |
| **Survey** | Review papers, literature graphs, notes, and survey-stage tasks for the current project. |
| **Research Lab** | Review the research brief, task list, progress, and generated artifacts in one place. |
| **Skills** | Browse installed skills, inspect their contents, and import additional local skills. |
| **Compute** | Manage compute resources and run experiment workloads from one place. |
| **Shell** | Use the embedded terminal when you need direct CLI access, trust prompts, or manual commands. |
| **Files** | Browse, open, create, rename, and edit project files with syntax highlighting. |
| **Git** | Inspect diffs, stage changes, commit, and switch branches without leaving the app. |

#### Research Skills

Dr. Claw now uses the generated **Pipeline Task List** as the execution flow.
The project includes **100+ skills** under `skills/` to support research tasks (idea exploration, code survey, experiment development/analysis, writing, review, and delivery).
These skills are discovered by the agent and can be applied as task-level assistance throughout the workflow.

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">Mobile & Tablet</span></summary>

Dr. Claw is fully responsive. On mobile devices:

- **Bottom tab bar** for thumb-friendly navigation
- **Swipe gestures** and touch-optimized controls
- **Add to Home Screen** to use it as a PWA (Progressive Web App)

</details>

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">Architecture</span></summary>

### System Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Agent     │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  Integration    │
│                 │    │                 │    │                │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Backend (Node.js + Express)
- **Express Server** - RESTful API with static file serving
- **WebSocket Server** - Communication for chats and project refresh
- **Agent Integration (Claude Code, Gemini CLI, Codex)** - Process spawning, streaming, and session management
- **File System API** - Exposing file browser for projects

### Frontend (React + Vite)
- **React 18** - Modern component architecture with hooks
- **CodeMirror** - Advanced code editor with syntax highlighting

</details>

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">Security & Tools Configuration</span></summary>

**🔒 Important Notice**: Agent permissions are configurable per provider. Review **Settings → Permissions** before enabling broad file, shell, or web access.

### Enabling Tools

To use web and tool-heavy workflows safely:

1. **Open Settings** - Click the gear icon in the sidebar
2. **Choose an Agent** - Claude Code, Gemini CLI, or Codex
3. **Enable Selectively** - Turn on only the tools or permission mode you need
4. **Apply Settings** - Your preferences are saved locally

**Recommended approach**: Start with the safest permission mode that still lets you complete the task, then relax settings only when needed.

</details>

<details>
<summary><span style="font-size: 1.17em; font-weight: 600;">Contributing</span></summary>

We welcome contributions! Please follow these guidelines:

#### Getting Started
1. **Fork** the repository
2. **Clone** your fork: `git clone <your-fork-url>`
3. **Install** dependencies: `npm install`
4. **Create** a feature branch: `git checkout -b feature/amazing-feature`

#### Development Process
1. **Make your changes** following the existing code style
2. **Test thoroughly** - ensure all features work correctly
3. **Run quality checks**: `npm run typecheck && npm run build`
4. **Commit** with descriptive messages following [Conventional Commits](https://conventionalcommits.org/)
5. **Push** to your branch: `git push origin feature/amazing-feature`
6. **Submit** a Pull Request with:
   - Clear description of changes
   - Screenshots for UI changes
   - Test results if applicable

#### What to Contribute
- **Bug fixes** - Help us improve stability
- **New features** - Enhance functionality (discuss in issues first)
- **Documentation** - Improve guides and API docs
- **UI/UX improvements** - Better user experience
- **Performance optimizations** - Make it faster

</details>

For setup help and troubleshooting, see [FAQ](docs/faq.md).

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE) file for details.

This project is open source and free to use, modify, and distribute under the GPL v3 license.

## Acknowledgments

### Built With
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's official CLI
- **[Gemini CLI](https://geminicli.com/docs/get-started/installation/)** - Google's Gemini command-line agent
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - User interface library
- **[Vite](https://vitejs.dev/)** - Fast build tool and dev server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** - Advanced code editor

### Also Thanks To
- **[Claude Code UI](https://github.com/siteboon/claudecodeui)** — Dr. Claw is based on it. See [NOTICE](NOTICE) for details.
- **[AI Researcher](https://github.com/HKUDS/AI-Researcher/)** (HKUDS) — Inspiration for research workflow and agentic research.

## Support & Community

### Stay Updated
- **Star** this repository to show support
- **Watch** for updates and new releases
- **Follow** the project for announcements

---

<div align="center">
  <strong>Dr. Claw — From idea to paper.</strong>
</div>
