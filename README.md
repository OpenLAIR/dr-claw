<div align="center">
  <img src="public/logo.svg" alt="Vibe Lab" width="64" height="64">
  <h1>Vibe Lab</h1>
</div>

A desktop and mobile UI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor CLI](https://docs.cursor.com/en/cli/overview) and [Codex](https://developers.openai.com/codex), with an integrated **Research Lab** for AI-driven research automation. You can use it locally or remotely to view your active projects and sessions, manage research pipelines, and make changes from everywhere (mobile or desktop).

 [English](./README.md) | [中文](./README.zh-CN.md)

## Screenshots

<div align="center">

<table>
<tr>
<td align="center">
<h3>Desktop View</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>Main interface showing project overview and chat</em>
</td>
<td align="center">
<h3>Mobile Experience</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>Responsive mobile design with touch navigation</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI Selection</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>Select between Claude Code, Cursor CLI and Codex</em>
</td>
</tr>
</table>



</div>

## Features

- **Research Lab** - Structured dashboard for AI-driven research: view overview, source papers, generated ideas (rendered as Markdown with LaTeX math), pipeline status, and cache artifacts at a glance
- **InnoFlow Skills** - Built-in modular research pipeline skills (orchestrator, resource preparation, idea generation, code survey, experiment development, experiment analysis, paper writing) that guide agents step-by-step
- **Responsive Design** - Works seamlessly across desktop, tablet, and mobile so you can also use Claude Code, Cursor, or Codex from mobile
- **Interactive Chat Interface** - Built-in chat interface for seamless communication with Claude Code, Cursor, or Codex
- **Integrated Shell Terminal** - Direct access to Claude Code, Cursor CLI, or Codex through built-in shell functionality
- **File Explorer** - Interactive file tree with syntax highlighting and live editing
- **Git Explorer** - View, stage and commit your changes. You can also switch branches
- **Session Management** - Resume conversations, manage multiple sessions, and track history
- **Model Compatibility** - Works with Claude Sonnet 4.5, Opus 4.5, and GPT-5.2


## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher
- At least one of the following CLI tools installed and configured:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  - [Cursor CLI](https://docs.cursor.com/en/cli/overview)
  - [Codex](https://developers.openai.com/codex)

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/bbsngg/VibeLab.git
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

4. **Start the application:**
```bash
# Development mode (with hot reload)
npm run dev
```

5. **Open your browser** at `http://localhost:3001` (or the port you configured in `.env`)

## Research Lab — Quick Example

The core feature of Vibe Lab is the **Research Lab**: an AI-driven research pipeline that takes a research topic and automatically generates ideas, writes experiment code, runs experiments, and analyzes results.

Here is how a typical research session looks:

### 1. Describe your research task

Open a project in Vibe Lab, switch to the **Chat** tab, and type something like:

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

The **orchestrator** skill automatically classifies this as an *idea-level* task, constructs the necessary metadata, and begins the pipeline.

### 2. The pipeline runs step-by-step

```
Orchestrator          →  Judges input maturity, sets up workspace
  ↓
Prepare Resources     →  Searches GitHub, clones reference repos, downloads papers
  ↓
Idea Generation       →  Generates 5 diverse ideas, selects & refines the best one
  ↓
Code Survey           →  Acquires extra repos, surveys codebases for reusable components
  ↓
Experiment Dev        →  Creates implementation plan, writes full project code,
                         iterates with a Judge agent, submits experiment (3–10 epochs)
  ↓
Experiment Analysis   →  Analyzes results, draws charts, suggests improvements,
                         implements refinements, runs further experiments
```

Each step produces cache artifacts (JSON logs) that you can inspect in the **Research Lab** dashboard.

### 3. Review results in the dashboard

Switch to the **Research Lab** tab to see:

- **Research Overview** — your task, chosen idea, pipeline mode
- **Generated Ideas** — rendered as rich Markdown with LaTeX math formulas
- **Pipeline Artifacts** — grouped by stage, with built-in viewer/editor
- **Experiment Results** — training logs, metrics, analysis reports, charts

All data lives in `instance.json`, `pipeline_config.json`, `Ideation/`, and `Experiment/` inside the project directory.

> **Tip**: You can also provide a *full implementation plan* instead of a topic. The orchestrator will detect it as *plan-level* and skip idea generation, jumping straight to code survey and experiment development.

## Security & Tools Configuration

**🔒 Important Notice**: All Claude Code tools are **disabled by default**. This prevents potentially harmful operations from running automatically.

### Enabling Tools

To use Claude Code's full functionality, you'll need to manually enable tools:

1. **Open Tools Settings** - Click the gear icon in the sidebar
3. **Enable Selectively** - Turn on only the tools you need
4. **Apply Settings** - Your preferences are saved locally

<div align="center">

![Tools Settings Modal](public/screenshots/tools-modal.png)
*Tools Settings interface - enable only what you need*

</div>

**Recommended approach**: Start with basic tools enabled and add more as needed. You can always adjust these settings later.

## Usage Guide

After starting Vibe Lab, open your browser and follow the steps below.

### Step 1 — Create or Open a Project

When you first open Vibe Lab you will see the **Projects** sidebar. You have two options:

- **Open an existing project** — Vibe Lab auto-discovers projects from Claude Code, Cursor, and Codex sessions. Click any listed project to open it.
- **Create a new project** — Click the **"+"** button, choose a directory on your machine, and Vibe Lab will set up the workspace for you.

### Step 2 — Choose Your CLI

In the project view, click the **CLI selector** (top of the sidebar) to pick which agent backend to use:

| Backend | When to use |
|---------|-------------|
| **Claude Code** | General-purpose coding agent by Anthropic |
| **Cursor CLI** | Cursor IDE's built-in agent |
| **Codex** | OpenAI's Codex agent |

You can switch between backends at any time without losing project context.

### Step 3 — Start Working

You have several ways to interact with your project:

| Tab | What it does |
|-----|-------------|
| **Chat** | Send prompts to the selected CLI agent. Supports streaming responses, session resume, message history, code blocks, and file references. |
| **Shell** | Drop directly into the CLI terminal for full command-line control. |
| **Files** | Browse the project file tree, view and edit files with syntax highlighting, create/rename/delete files. |
| **Git** | View diffs, stage changes, commit, and switch branches — all from the UI. |
| **Research Lab** | *(See below)* Structured dashboard for AI-driven research pipelines. |

### Step 4 (Optional) — Use the Research Lab

The **Research Lab** tab is designed for structured, multi-step AI research. It provides:

- **Research Overview** — Target paper, task description, instance ID, category, pipeline mode (Plan vs. Idea)
- **Source Papers** — All referenced papers with type badges
- **Final Selected Idea** — Rich Markdown rendering with LaTeX math (KaTeX), GFM tables, code blocks. Copy-to-clipboard and collapsible view
- **Pipeline Configuration** — Instance path, task level, category, dataset
- **Research Artifacts** — Log files grouped by pipeline stage with expand/collapse navigation and built-in viewer/editor

Data is loaded from `instance.json`, `pipeline_config.json`, `Ideation/`, and `Experiment/` within the project.

#### InnoFlow Research Pipeline

Vibe Lab ships with modular research skills under `skills/`. When a project is created, they are symlinked into `<project>/.claude/skills/` so the agent can discover and follow them automatically.

**Pipeline overview** (Idea mode):

```
Orchestrator → Prepare Resources → Idea Generation → Code Survey → Experiment Dev → Experiment Analysis → Paper Writing
```

| Skill | Purpose |
|-------|---------|
| **inno-research-orchestrator** | Entry point: judges input maturity (plan vs. idea), constructs instance JSON, sets up workspace |
| **inno-prepare-resources** | GitHub search, clone reference repos, download arXiv papers |
| **inno-idea-generation** | Generates N diverse ideas, selects and refines the best one |
| **inno-code-survey** | Phase A: acquire extra repos for the chosen idea; Phase B: comprehensive code survey |
| **inno-experiment-dev** | Creates implementation plan, writes project code with judge feedback loop, submits experiment |
| **inno-experiment-analysis** | Analyzes results, draws charts, gives code suggestions, implements refinements |
| **inno-paper-writing** | Write publication-ready ML/AI papers with LaTeX templates, citation verification, and conference checklists (NeurIPS, ICML, ICLR, ACL, AAAI, COLM) |

To start a research run, open the **Chat** tab and describe your research task (e.g. *"I want to research biomedical question answering"*). The orchestrator skill will guide the agent through the full pipeline.

### Mobile & Tablet

Vibe Lab is fully responsive. On mobile devices:

- **Bottom tab bar** for thumb-friendly navigation
- **Swipe gestures** and touch-optimized controls
- **Add to Home Screen** to use it as a PWA (Progressive Web App)

## Architecture

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
- **Agent Integration (Claude Code / Cursor CLI / Codex)** - Process spawning and management
- **File System API** - Exposing file browser for projects

### Frontend (React + Vite)
- **React 18** - Modern component architecture with hooks
- **CodeMirror** - Advanced code editor with syntax highlighting





### Contributing

We welcome contributions! Please follow these guidelines:

#### Getting Started
1. **Fork** the repository
2. **Clone** your fork: `git clone <your-fork-url>`
3. **Install** dependencies: `npm install`
4. **Create** a feature branch: `git checkout -b feature/amazing-feature`

#### Development Process
1. **Make your changes** following the existing code style
2. **Test thoroughly** - ensure all features work correctly
3. **Run quality checks**: `npm run lint && npm run format`
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

## Troubleshooting

### Common Issues & Solutions


#### "No Claude projects found"
**Problem**: The UI shows no projects or empty project list
**Solutions**:
- Ensure [Claude Code](https://docs.anthropic.com/en/docs/claude-code) is properly installed
- Run `claude` command in at least one project directory to initialize
- Verify `~/.claude/projects/` directory exists and has proper permissions

#### File Explorer Issues
**Problem**: Files not loading, permission errors, empty directories
**Solutions**:
- Check project directory permissions (`ls -la` in terminal)
- Verify the project path exists and is accessible
- Review server console logs for detailed error messages
- Ensure you're not trying to access system directories outside project scope


## License

GNU General Public License v3.0 - see [LICENSE](LICENSE) file for details.

This project is open source and free to use, modify, and distribute under the GPL v3 license.

## Acknowledgments

### Built With
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's official CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor's official CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - User interface library
- **[Vite](https://vitejs.dev/)** - Fast build tool and dev server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** - Advanced code editor

## Support & Community

### Stay Updated
- **Star** this repository to show support
- **Watch** for updates and new releases
- **Follow** the project for announcements

### Sponsors
- [Siteboon - AI powered website builder](https://siteboon.ai)
---

<div align="center">
  <strong>Vibe Lab — Made with care for the Claude Code, Cursor and Codex community.</strong>
</div>
