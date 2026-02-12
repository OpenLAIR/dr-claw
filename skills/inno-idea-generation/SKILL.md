---
name: inno-idea-generation
description: >
  Generates multiple innovative research ideas from prepared resources,
  then selects the best one. Use after inno-prepare-resources in the
  Idea branch of the Research pipeline.
---

# Inno Idea Generation

## Directory structure

```
skills/inno-idea-generation/
├── SKILL.md                                    ← this file
├── prompts/
│   ├── build_idea_query.md                     ← Step 1 prompt template & parameter docs
│   ├── new_idea_prompt.md                      ← Step 2 diversity-loop prompt template
│   └── build_idea_selection_query.md           ← Step 3 selection prompt template & post-processing
└── references/
    └── idea_agent_instructions.md              ← Full Idea Agent system prompt & tool list
```

> **How to use the resource files**: Each prompt template in `prompts/` documents
> the exact parameters, the full text template, and usage notes (when it is a new
> conversation vs. appended message, how to format multi-idea lists, etc.).
> The `references/` directory contains the Idea Agent's complete system instructions
> including its hard constraints, conciseness rules, dual-mode workflow, and
> selection rubric. Consult these files for the authoritative details; the steps
> below provide a summary.

## Inputs

| Parameter          | Required | Description |
|--------------------|----------|-------------|
| `data_module`      | Yes      | The imported metaprompt module (provides `TASK` field describing the ML task) |
| `references`       | Yes      | Pre-formatted string listing all source papers |
| `prepare_res`      | Yes      | Full text response from the Prepare Agent (selected repositories and reasoning) |
| `download_res`     | Yes      | Result log from downloading arXiv paper sources |
| `context_variables`| Yes      | Shared context dictionary |

## Outputs

| Output                | Description |
|-----------------------|-------------|
| `raw_ideas`           | List of all generated raw idea texts |
| `selected_idea`       | The best idea chosen by the selection step |
| `context_variables`   | Updated with `idea_generation_history` (list) and `final_selected_idea_data` (dict) |

## Cache file outputs

Each step produces **two kinds** of files:

1. **`.txt` files** (primary) — the full markdown content of each idea, written directly to `Ideation/ideas/`
2. **`.json` files** (derived) — structured metadata under `Ideation/ideas/logs/`, whose `content` fields **must be copied verbatim** from the corresponding `.txt` files (never summarized)

### Full directory layout

```
Ideation/ideas/
├── idea_query_round_1.txt                    ← Step 1: the query prompt sent to the agent
├── raw_idea_1.txt                            ← Step 1: full markdown of first idea
├── raw_idea_2.txt                            ← Step 2: full markdown of second idea
├── raw_idea_3.txt                            ← Step 2: full markdown of third idea
├── selected_idea.txt                         ← Step 3: full markdown of final selected idea
└── logs/
    ├── idea_generation_agent.json            ← Step 1: metadata + full text from raw_idea_1.txt
    ├── idea_generation_agent_iter_1.json     ← Step 2: metadata + full text from raw_idea_2.txt
    ├── idea_generation_agent_iter_2.json     ← Step 2: metadata + full text from raw_idea_3.txt
    └── idea_generation_agent_iter_select.json ← Step 3: metadata + full text from selected_idea.txt
```

### Write order (critical)

For every step, **always write the `.txt` file first**, then build the `.json` file by copying the `.txt` content into the appropriate field:

1. Write `raw_idea_{N}.txt` with the agent's full response
2. Read it back (or keep in memory) and embed the full text into `idea_generation_history[N-1].content`
3. Write the corresponding `agents/*.json`

For the selection step:
1. Write `selected_idea.txt` with the agent's full selection response
2. Copy that full text into `final_selected_idea_data.selected_idea_text`
3. Write `agents/idea_generation_agent_iter_select.json`

### `.txt` file naming

| Step | File name | Content |
|------|-----------|---------|
| Query prompt | `idea_query_round_1.txt` | The `build_idea_query` prompt sent in Step 1 |
| Round 1 idea | `raw_idea_1.txt` | Full markdown of the first idea |
| Round N idea | `raw_idea_{N}.txt` | Full markdown of the Nth idea |
| Final selection | `selected_idea.txt` | Full markdown of the selected & refined idea |

### `.json` file naming

| Step | File name | `iter_times` value |
|------|-----------|--------------------|
| First idea | `idea_generation_agent.json` | (none / default) |
| Round N+1 idea | `idea_generation_agent_iter_{N}.json` | `N` (1-indexed: iter_1 = round 2, iter_2 = round 3, ...) |
| Selection | `idea_generation_agent_iter_select.json` | `"select"` |

### `.json` file format

Each file contains `context_variables` only (no messages). The `content` fields hold the **full text** copied from the corresponding `.txt` files:

```json
{
  "context_variables": {
    "ideas_path": "<ideas_path>",
    "references_path": "<references_path>",
    "date_limit": "YYYY-MM-DD",
    "prepare_result": { ... },
    "idea_generation_history": [
      { "round": 1, "status": "raw", "content": "<FULL text from raw_idea_1.txt>" },
      { "round": 2, "status": "raw", "content": "<FULL text from raw_idea_2.txt>" }
    ],
    "notes": [],
    "final_selected_idea_data": {
      "raw_idea": "<title of best candidate>",
      "selected_idea_text": "<FULL text from selected_idea.txt>"
    }
  }
}
```

- `idea_generation_history` grows with each file — the first file has 1 entry, iter_1 has 2 entries, etc.
- `final_selected_idea_data` is only present in `idea_generation_agent_iter_select.json`.
- **IMPORTANT**: `content` and `selected_idea_text` must contain the **complete** markdown from the `.txt` file — never a summary or abbreviation.

## Step-by-step Instructions

### Step 1 — Generate the first idea

> Full template & parameter docs: [`prompts/build_idea_query.md`](prompts/build_idea_query.md)
> Agent system prompt: [`references/idea_agent_instructions.md`](references/idea_agent_instructions.md)

Build the idea query from four components:

```
I have a task related to machine learning:
{data_module.TASK}
And a list of papers for your reference:
{references}

I have carefully gone through these papers' github repositories and found
download some of them in my local machine, with the following information:
{prepare_res}
And I have also downloaded the corresponding paper (LaTeX sources, markdown,
txt), with the following information:
{download_res}

Your task is to thoroughly review research papers and generate innovative
ideas for the given task.

Note that the math formula should be as complete as possible.
```

Send this to the **Idea Agent**. Record the response as the first `raw_idea` and append to `raw_ideas`.

**Save (txt first, then json)**:
1. Write the query prompt → `Ideation/ideas/idea_query_round_1.txt`
2. Write the agent's full response → `Ideation/ideas/raw_idea_1.txt`
3. Initialize `context_variables["idea_generation_history"]` and append:
   ```json
   { "round": 1, "status": "raw", "content": "<FULL text from raw_idea_1.txt>" }
   ```
4. Write → `Ideation/ideas/logs/idea_generation_agent.json`

### Step 2 — Generate additional ideas (diversity loop)

> Full template & constraint rationale: [`prompts/new_idea_prompt.md`](prompts/new_idea_prompt.md)

Repeat `DEFAULT_IDEA_NUM - 1` more times (default: 2 more rounds, for a total of 3 ideas).

For each round, build a follow-up prompt that includes all previously generated ideas and strict constraints:

```
Here are the ideas from previous rounds:

--- Candidate Idea #1 ---
<raw_idea_1>

--- Candidate Idea #2 ---
<raw_idea_2>
...

Please survey again and give me another idea that is different from all
ideas above. You MUST obey these hard constraints:
1) Do NOT introduce any new input modalities, new data sources, or new labels/targets.
2) Do NOT change the task, the disease/condition, the primary modality, or the prediction target.
```

Append the new idea prompt to the existing conversation and call the **Idea Agent** again. Record each new idea in `raw_ideas` and `idea_generation_history`.

**Save (txt first, then json)** after each round:
1. Write the agent's full response → `Ideation/ideas/raw_idea_{round}.txt` (e.g. `raw_idea_2.txt`, `raw_idea_3.txt`)
2. Append to `idea_generation_history`:
   ```json
   { "round": N, "status": "raw", "content": "<FULL text from raw_idea_{N}.txt>" }
   ```
3. Write → `Ideation/ideas/logs/idea_generation_agent_iter_{N-1}.json` (iter_1 for round 2, iter_2 for round 3, etc.)

### Step 3 — Select the best idea

> Full template, separator format & post-processing logic: [`prompts/build_idea_selection_query.md`](prompts/build_idea_selection_query.md)

Build the selection query:

```
You have generated {N} innovative ideas for the given task:
<idea_1>
===================
===================
<idea_2>
===================
===================
...

Your task is to analyze multiple existing ideas, select the most novel one,
enhance the idea if any key information is missing, finally give me the most
novel idea with refined math formula and code implementation.
Directly output the selected refined idea report.
```

Send this as a **new** conversation (not appended to the idea-generation thread) to the **Idea Agent**.

The agent's response is the `selected_idea`. To verify which raw idea was chosen, compare the response text against each entry in `raw_ideas` — if a raw idea's text appears as a substring (or the first 100 chars match), use the original raw idea as `best_candidate`. Otherwise use the agent's response as-is.

**Save (txt first, then json)**:
1. Write the agent's full selection response → `Ideation/ideas/selected_idea.txt`
2. Copy that full text into the context:
   ```json
   context_variables["final_selected_idea_data"] = {
     "raw_idea": "<title of best_candidate>",
     "selected_idea_text": "<FULL text from selected_idea.txt>"
   }
   ```
3. Write → `Ideation/ideas/logs/idea_generation_agent_iter_select.json`

## Configuration

| Constant             | Default | Description |
|----------------------|---------|-------------|
| `DEFAULT_IDEA_NUM`   | 3       | Total number of raw ideas to generate before selection |

## Checklist

- [ ] Query prompt saved → `idea_query_round_1.txt`
- [ ] First raw idea saved → `raw_idea_1.txt`, then full text copied into `logs/idea_generation_agent.json`
- [ ] Additional raw ideas saved → `raw_idea_{N}.txt`, then full text copied into `logs/idea_generation_agent_iter_{N-1}.json`
- [ ] `idea_generation_history` in `context_variables` contains **full text** (not summaries) for all rounds
- [ ] Best idea selected and saved → `selected_idea.txt`, then full text copied into `logs/idea_generation_agent_iter_select.json`
- [ ] `final_selected_idea_data.selected_idea_text` contains **full text** from `selected_idea.txt`
- [ ] All `.txt` files written to `Ideation/ideas/`, all `.json` files written to `Ideation/ideas/logs/`
