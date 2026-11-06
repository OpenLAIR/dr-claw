---
name: inno-prepare-resources
description: >
  Prepares the research materials for a project: collects the source papers,
  searches GitHub for their code, picks and clones reference codebases,
  describes the datasets, and downloads arXiv paper sources into
  Ideation/references/papers. Works from the research brief, the user's paper
  list, or instance.json. Use before inno-idea-generation or inno-code-survey,
  or when the user asks to gather papers and code for a research task.
---

# Inno Prepare Resources

Gather the papers, code, and dataset notes that the later pipeline steps read:

```
inno-prepare-resources   ← this skill
   ├─ Ideation/references/papers/          paper sources   → inno-idea-generation, inno-idea-eval, inno-code-survey
   ├─ Experiment/code_references/<repo>/   cloned repos    → inno-code-survey, inno-experiment-dev
   ├─ Ideation/references/dataset_description.md            → inno-idea-generation, inno-experiment-dev
   └─ Ideation/references/logs/*.json      structured results (prepare_res, download_res)
```

You do every step yourself with ordinary tools (shell, web, the bundled
script). There is no separate agent or orchestrator to call.

## Modes

- **Idea mode** (default): no idea exists yet. Choose codebases that are the
  most useful general starting points for the task.
- **Plan mode**: an idea already exists (`Ideation/ideas/selected_idea.txt`, or
  text the user gives). Choose codebases that implement the parts the idea
  needs.

## Inputs

Paths come from `instance.json` (`Ideation.references`, `Experiment.code_references`,
`Experiment.datasets`). They are absolute in Dr. Claw projects; if relative,
resolve with `path.join(project_path, value)`. If `instance.json` is missing,
use `<project>/Ideation/references`, `<project>/Experiment/code_references`,
and `<project>/Experiment/datasets`.

Take the **task** and the **source papers** from the first of these that has
them:

| Priority | Source | Task | Source papers |
|----------|--------|------|---------------|
| 1 | The user's request | What they describe | Titles, arXiv ids, or links they give |
| 2 | `instance.json` (benchmark instances only) | `task2` (Idea mode) or `task1` (Plan mode), if present | `source_papers[].reference`, if present |
| 3 | `.pipeline/docs/research_brief.json` | `sections.ideation.research_goal` + `problem_framing` | `sections.survey.key_references` |
| 4 | `Survey/reports/`, `Survey/references/` | Earlier survey summary | Papers listed there |

Dr. Claw's own `instance.json` holds only paths; `task1`, `task2`, and
`source_papers` exist only in imported benchmark instances. Do not fail when
they are absent.

If no source papers are found, ask the user for 3–10 key papers, or offer to
run a short literature search first (`inno-deep-research` or
`academic-researcher`) and use its top results.

Optional:

| Input | Description |
|-------|-------------|
| `date_limit` | `YYYY-MM-DD`. Ignore repositories created after this date (to reproduce a paper's setting). From `instance.json` `date_limit` if present, otherwise none |
| `dataset_description` | A description the user already wrote; use it as-is in Step 4 |

## Outputs

```
Ideation/references/
├── papers/<arxiv_id>/               ← LaTeX sources (or paper.pdf) + paper_meta.json
├── dataset_description.md           ← Step 4
└── logs/
    ├── load_instance.json           ← Step 1: task, mode, source papers, date_limit
    ├── github_search.json           ← Step 2
    ├── prepare_agent.json           ← Step 3: prepare_result (selected repos and papers)
    └── download_arxiv_source_by_title.json   ← Step 5: download_res
Experiment/code_references/<repo>/   ← Step 3: shallow clones of the selected repos
```

The log file names are kept stable because `inno-idea-eval` and
`inno-code-survey` read `prepare_res` and `download_res` from them. Each
tool log uses:

```json
{ "name": "<step name>", "args": { "...": "..." }, "result": "<result>" }
```

## Step-by-step instructions

### Step 1 — Load the task and source papers

Resolve the paths, then read the inputs in the priority order above. Decide
the mode (Plan if an idea is available, else Idea). Normalise the source
papers into a list of `{ "title", "arxiv_id" (if known), "why" }`.

**Save** → `logs/load_instance.json`:

```json
{
  "name": "load_instance",
  "args": { "instance": "<path to instance.json or null>", "mode": "idea | plan" },
  "result": {
    "task_instructions": "<task text>",
    "task_source": "user | instance | research_brief | survey",
    "source_papers": [ { "title": "...", "arxiv_id": "...", "why": "..." } ],
    "date_limit": "YYYY-MM-DD or null"
  }
}
```

If this file already exists and the user did not change the task or papers,
reuse it.

### Step 2 — Search GitHub for each source paper

For each paper, search repositories by its title (and, if the title is long or
generic, by the method name plus "pytorch" or "code"). Wait about 2 seconds
between calls; set `GITHUB_TOKEN` if available for a higher rate limit. Use
whichever is available:

```bash
# GitHub CLI
gh search repos "<paper title>" --limit 10 --json fullName,description,url,stargazersCount,createdAt

# Plain HTTP
curl -s -H "Accept: application/vnd.github+json" \
  "https://api.github.com/search/repositories?q=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "<paper title>")&per_page=10"
```

If `inno-code-survey` is installed next to this skill, its
`scripts/github_search_clone.py --query "<title>" --limit 10 [--date-limit YYYY-MM-DD]`
does the same with filtering built in.

Also check the paper itself for an official code link (abstract page, the
LaTeX source's footnotes, or the authors' project page). Prefer official repositories.

If there are no source papers, run one search with the task's key terms.

**Save** → `logs/github_search.json` with `args.source_papers` and, as
`result`, one block per paper:

```
Paper: <title>
    Name: owner/repo | Stars: 1234 | Created: 2023-05-01
    Description: ...
    Link: https://github.com/owner/repo
******************************
```

### Step 3 — Select and clone reference codebases

Choose **at least 5** repositories (fewer only if fewer relevant ones exist)
using these criteria, in order:

1. Official implementation of a source paper, or a widely used reimplementation.
2. Covers the task's data pipeline, model, training, and evaluation (the
   pieces an experiment will reuse).
3. Plan mode: implements a component the idea needs.
4. Maintained, documented, runnable (recent commits, README with usage, a
   requirements file), with a permissive license.
5. Created before `date_limit`, if one is set.

Clone each selected repo shallowly:

```bash
git clone --depth 1 <url> "<Experiment.code_references>/<repo_name>"
```

Skip repos that already exist there. Read each clone's README to confirm it is
what you expected; drop and replace any that are not.

Also choose `reference_papers`: the source papers worth downloading in full
(normally all of them, plus papers of the selected repos if they differ).

**Save** → `logs/prepare_agent.json`:

```json
{
  "context_variables": {
    "references_path": "<Ideation.references>",
    "code_references_path": "<Experiment.code_references>",
    "datasets_path": "<Experiment.datasets>",
    "date_limit": "YYYY-MM-DD or null",
    "mode": "idea | plan",
    "prepare_result": {
      "reference_codebases": ["owner/repo1", "owner/repo2"],
      "reference_paths": ["Experiment/code_references/repo1", "Experiment/code_references/repo2"],
      "reference_papers": ["paper title 1", "paper title 2"],
      "reasoning": "<one or two sentences per repo: why it was chosen>"
    }
  }
}
```

`prepare_res`, as later skills call it, is this `prepare_result` together with
its reasoning.

### Step 4 — Describe the datasets

Write `dataset_description.md` from, in order: the user's description; the
brief's `sections.experiment.dataset_or_data_source`; what is already in
`Experiment/datasets/`; the datasets used by the source papers and the cloned
repos (their READMEs and data loaders). Use this structure:

```markdown
## Datasets
<name, size, splits, format, licence, where to get it, whether it is already in Experiment/datasets/>

## Baselines
<representative methods and which cloned repo implements each>

## Reported results
<numbers from the source papers, each with its citation>

## Evaluation metrics
<metrics and how each is computed; point to the code that computes it>

## Notes
<preprocessing, known pitfalls, data access requirements>
```

Write "unknown" rather than guessing. If the right datasets are still unclear,
suggest the `dataset-discovery` skill.

### Step 5 — Download paper sources

Download the LaTeX sources of `reference_papers` with the bundled script
(standard library only, run it from this skill's directory or by full path):

```bash
python3 scripts/download_arxiv_sources.py \
  --out "<Ideation.references>/papers" \
  --title "<paper title 1>" --title "<paper title 2>" \
  --id 2106.09685
```

It looks each paper up on arXiv, extracts the e-print into
`papers/<arxiv_id>/` (or saves `paper.pdf` when no source is available),
writes `paper_meta.json`, and prints a JSON summary. Use `--id` when the arXiv
id is known; it is more reliable than a title. For papers it reports as
`not_found` (not on arXiv, or the title differs), find the PDF from the
publisher or the authors' page if it is openly available, save it under
`papers/`, and note it; otherwise list it as missing.

**Save** → `logs/download_arxiv_source_by_title.json`, with `args.paper_list`,
`args.references_path`, and the script's JSON summary as `result`.
`download_res`, as later skills call it, is this result.

### Step 6 — Report

Tell the user, briefly: the mode, how many papers were downloaded (and which
are missing), the selected repositories with one line each, where
`dataset_description.md` is, and the next step (`inno-idea-generation` in Idea
mode, `inno-code-survey` in Plan mode).

## Checklist

- [ ] Paths resolved from `instance.json` (or defaults); task and source papers loaded; `logs/load_instance.json` written
- [ ] GitHub searched per paper; `logs/github_search.json` written
- [ ] At least 5 relevant repos selected (or all that exist), cloned to `Experiment/code_references/`, READMEs checked
- [ ] `logs/prepare_agent.json` written with `reference_codebases`, `reference_paths`, `reference_papers`, reasoning
- [ ] `dataset_description.md` written, with "unknown" where not known
- [ ] Paper sources downloaded to `Ideation/references/papers/`; `logs/download_arxiv_source_by_title.json` written
- [ ] User told the result, including missing papers, and the next step
