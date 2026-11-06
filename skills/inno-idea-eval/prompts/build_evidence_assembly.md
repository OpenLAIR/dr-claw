# Evidence Assembly

## Purpose
Compose persona-specific evidence blocks from existing pipeline artifacts. No new searches or downloads needed.

## Artifact Sources

| Artifact | Location | Content |
|----------|----------|---------|
| Source papers (LaTeX) | `Ideation/references/papers/` | Downloaded arXiv papers (.tex, .pdf) |
| Reference codebases | `Experiment/code_references/` | Cloned GitHub repositories |
| Paper list string | `references` parameter | Source papers from `Ideation/references/logs/load_instance.json` |
| Prepared resources | `prepare_res` parameter | `prepare_result` from `Ideation/references/logs/prepare_agent.json` |
| Task description | `data_module.TASK` | `task_instructions` from `load_instance.json`, else the task contract in `Ideation/ideas/idea_context.md` |
| Download log | `download_res` parameter | `Ideation/references/logs/download_arxiv_source_by_title.json` |

## Evidence Levels

### Level: `high` — Senior ML Researcher (Persona 1)

Include ALL available evidence:
- Full LaTeX source of all papers in `Ideation/references/papers/` (scan for .tex files)
- Complete repository contents from `Experiment/code_references/`
- Full `references` string
- Complete `prepare_res` text
- Full `data_module.TASK` description
- `download_res` log
- **Active Novelty Verification Report** (from Step 0.5)

Format:
```text
### Active Novelty Verification Report
{full content of novelty_grounding_report.txt from Step 0.5}

### Source Papers (Full Text)
[For each .tex file found in Ideation/references/papers/]
--- Paper: {filename} ---
{full LaTeX content or first 5000 chars if very long}

### Reference Codebases
[For each repo in Experiment/code_references/]
--- Repository: {repo_name} ---
{README content + key file listing}

### Task Context
{data_module.TASK}

### Prepared Resources
{prepare_res}
```

### Level: `medium` — Domain Expert (Persona 2)

Include summaries and task context:
- Paper titles and abstracts only (extract from .tex files or `references` string)
- Repository descriptions (README first paragraphs only)
- Full `data_module.TASK` description
- High-level summary from `prepare_res` (first paragraph or key conclusions)
- **Active Novelty Verification Report** (from Step 0.5)

Format:
```text
### Active Novelty Verification Report
{full content of novelty_grounding_report.txt from Step 0.5}

### Source Papers (Titles & Abstracts)
[For each paper]
- {title}: {abstract or first 200 words}

### Reference Codebases (Descriptions)
[For each repo]
- {repo_name}: {one-line description from README}

### Task Context
{data_module.TASK}
```

### Level: `medium` — Methods Specialist (Persona 3)

Include code-focused evidence:
- Paper titles only (from `references` string)
- Repository code structure (key files: model definitions, training scripts, config files)
- Implementation details from `prepare_res`
- Technical aspects of `data_module.TASK`
- **Active Novelty Verification Report** (from Step 0.5)

Format:
```text
### Active Novelty Verification Report
{full content of novelty_grounding_report.txt from Step 0.5}

### Source Papers (Titles)
[List of paper titles from references string]

### Reference Codebases (Code Details)
[For each repo]
--- Repository: {repo_name} ---
Key files: {list of .py files with brief descriptions}
Model architecture: {if found in code}
Training setup: {if found in code}

### Implementation Context
{relevant technical details from prepare_res}

### Task Description
{data_module.TASK}
```

## Standalone Mode

When pipeline artifacts are not available (standalone invocation with only `selected_idea`):

Evidence block for all personas:
```text
### Evidence Status: Standalone Evaluation (with Active Novelty Verification)
No pipeline artifacts are available for this evaluation. However, Active Novelty
Verification (Step 0.5) has been performed — the literature search results below
provide grounding for novelty assessment. Other dimensions (Validity, Feasibility)
are evaluated based on the idea's internal consistency, clarity of presentation, and
the reviewer's domain knowledge.

### Active Novelty Verification Report
{full content of novelty_grounding_report.txt from Step 0.5}

### Task Context
[If data_module.TASK is available, include it; otherwise note "Not provided"]
```

If Active Novelty Verification also failed (all searches returned errors), use:
```text
### Evidence Status: Ungrounded Evaluation
No pipeline artifacts are available and novelty verification searches failed. The idea
is being evaluated based solely on its internal consistency, clarity of presentation,
and the reviewer's domain knowledge. Scores for Novelty and Validity should be
interpreted with caution as they cannot be verified against existing literature.

### Task Context
[If data_module.TASK is available, include it; otherwise note "Not provided"]
```

## Assembly Function

For each persona:
1. Check which artifacts are available (test file/directory existence)
2. Select the appropriate evidence level
3. Build the evidence block using the format template above
4. If any artifact is missing, note it in the evidence block but proceed
5. Return the formatted evidence block string
