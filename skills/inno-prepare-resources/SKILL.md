---
name: inno-prepare-resources
description: >
  Loads the evaluation instance, searches GitHub for related repositories,
  builds a dataset description, queries the Prepare Agent for reference codebases,
  and downloads arXiv paper sources.
  Covers both Idea mode and Plan mode (the only difference is whether innovative
  ideas are included in the Prepare Agent query).
---

# Inno Prepare Resources

## Inputs

| Parameter              | Required | Description |
|------------------------|----------|-------------|
| `instance_path`        | Yes      | Path to the evaluation instance JSON file (contains `source_papers`, `task1`/`task2`, `url`, etc.) |
| `task_level`           | Yes      | Which task field to read from the instance — `"task1"` (Plan) or `"task2"` (Idea) |
| `references_path`      | Yes      | Path to `Ideation/references/` — for downloaded papers and prepare logs |
| `code_references_path` | Yes      | Path to `Experiment/code_references/` — for cloned repos |
| `datasets_path`        | Yes      | Path to `Experiment/datasets/` — for dataset files |
| `category`             | Yes      | Research category tag (e.g. `nlp_qa`, `gnn`, `recommendation`). Used to locate the built-in dataset metaprompt |
| `references`           | Yes      | A pre-formatted string listing all source papers from the instance |
| `context_variables`    | Yes      | Shared context dictionary; this step will write `date_limit` into it |
| `ideas`                | No       | Full innovative-idea / plan text. **Provide only in Plan mode** — when present the Prepare Agent query includes the ideas for more targeted repo selection |
| `dataset_description`  | No       | Pre-built dataset description from the orchestrator (for custom / user-provided datasets). When provided, skip the metaprompt import in Step 3 |

## Outputs

| Output                 | Description |
|------------------------|-------------|
| `prepare_res`          | Full text response from the Prepare Agent (contains selected reference repositories and reasoning) |
| `download_res`         | Result log from downloading arXiv paper sources to local disk |
| `dataset_description`  | Composed prompt string describing the datasets, baselines, comparisons, and evaluation metrics |
| `data_module`          | The imported metaprompt module object (Idea mode). In Plan mode this is not returned |
| `context_variables`    | Updated with `date_limit` (str, YYYY-MM-DD) |

## Cache file outputs

Every intermediate result must be persisted as a JSON file under `Ideation/references/logs/`. The directory layout follows:

```
Ideation/references/logs/
├── load_instance.json                  ← written by orchestrator
├── github_search.json
├── download_arxiv_source_by_title.json
└── prepare_agent.json
```

> `Ideation/references/logs/load_instance.json` is written by the **orchestrator** before this skill runs — do not overwrite it.

### Tool cache format (`tools/*.json`)

Each tool output file records the function call arguments and result:

```json
{
  "name": "<tool_name>",
  "args": { ... },
  "result": <result_value>
}
```

**`github_search.json`** — written after Step 2:

```json
{
  "name": "github_search",
  "args": {
    "metadata": {
      "source_papers": [ ... ],
      "task_instructions": "...",
      "date_limit": "YYYY-MM-DD"
    }
  },
  "result": "<concatenated github_result string>"
}
```

**`download_arxiv_source_by_title.json`** — written after Step 6:

```json
{
  "name": "download_arxiv_source_by_title",
  "args": {
    "paper_list": ["paper title 1", "paper title 2"],
    "references_path": "<references_path>"
  },
  "result": "<download result log string>"
}
```

### Agent cache format (`agents/*.json`)

Each agent output file records the final context variables (no conversation messages):

```json
{
  "context_variables": {
    "references_path": "<references_path>",
    "code_references_path": "<code_references_path>",
    "datasets_path": "<datasets_path>",
    "date_limit": "YYYY-MM-DD",
    "prepare_result": {
      "reference_codebases": ["repo1", "repo2"],
      "reference_paths": ["Experiment/code_references/repo1", "Experiment/code_references/repo2"],
      "reference_papers": ["paper title 1", "paper title 2"]
    }
  }
}
```

**`prepare_agent.json`** — written after Step 4–5. Contains the final `context_variables` with `prepare_result` holding `reference_codebases`, `reference_paths`, and `reference_papers`.

## Step-by-step Instructions

### Step 1 — Load the evaluation instance

Call `load_instance(instance_path, task_level)`.

This reads the instance JSON and returns an **EvalMetadata** object containing:

- `source_papers` — list of dicts, each with `reference`, `rank`, `type`, `justification`, `usage`
- `task_instructions` — the task description text (from the field named by `task_level`)
- `date_limit` — the publication date of the target paper (fetched from arXiv via the instance `url`); defaults to `"2024-01-01"` if metadata cannot be retrieved

Write `date_limit` into `context_variables["date_limit"]`.

> **Note**: `Ideation/references/logs/load_instance.json` should already exist — it was written by the orchestrator. If not, write it now following the tool cache format.

> **Graceful handling**: If the instance JSON was constructed by the orchestrator and has no `url` or an empty `source_papers` list, use a sensible default `date_limit` and continue — do not raise an error.

### Step 2 — Search GitHub for related repositories

Call `github_search(metadata)`.

Iterate over every entry in `metadata["source_papers"]`. For each paper, use its `reference` (title) as the search query and call the GitHub Search Repositories API:

```
GET https://api.github.com/search/repositories?q=<paper_title>&per_page=10&page=1
```

From each result item, extract:
- **name**: `{owner}/{repo}`
- **description**: repository description
- **link**: `html_url`

Format each paper's results as a human-readable block:

```
Here are some of the repositories I found on GitHub:
    Name: owner/repo
    Description: ...
    Link: https://github.com/owner/repo
```

Concatenate all papers' results into a single `github_result` string, using a `******************************` separator between papers.

**Rate-limit handling**: wait ~2 seconds between consecutive GitHub API calls to avoid HTTP 403 throttling. The last paper does not need a delay.

> **Fallback when `source_papers` is empty**: use keywords extracted from `task_instructions` as the search query instead, and perform a single GitHub search call to find relevant repositories.

**Save** → `Ideation/references/logs/github_search.json`

### Step 3 — Build the dataset description

Choose one of the following strategies (in priority order):

1. **Orchestrator override** — if `dataset_description` was passed as input, use it directly.
2. **Built-in metaprompt** — if `category` maps to an existing metaprompt module, import it and compose the description from its five fields:
   - `TASK` — what the task is about
   - `DATASET` — dataset files, structure, and loading instructions
   - `BASELINE` — representative baseline methods
   - `COMPARISON` — performance comparison table
   - `EVALUATION` — evaluation metrics and scoring functions
   - `REF` — additional references and notes

   The composed description follows this template:

   ```
   You should select SEVERAL datasets as experimental datasets from the following description:
   {DATASET}

   We have already selected the following baselines for these datasets:
   {BASELINE}

   The performance comparison of these datasets:
   {COMPARISON}

   And the evaluation metrics are:
   {EVALUATION}

   {REF}
   ```

3. **Manual / minimal** — if neither of the above is available, construct a minimal description from what is known about the task (e.g. from `task_instructions`), or ask the user for additional information.

Also retain the `data_module` object (the imported metaprompt module) for later use in Idea mode.

### Step 4 — Query the Prepare Agent

Build the query depending on mode:

- **Idea mode** (no `ideas` provided):

  ```
  You are given a list of papers, searching results of the papers on GitHub.
  List of papers:
  {references}

  Searching results of the papers on GitHub:
  {github_result}

  Your task is to choose at least 5 repositories as the reference codebases.
  Note that this time there is no innovative ideas, you should choose the
  most valuable repositories as the reference codebases.
  ```

- **Plan mode** (`ideas` provided):

  ```
  You are given a list of papers, searching results of the papers on GitHub,
  and innovative ideas according to the papers.
  List of papers:
  {references}

  Searching results of the papers on GitHub:
  {github_result}

  innovative ideas:
  {ideas}

  Your task is to choose at least 5 repositories as the reference codebases.
  ```

Send the query to the **Prepare Agent** and record the full response as `prepare_res`.

**Save** → `Ideation/references/logs/prepare_agent.json` (final context_variables only, no messages)

### Step 5 — Extract reference paper list

Parse `prepare_res` to extract a JSON object containing `"reference_papers"` (a list of paper title strings the agent selected).

Use bracket-matching JSON extraction — find the first complete `{…}` in the text, parse it, and read `reference_papers`.

**Fallback**: if `reference_papers` is empty (e.g. the agent found no GitHub repos and returned nothing), fall back to the original `source_papers` titles from the instance metadata so that paper download can still proceed.

### Step 6 — Download arXiv paper sources

Call `download_arxiv_source_by_title(paper_list, references_path)`.

This searches arXiv for each paper title, downloads the LaTeX / source archive, and extracts it into `Ideation/references/papers/`. Record the result log as `download_res`.

**Save** → `Ideation/references/logs/download_arxiv_source_by_title.json`

## Checklist

- [ ] `load_instance` called; `date_limit` written to `context_variables` (default used if unavailable)
- [ ] `github_search` completed; result saved → `Ideation/references/logs/github_search.json`
- [ ] `dataset_description` built (from orchestrator override, built-in metaprompt, or manual construction)
- [ ] Prepare Agent queried; conversation saved → `Ideation/references/logs/prepare_agent.json`
- [ ] `reference_papers` extracted from Prepare Agent output; fallback to source papers if empty
- [ ] arXiv paper sources downloaded to `Ideation/references/papers/`; result saved → `Ideation/references/logs/download_arxiv_source_by_title.json`
- [ ] All cache files written under `Ideation/references/logs/`
