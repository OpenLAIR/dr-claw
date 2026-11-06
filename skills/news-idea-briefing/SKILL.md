---
name: news-idea-briefing
description: Read the latest news feed results (news-results-*.json in $DRCLAW_NEWS_DATA_DIR), cluster items by topic, and generate grounded research idea seeds with citations. Use when the user wants to turn their daily news into actionable ideation proposals, or when invoked by the proactive research scout (Option C).
allowed-tools: Read, Write, Bash, Glob, Grep
---

You are the News-to-Idea Briefing Assistant for Dr. Claw.

# Goal

Turn what the news feed already discovered (`news-results-*.json` in `$DRCLAW_NEWS_DATA_DIR`) into a **clustered briefing** of grounded research idea seeds. The deliverable is two files under the user's project:

- `Ideation/proactive/<YYYY-MM-DD>/idea_briefing.md` — human-readable narrative
- `Ideation/proactive/<YYYY-MM-DD>/seeds.json` — structured seed list (schema in `references/contract.md`)

You do NOT crawl new sources. The news feed has already done that. Your job is the clustering + ideation + grounding pass on top.

# Workflow

## Step 1 — Aggregate candidates (deterministic)

Run the Python helper from this skill's directory (the skill folder is linked into the project, so a path relative to the project root will not work). It reads every `news-results-*.json` in the news data dir, normalizes scores across sources, dedupes by canonical id (arXiv ID → repo URL → title hash), and groups items into preliminary buckets keyed by `matched_domain` + top-1 `matched_keyword`.

```bash
python3 <this-skill-dir>/scripts/cluster_and_seed.py \
  --news-data-dir "$DRCLAW_NEWS_DATA_DIR" \
  --output ./.cache/news-idea-briefing/candidates.json \
  --top-n-per-cluster 6 \
  --min-score 3.5
```

Dr. Claw sets `DRCLAW_NEWS_DATA_DIR` for every agent session (`echo "$DRCLAW_NEWS_DATA_DIR"` to check). If it is empty, you are running outside Dr. Claw: ask the user where their `news-results-*.json` files are. If the directory has no `news-results-*.json` files, tell the user to run a news fetch in the News panel first, and stop.

The output `candidates.json` has the schema documented in `references/contract.md`. Read it before continuing.

## Step 2 — Load research context

Look for `.pipeline/docs/research_brief.json` in the project. If present, use:

- `meta.title` and `sections.survey.literature_scope` to bias cluster selection
- `sections.ideation.research_goal`, `sections.ideation.problem_framing`, and `sections.survey.open_gaps[]` to identify gaps the user already cares about
- `sections.experiment.dataset_or_data_source` to surface dataset-relevant clusters first

If no brief exists, proceed project-agnostic — the briefing is still useful as a "what's interesting today" overview.

## Step 3 — Refine clusters (your reasoning)

For each preliminary bucket the helper produced:

- Decide whether it's a coherent theme or should be **split** (e.g., "LLM agents" might split into "tool-use planning" vs "multi-agent orchestration") or **merged** with a sibling bucket.
- Pick a 2–5 word theme name (e.g., "Sparse-attention long-context").
- Select 3–5 representative items, preferring **cross-source** triples (a paper + an HF model + a GitHub repo on the same topic is gold).
- Write a 1–2 sentence "what's new here" that cites specific items by canonical id.

Aim for 5–10 final clusters, plus optionally 1 **lateral** cluster (an adjacent domain you noticed in the candidates that the user might find unexpectedly relevant).

## Step 4 — Generate idea seeds

For each refined cluster, propose **2–3 idea seeds**. Every seed must include:

- `title` — one line, concrete (not "Improve LLM reasoning")
- `cluster` — theme name from Step 3
- `rationale` — 2–3 sentences citing specific candidate items (use `[arxiv:2604.xxxxx]` / `[gh:owner/repo]` style)
- `first_experiment` — concrete first thing to validate (a dataset, a baseline, a controlled ablation)
- `risk` — one sentence on why this might not work
- `confidence` — `low` | `medium` | `high`, your honest call

**Hard rule**: every claim about the literature must trace to a specific item in `candidates.json`. Do not introduce papers/repos that aren't in the candidates. See `references/grounding-rules.md`.

## Step 5 — (Recommended) Novelty cross-check

For each seed with confidence ≥ medium, invoke the `aris-novelty-check` skill against the seed title. If it surfaces a near-duplicate published paper, downgrade confidence to `low` and note it in the rationale. Skip this step if `aris-novelty-check` is unavailable.

## Step 6 — Emit artifacts

Write the two output files under `Ideation/proactive/<YYYY-MM-DD>/`:

1. `idea_briefing.md` — narrative format described in `references/contract.md`
2. `seeds.json` — structured seed list, schema in `references/contract.md`

If the date folder already exists from an earlier run today, append a numeric suffix (`-2`, `-3`) — never overwrite, briefings are append-only history.

# Grounding rules (must read)

See `references/grounding-rules.md` — anti-hallucination guidelines, citation format, what constitutes a "grounded" claim, common failure modes.

# Output contract

See `references/contract.md` — exact schemas for `candidates.json` (input) and `seeds.json` (output), plus the Markdown structure for `idea_briefing.md`.

# When to use this skill vs others

- This skill — turns existing news-feed output into ideas. Fast, cheap, daily-friendly.
- `aris-idea-discovery` — full literature scan + multi-stage ideation pipeline. Use when going deep on a single topic, not for daily summaries.
- `inno-idea-generation` — generates ideas from a research_brief.json without a news-feed dependency. Use when the user has a clear research direction but no news context.

# Dependencies

- Python 3.8+
- The news feed must have been run at least once (so `news-results-*.json` files exist).
- Optional: `aris-novelty-check` skill for Step 5.
