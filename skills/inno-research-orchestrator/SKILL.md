---
name: inno-research-orchestrator
description: Receives free-form user input about a research task, judges its maturity (plan vs idea), and constructs the standardized inputs needed by inno-prepare-resources. Use when the user wants to start a research pipeline — regardless of how complete or structured their input is.
---

# Inno Research Orchestrator

The user's entry point to the InnoFlow Research pipeline. Real users rarely provide a ready-made instance JSON with all fields filled. This skill bridges the gap between **what the user actually gives** and **what inno-prepare-resources expects**.

## When to use

- User says "start research", "run experiment", "help me implement a paper", etc.
- User provides any combination of: topic text, paper link, background, plan, JSON file, or reference papers.

## Constraints

- **Sandbox rule**: The agent must **only** read, write, and create files inside the current project directory (`<project_path>`). Never access, reference, or modify files outside this directory. All generated paths (`instance_path`, `references_path`, `ideas_path`, `code_references_path`, `datasets_path`, `core_code_path`, `analysis_path`, symlinks, dataset copies, etc.) must be children of `<project_path>`. If the user mentions an external path (e.g. a dataset), copy or symlink it **into** the project directory rather than operating on it in-place.

---

## Step 1 — Collect and understand user input

Users may provide input in **any** of the forms below. Gather as much as possible before proceeding.

| User provides | What you get |
|---------------|-------------|
| A topic sentence, e.g. "I want to improve biomedical QA" | `task_instructions` (background) |
| Reference paper titles or URLs | `source_papers` entries (agent fetches metadata from URLs) |
| A background paragraph / problem description | `task_instructions` (= `task2`) |
| A full implementation plan (method + data + training + eval) | `ideas` (= `task1`) |
| An instance JSON file path | All fields directly |
| A dataset name, URL, or local path | Dataset information for `dataset_description` |

**If critical information is missing, ask the user.** Minimum required:
- Some form of task description (topic, background, or problem statement)
- The user's project working directory (or use the current VibeLab project path)

---

## Step 2 — Judge maturity level

Based on what the user provided, classify into **plan-level** or **idea-level**:

| Level | Signal | Outcome |
|-------|--------|---------|
| **Plan-level** | User provided a detailed implementation plan with method, data processing, model architecture, training procedure, evaluation metrics. Or an instance JSON with a substantial `task1`. | Skip idea generation. Set `ideas = plan text`. Set `task_level = "task1"`. |
| **Idea-level** | User provided only a topic, background, problem description, or paper without a concrete plan. Or an instance JSON with `task2` only / no `task1`. | Ideas will be generated. Set `task_level = "task2"`. |

**Heuristic**: If the user's text mentions specific model components, loss functions, training steps, and evaluation metrics → plan. If it only describes the problem domain or desired outcome → idea.

---

## Step 3 — Construct standardized inputs for inno-prepare-resources

`inno-prepare-resources` expects:

```
instance_path       : str   — path to a JSON file with source_papers, task1/task2, etc.
task_level          : str   — "task1" (plan) or "task2" (idea)
category            : str   — research domain tag, agent-inferred (may match a built-in metaprompt or be "custom")
references_path     : str   — <project_path>/Ideation/references/
ideas_path          : str   — <project_path>/Ideation/ideas/
code_references_path: str   — <project_path>/Experiment/code_references/
datasets_path       : str   — <project_path>/Experiment/datasets/
core_code_path      : str   — <project_path>/Experiment/core_code/
analysis_path       : str   — <project_path>/Experiment/analysis/
references          : str   — formatted string from source_papers (built by the pipeline)
ideas               : str   — (optional, plan-mode only) the user's full plan text
dataset_description : str   — (optional) pre-built by orchestrator when category is custom or data was user-provided
```

### 3a — Build or locate the instance JSON

**Case A: User provided an instance JSON file path**
→ Use directly. Read the file, verify it has `source_papers` and at least one of `task1` / `task2`.

**Case B: User provided some information (topic, papers, plan, etc.) but no JSON file**
→ The agent must **construct** an instance JSON from whatever the user gave. Do **not** ask the user for fields like `rank`, `type`, `justification`, `usage`, `abstract`, or `url` — the agent should fill these in automatically or leave them with sensible defaults.

Construction rules:

1. **`source_papers`**: The user may mention related work as paper titles or URLs.
   - If the user gave paper titles → add each as `{"reference": "<title>"}`.
   - If the user gave paper URLs (arXiv, Semantic Scholar, etc.) → the agent fetches the paper title from the URL and adds it as a `source_papers` entry. These URLs are references to **related work**, not the user's own paper.
   - Fields like `rank`, `type`, `justification`, `usage` are **auto-generated by the agent** based on the paper's role in the research context, or left empty — they are only informational for downstream prompts.
   - If the user gave no papers at all → `source_papers = []`. The Prepare Agent and GitHub search will find relevant code based on the task description.

2. **`task2`** (idea-level): The user's background text, problem description, or topic sentence. If the user only gave a short topic, expand it by asking a brief clarifying question or use it as-is.

3. **`task1`** (plan-level): The user's detailed plan. Only present when maturity = plan.

4. **`instance_id`**: Auto-generate, e.g. `user_<topic_slug>_001`.

Minimal valid instance JSON (the bare minimum the pipeline needs):
```json
{
  "source_papers": [],
  "task2": "<user's task description>",
  "instance_id": "user_research_001"
}
```

Save this JSON to **`<project_path>/instance.json`** (project root) and use that as `instance_path`.

### 3b — Determine category and prepare dataset

#### Category (agent-inferred)

The `category` is an internal tag the **agent determines automatically** from the user's task description. The user does not need to know or provide it.

If the category matches a built-in one, the pipeline can use a pre-written `metaprompt.py` that provides `TASK`, `DATASET`, `BASELINE`, `COMPARISON`, and `EVALUATION` prompts. If not, the agent builds these from conversation.

Built-in categories (for reference):
```
cls, ecgcls, ecgprognosis, ehr_recom, ehr_riskpre, mmfusion,
mm_report_gen, nlp_qa, nlp_risk_pre, nlp_sum, prognosis,
registration, restoration, seg, videoassess, videocvs,
videoflow, videorestoration, videoseg
```

**How the agent infers category:**
1. Instance JSON path contains a category name (e.g. `.../nlp_qa/nlp_qa_1.json`) → extract.
2. Match keywords from user's description:
   - "question answering", "QA", "BioASQ" → `nlp_qa`
   - "segmentation" → `seg`
   - "classification" → `cls`
   - "summarization" → `nlp_sum`
   - "ECG" → `ecgcls` / `ecgprognosis`
   - "EHR", "risk prediction" → `ehr_riskpre`
   - "recommendation" → `ehr_recom`
   - "report generation" → `mm_report_gen`
   - "registration" → `registration`
   - "restoration" → `restoration`
   - "video segmentation" → `videoseg`
3. No match → set `category = "custom"` (see dataset section below).

#### Dataset preparation

Users will **not** have the `dataset_candidate/{category}/` directory pre-populated. The agent must help acquire and set up the dataset. Handle each scenario:

**Scenario 1 — Built-in category with pre-existing dataset**
The `metaprompt.py` already describes where dataset files should be (e.g. `Experiment/datasets/bioasq/`). Check if these files already exist in the workspace. If yes, proceed. If not, the agent should either:
- Download them (if a public URL is known from the metaprompt), or
- Ask the user where the data is (see Scenario 3/4).

**Scenario 2 — Built-in category, but user has dataset elsewhere**
User says "my BioASQ data is at `/home/dingjie/data/bioasq/`".
→ Create a symlink or copy the data into `Experiment/datasets/{category}/`, or instruct downstream skills to read from the user's path directly. Update the `dataset_description` accordingly.

**Scenario 3 — User provides a dataset URL**
User says "download the data from https://example.com/dataset.zip".
→ The agent downloads it to `Experiment/datasets/`, extracts if needed, and explores the contents to understand the data format. Then builds a `dataset_description` manually.

**Scenario 4 — User points to a local directory**
User says "my dataset is at `/home/dingjie/workspace/my_data/`".
→ The agent reads/explores that directory to understand the file structure, data format, and schema. Build `dataset_description` from what is found. Symlink or reference the path in the workspace.

**Scenario 5 — User describes data but doesn't provide it**
User says "I'm working with chest X-ray images and radiology reports".
→ Ask the user to either provide the data path/URL or indicate if the agent should search for a public dataset. If no data is available yet, the pipeline can still proceed through idea-generation and planning stages — actual data is only needed at the ml-dev step.

**Scenario 6 — Custom / unknown category**
Set `category = "custom"`. There is no `metaprompt.py` for this category. The agent must build the equivalent information through conversation:
- **TASK**: What is the task? (e.g. "Predict hospital readmission from EHR data")
- **DATASET**: What format is the data in? (CSV, JSON, images, etc.) Where is it located?
- **BASELINE**: What are known baseline methods and their performance?
- **EVALUATION**: What metrics to use? (accuracy, F1, AUC, BLEU, etc.)

Compose these into a `dataset_description` string and pass it to `inno-prepare-resources` in place of the one that would normally come from `metaprompt.py`.

### 3c — Set up workspace paths, directories, and write required output files

#### Path layout

The pipeline outputs are organized into three semantic top-level folders:

```
project_path         = <current VibeLab project path>
references_path      = <project_path>/Ideation/references/
ideas_path           = <project_path>/Ideation/ideas/
code_references_path = <project_path>/Experiment/code_references/
datasets_path        = <project_path>/Experiment/datasets/
core_code_path       = <project_path>/Experiment/core_code/
analysis_path        = <project_path>/Experiment/analysis/
```

If the user has an existing workspace directory, use it. Otherwise, create the full directory tree:

```
<project_path>/
├── instance.json                          ← project root (Research Lab UI reads this)
├── pipeline_config.json                   ← project root (Research Lab UI reads this)
├── Ideation/
│   ├── references/
│   │   ├── papers/                        ← arXiv downloaded papers
│   │   └── logs/                          ← prepare_agent.json, github_search.json,
│   │                                         load_instance.json, download_arxiv*.json
│   └── ideas/
│       └── logs/                          ← idea_generation_agent*.json
├── Experiment/
│   ├── code_references/
│   │   └── logs/                          ← repo_acquisition_agent.json, code_survey_agent.json
│   ├── datasets/
│   ├── core_code/
│   │   └── logs/                          ← coding_plan_agent.json, machine_learning_agent*.json,
│   │                                         judge_agent*.json
│   └── analysis/
│       └── logs/                          ← experiment_analysis_agent*.json
└── Publication/                           ← placeholder for future paper generation
    ├── paper/
    └── materials/
```

Create all directories and `logs/` subdirectories immediately.

#### Required output files at project root

The **Research Lab** UI reads the following files from the project root. The orchestrator **must** write them so the dashboard can display research status.

| File | Location | Description |
|------|----------|-------------|
| `instance.json` | `<project_path>/instance.json` | The evaluation instance (source_papers, task1/task2, instance_id, url, etc.) |
| `pipeline_config.json` | `<project_path>/pipeline_config.json` | Pipeline metadata for the current run |

**`pipeline_config.json`** must contain at least:

```json
{
  "instance_path": "<project_path>/instance.json",
  "task_level": "task1 or task2",
  "category": "<inferred category>",
  "references_path": "<project_path>/Ideation/references/",
  "ideas_path": "<project_path>/Ideation/ideas/",
  "code_references_path": "<project_path>/Experiment/code_references/",
  "datasets_path": "<project_path>/Experiment/datasets/",
  "core_code_path": "<project_path>/Experiment/core_code/",
  "analysis_path": "<project_path>/Experiment/analysis/",
  "references": "<empty string, filled later by prepare step>",
  "ideas": "<plan text if plan-mode, or empty string>",
  "dataset_description": "<pre-built description if custom, or empty string>"
}
```

#### Cache seed file: `load_instance.json`

After constructing or locating the instance JSON, write the load result so downstream skills can reference it. This file follows the standard tool cache format:

```json
{
  "name": "load_instance",
  "args": {
    "instance_path": "<project_path>/instance.json",
    "task_level": "task1 or task2"
  },
  "result": {
    "source_papers": [ ... ],
    "task_instructions": "<task description text>",
    "date_limit": "YYYY-MM-DD"
  }
}
```

- `result.source_papers` — the full `source_papers` array from the instance
- `result.task_instructions` — the text from the field indicated by `task_level` (`task1` or `task2`)
- `result.date_limit` — publication date fetched from arXiv, or default `"2024-01-01"` if unavailable

**Save** → `Ideation/references/logs/load_instance.json`

All files (`instance.json`, `pipeline_config.json`, `Ideation/references/logs/load_instance.json`) must be written **before** the orchestrator presents the summary to the user.

---

## Step 4 — Output summary and wait for user confirmation

**Do NOT automatically invoke inno-prepare-resources or any downstream skill.** Instead, present a summary of the prepared inputs to the user and wait for explicit confirmation before proceeding.

The summary should include:

1. **Maturity judgment**: Plan-level or Idea-level (and why)
2. **Instance JSON**: file path and key contents (`source_papers` count, `task_level`, `instance_id`)
3. **Category**: the inferred category and whether a built-in metaprompt is available
4. **Dataset**: status (found / needs download / user-provided / custom description built)
5. **Workspace paths**: `Ideation/`, `Experiment/`, `Publication/`
6. **Next step**: which skill to run next — **inno-prepare-resources** — and the arguments it will receive

Also remind the user of the full pipeline that will follow:

**Plan-level pipeline:**
1. inno-prepare-resources (with `ideas`)
2. inno-code-survey
3. inno-experiment-dev (plan + implement + judge + submit)
4. inno-experiment-analysis (analyse + refine)
5. inno-paper-writing (draft publication-ready paper) — optional, user-triggered

**Idea-level pipeline:**
1. inno-prepare-resources
2. inno-idea-generation
3. inno-code-survey (Phase A: repo acquisition + Phase B: code survey)
4. inno-experiment-dev (plan + implement + judge + submit)
5. inno-experiment-analysis (analyse + refine)
6. inno-paper-writing (draft publication-ready paper) — optional, user-triggered

The user may then say "proceed", "run prepare", or manually invoke `inno-prepare-resources`.

---

## Examples

### Example 1 — User gives only a topic

> User: "I want to do research on biomedical question answering using neural networks."

**Orchestrator actions:**
1. Maturity: only a topic → **idea-level**, `task_level = "task2"`
2. No papers provided → `source_papers = []`
3. Agent infers category → keyword "question answering" → `nlp_qa`
4. Dataset: check if `nlp_qa` metaprompt data (BioASQ) exists in workspace; if not, ask user "Do you have BioASQ data locally, or should I help you download it?"
5. Construct minimal instance JSON: `{"source_papers": [], "task2": "...", "instance_id": "user_bioasq_qa_001"}`
6. Set up workspace paths, present summary to user, wait for confirmation before next step

### Example 2 — User gives related-work paper URLs + background

> User: "I want to improve factoid QA for the BioASQ challenge. Here are some related papers: http://arxiv.org/abs/1706.08568v1, http://arxiv.org/abs/1611.01603"

**Orchestrator actions:**
1. Agent fetches paper titles from arXiv URLs → adds to `source_papers` as related work
2. Maturity: background only → **idea-level**
3. Construct instance JSON: `{"source_papers": [{"reference": "Neural Question Answering at BioASQ 5B"}, {"reference": "..."}], "task2": "I want to improve factoid QA...", "instance_id": "user_bioasq_qa_002"}`
4. Agent infers category → "BioASQ", "factoid QA" → `nlp_qa`
5. Dataset: agent checks workspace for BioASQ data
6. Present summary to user, wait for confirmation before next step

### Example 3 — User gives a full plan

> User: "Use a BiLSTM+BiDAF encoder with Sinkhorn-normalized 2D span scoring. Train with Adam (lr=2e-3) on BioASQ factoid QA, evaluate with SAcc/LAcc/MRR. Pre-train on SQuAD then fine-tune on BioASQ. [detailed method...]"

**Orchestrator actions:**
1. Maturity: has model architecture, optimizer, metrics → **plan-level**, `task_level = "task1"`
2. `ideas` = user's full plan text
3. Agent infers category → "BioASQ" → `nlp_qa`
4. Construct instance JSON with `task1` = plan text
5. Present summary to user, wait for confirmation before next step (plan branch)

### Example 4 — User gives an instance JSON path

> User: "Run the pipeline on `/home/dingjie/.../nlp_qa/nlp_qa_1.json` with task2."

**Orchestrator actions:**
1. `instance_path` = provided path → read file directly
2. `task_level = "task2"` → **idea-level**
3. Agent infers category from path → `nlp_qa`
4. Present summary to user, wait for confirmation before next step

### Example 5 — User has their own dataset and topic

> User: "I want to predict hospital readmission from EHR data. My dataset is at /home/dingjie/data/mimic_readmission/ in CSV format."

**Orchestrator actions:**
1. Maturity: only task description → **idea-level**
2. Agent infers category: "EHR", "readmission", "risk prediction" → try `ehr_riskpre`. If doesn't match well → `category = "custom"`
3. Dataset: agent explores `/home/dingjie/data/mimic_readmission/` to understand file structure and data schema
4. Agent builds `dataset_description` from the exploration (CSV columns, sample counts, target variable, etc.)
5. Construct instance JSON with `task2`, `source_papers = []`
6. Present summary to user, wait for confirmation before next step (idea branch)

### Example 6 — User gives a dataset URL

> User: "I'm working on medical image segmentation. You can get the dataset from https://example.com/cardiac_seg.zip"

**Orchestrator actions:**
1. Maturity → **idea-level**
2. Agent infers category → "segmentation" → `seg`
3. Dataset: agent downloads the zip to workspace, extracts, explores contents
4. Agent builds `dataset_description` from found files (image formats, mask formats, train/test split, etc.)
5. Construct instance JSON, present summary to user, wait for confirmation before next step

---

## Checklist

- [ ] User input collected (topic / paper / plan / JSON / background).
- [ ] Maturity judgment completed → `task_level` set to `"task1"` (plan) or `"task2"` (idea).
- [ ] Instance JSON located or constructed with at minimum `source_papers` and `task1`/`task2`.
- [ ] `category` inferred by agent (from path, task keywords, or set to "custom").
- [ ] Workspace paths set up — `Ideation/`, `Experiment/`, `Publication/` — all within `<project_path>`.
- [ ] Directories created: all folders and `logs/` subdirectories as per path layout.
- [ ] `instance.json` written to `<project_path>/instance.json`.
- [ ] `pipeline_config.json` written to `<project_path>/pipeline_config.json` with semantic path fields.
- [ ] `load_instance.json` written to `Ideation/references/logs/load_instance.json`.
- [ ] All generated/referenced paths are inside the project directory (sandbox rule).
- [ ] All inputs aligned with `inno-prepare-resources` expected format.
- [ ] Summary presented to user; **waiting for user confirmation** before invoking any downstream skill.

## References

- Instance JSON schema: `{"source_papers": [...], "task1": "...", "task2": "...", "instance_id": "...", "url": "..."}`
- Category → dataset mapping: built-in categories ship with a `metaprompt.py` providing `TASK`, `DATASET`, `BASELINE`, `COMPARISON`, `EVALUATION`
- Downstream skills: `inno-prepare-resources`, `inno-idea-generation`, `inno-code-survey` (Phase A: repo acquisition + Phase B: code survey), `inno-experiment-dev` (plan + implement + judge + submit), `inno-experiment-analysis` (analyse + refine), `inno-paper-writing` (draft publication-ready paper)
