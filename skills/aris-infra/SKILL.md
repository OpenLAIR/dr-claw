---
name: aris-infra
description: |
  ARIS (Auto-claude-code-research-in-sleep) infrastructure setup and configuration.
  Configures MCP servers for cross-model adversarial review, installs Python tools,
  and validates environment. Run this first before using any other ARIS skills.
  Use when: setting up ARIS, configuring review servers, "aris setup", "配置ARIS".
license: MIT
metadata:
  author: wanshuiyin/ARIS
  version: "1.0.0"
  repository: https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# ARIS Infrastructure Setup

## Quick Start (One Command)

```bash
bash skills/aris-infra/setup.sh
```

This interactive script will: check prerequisites → install dependencies → register skills → configure MCP reviewer server.

---

## Manual Setup (if you prefer)

## Overview

ARIS uses **cross-model adversarial review** — Claude Code executes research tasks while an external LLM (GPT-5.4, Gemini, or others) provides critical review. This avoids the "self-play blind spot" where a single model reviewing its own work produces predictable feedback.

## Prerequisites

- Python 3.10+
- Claude Code CLI
- At least one external LLM API key (OpenAI, Google Gemini, or MiniMax)

## Step 1: Register MCP Servers

ARIS provides the following MCP servers. Register the ones you need:

### Core: Codex reviewer (capability-gated) — Recommended
```bash
npm install -g @openai/codex
claude mcp add codex -s user -- python3 "$(pwd)/skills/aris-infra/mcp-servers/codex-exec/server.py"
```
Inspect any existing registration before replacing it. Authenticate Codex separately.
Workflow M pins the requested model/effort and read-only sandbox per call; see
[reviewer capability gates](shared-references/reviewer-routing.md). Do not assume
that registration proves a model is available.

### Alternative: Generic LLM Chat (Any OpenAI-compatible API)
```bash
claude mcp add llm-chat -s user -- python skills/aris-infra/mcp-servers/llm-chat/server.py
```
Environment variables:
- `LLM_API_KEY` — API key
- `LLM_BASE_URL` — API base URL (e.g., `https://api.openai.com/v1`)
- `LLM_MODEL` — Model name (e.g., `gpt-4o`)
- `LLM_FALLBACK_MODEL` — Fallback model on 504 errors

### Alternative: Gemini Review
```bash
claude mcp add gemini-review -s user -- python skills/aris-infra/mcp-servers/gemini-review/server.py
```
Environment variables:
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` — Google AI API key
- `GEMINI_REVIEW_MODEL` — Model (default: `gemini-2.5-pro`)

### Alternative: Claude Review (Cross-session)
```bash
claude mcp add claude-review -s user -- python skills/aris-infra/mcp-servers/claude-review/server.py
```
Uses the `claude` CLI binary for reviews in a separate session.

### Optional: MiniMax Chat
```bash
claude mcp add minimax-chat -s user -- python skills/aris-infra/mcp-servers/minimax-chat/server.py
```
Environment variables:
- `MINIMAX_API_KEY` — MiniMax API key
- `MINIMAX_MODEL` — Model (default: `MiniMax-M2.7`)

### Optional: Feishu/Lark Notifications
```bash
claude mcp add feishu-bridge -s user -- python skills/aris-infra/mcp-servers/feishu-bridge/server.py
```
Environment variables:
- `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_USER_ID`
- `BRIDGE_PORT` — HTTP server port (default: 9100)

## Step 2: Install Python Dependencies

```bash
pip install httpx arxiv requests
```

## Step 3: Verify Setup

```bash
# Check MCP servers are registered
claude mcp list

# Test a tool call
# If using Codex: mcp__codex__codex should be available
# If using llm-chat: mcp__llm-chat__chat should be available
```

## Available Workflows

After setup, use these one-click workflow skills:

| Skill | Command | Description |
|-------|---------|-------------|
| `aris-idea-discovery` | `/aris-idea-discovery` | Full idea pipeline: literature → ideas → novelty → review → refine |
| `aris-experiment-bridge` | `/aris-experiment-bridge` | Implement experiments, deploy to GPU, collect results |
| `aris-auto-review-loop` | `/aris-auto-review-loop` | Multi-round cross-model adversarial review |
| `aris-paper-writing` | `/aris-paper-writing` | Plan → figures → write LaTeX → compile → improve |
| `aris-rebuttal` | `/aris-rebuttal` | Parse reviews → strategy → draft → stress test |
| `aris-research-pipeline` | `/aris-research-pipeline` | End-to-end: idea → experiments → review → paper |

## Bundled Resources

### MCP Servers (`mcp-servers/`)
- `codex-exec/server.py` — Codex MCP bridge over current `codex exec`
- `llm-chat/server.py` — Generic OpenAI-compatible bridge
- `gemini-review/server.py` — Gemini review with async jobs
- `claude-review/server.py` — Claude Code CLI review bridge
- `minimax-chat/server.py` — MiniMax-specific bridge
- `feishu-bridge/server.py` — Feishu/Lark notification bridge

### Python Tools (`tools/`)
- `arxiv_fetch.py` — arXiv search and PDF download
- `semantic_scholar_fetch.py` — Semantic Scholar search with filters
- `research_wiki.py` — Persistent research knowledge base
- `watchdog.py` — GPU training/download monitoring daemon

### Templates (`templates/`)
- `RESEARCH_BRIEF_TEMPLATE.md` — Research direction input
- `RESEARCH_CONTRACT_TEMPLATE.md` — Active idea working document
- `EXPERIMENT_PLAN_TEMPLATE.md` — Claim-driven experiment roadmap
- `EXPERIMENT_LOG_TEMPLATE.md` — Structured experiment results
- `NARRATIVE_REPORT_TEMPLATE.md` — Paper writing input
- `PAPER_PLAN_TEMPLATE.md` — Claims-evidence matrix
- `IDEA_CANDIDATES_TEMPLATE.md` — Compact top ideas
- `FINDINGS_TEMPLATE.md` — Cross-stage discovery log

## Troubleshooting

- **MCP server not found**: Ensure `claude mcp add` was run with `-s user` flag
- **API key errors**: Set environment variables in your shell profile (~/.zshrc or ~/.bashrc)
- **Python import errors**: Run `pip install httpx arxiv requests`
- **Codex not installed**: Run `npm install -g @openai/codex`

## Workflow M: opt-in self-evolution

See [setup and safety](../../docs/aris-self-evolution.md) before enabling logging.
`/aris-meta-optimize` analyzes evidence and stages proposals; `/aris-meta-apply`
is a separate human-only landing gate. Neither setup nor the workflows auto-enable
hooks. Preview/merge with `tools/meta_opt/configure.py --project <root> --logging`;
only an explicit `--apply` writes backed-up merged settings. Never overwrite
`.claude/settings.json`. Global event logging and the corpus-write guard are
separate opt-ins. Keep the three skills together for helper/reference resolution.

Helpers: `tools/meta_opt/{log_event.sh,check_ready.sh,trigger_eval.py}`, plus
`tools/{capture_filter.py,provenance.py,save_trace.sh}`. Trigger evaluation requires
explicit approval: it starts real Claude sessions, not an offline smoke check.
See [upstream provenance and adaptations](UPSTREAM.md).
