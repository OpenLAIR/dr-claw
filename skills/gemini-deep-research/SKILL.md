---
name: gemini-deep-research
description: |
  Perform deep, multi-source research using Google Gemini's Deep Research Agent.
  Use this skill whenever the user asks for comprehensive research, literature reviews,
  competitive analysis, market research, technology surveys, or any investigation that
  requires synthesizing information from many web sources. Also trigger when the user
  says "deep research", "research this thoroughly", "do a comprehensive study on",
  or wants a structured report with evidence gathered from across the web —
  even if they don't mention Gemini by name.
license: MIT
metadata:
  author: clawdbot
  version: "1.1.0"
  requires:
    env:
      - GEMINI_API_KEY
---

# Gemini Deep Research

Google Gemini's Deep Research Agent autonomously breaks down complex queries, searches the web systematically, and produces structured markdown reports with citations. It handles the kind of multi-source synthesis that would take a human hours of browsing.

## Prerequisites

- `GEMINI_API_KEY` environment variable must be set (obtain from [Google AI Studio](https://aistudio.google.com/apikey))
- Python 3.8+ (dependencies are auto-installed in the project's `.venv`)
- Requires a direct Gemini API key — OAuth tokens are not supported

## How to Run the Script

The script is at `scripts/deep_research.py` **relative to this skill's directory** (i.e., the directory containing this SKILL.md). Resolve the full path from the skill's location before running.

```bash
.venv/bin/python3 <this-skill-directory>/scripts/deep_research.py \
  --query "<research query>" \
  --stream \
  --output-dir ./reports
```

### Key flags

| Flag | Purpose | Default |
|------|---------|---------|
| `--query` | **(required)** The research question | — |
| `--stream` | Print progress updates while waiting | off |
| `--output-dir` | Where to save the report files | current dir |
| `--format` | Custom output structure (see example below) | free-form |
| `--file-search-store` | Gemini file-search store name | none |
| `--api-key` | Override `GEMINI_API_KEY` env var | env var |

### Before running

1. **Check for `GEMINI_API_KEY`**: Run `echo $GEMINI_API_KEY` to see if it's set. If empty, **ask the user** whether they'd like to provide a Gemini API key (they can get one from https://aistudio.google.com/apikey). If the user provides one, pass it via `--api-key`. If the user declines, **do not use this skill** — fall back to other research approaches and let the user know why.
2. Ensure `requests` is installed: `python3 -c "import requests"`. If missing, install it: `pip3 install requests`.

### Example commands

**Basic research:**
```bash
.venv/bin/python3 <this-skill-directory>/scripts/deep_research.py \
  --query "Current state of quantum error correction techniques" \
  --stream --output-dir ./reports
```

**Custom output format:**
```bash
.venv/bin/python3 <this-skill-directory>/scripts/deep_research.py \
  --query "Competitive landscape of EV batteries" \
  --format "1. Executive Summary\n2. Key Players (data table)\n3. Technology Comparison\n4. Supply Chain Risks" \
  --stream --output-dir ./reports
```

## Output

The script produces two timestamped files in the output directory:
- `deep-research-YYYY-MM-DD-HH-MM-SS.md` — the final markdown report
- `deep-research-YYYY-MM-DD-HH-MM-SS.json` — full interaction metadata

The report is also printed to stdout so you can capture it directly.

## Execution Notes

- This is a **long-running** task — it typically takes 2–10 minutes depending on query complexity. Use `--stream` so the user can see progress.
- Always run with a reasonable timeout (at least 600000ms / 10 minutes) when using the Bash tool.
- After the script finishes, read and present the generated `.md` report to the user. Summarize key findings and point them to the full report file.

## API Details

- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/interactions`
- **Agent model**: `deep-research-pro-preview-12-2025`
- **Auth**: `x-goog-api-key` header
