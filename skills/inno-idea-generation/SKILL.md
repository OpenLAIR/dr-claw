---
name: inno-idea-generation
description: >
  Generates research ideas for a defined research problem. Reads the project's
  literature and context, explores directions with research ideation lenses,
  writes three full candidate proposals, and selects one through an explicit
  gate. Writes Ideation/ideas/selected_idea.txt for inno-idea-eval. Use when the
  user wants research ideas, hypotheses, a research direction, or a method idea
  for a paper or project. Runs after literature survey and before inno-idea-eval.
---

# Inno Idea Generation

Turn a research problem into one selected, testable research idea, plus a
record of the alternatives that were considered.

```
inno-deep-research / academic-researcher   (optional: literature first)
        ↓
inno-idea-generation   ← this skill: Ideation/ideas/selected_idea.txt
        ↓
inno-idea-eval         (multi-reviewer evaluation and quality gate)
        ↓
inno-code-survey → inno-experiment-dev
```

The output is a research proposal, not a product brainstorm: every idea names
the limitation it targets, a falsifiable claim, how it differs from the closest
prior work, and the smallest experiment that could refute it.

## Directory structure

```
skills/inno-idea-generation/
├── SKILL.md                              ← this file
├── prompts/
│   ├── build_idea_query.md               ← Step 3, round 1: first full proposal
│   ├── new_idea_prompt.md                ← Step 3, rounds 2..N: a different direction family
│   └── build_idea_selection_query.md     ← Step 4: compare, select, enhance
└── references/
    ├── idea_agent_instructions.md        ← Idea Agent role, hard constraints, conciseness rules
    ├── ideation_frameworks.md            ← 12 research ideation lenses + selection guide
    ├── idea_report_template.md           ← Required sections of every candidate and the selected idea
    └── selection_gate.md                 ← 0/1/2 scoring gate, novelty labels, ledger format
```

Read `references/idea_agent_instructions.md` before Step 1 and follow it for
the whole run. The prompt templates are what you (or a sub-agent) answer at each
step; their parameter tables say where each value comes from.

## Inputs

Nothing except a research problem is strictly required. Read whatever of the
following exists, in this order:

| Source | What to take from it |
|--------|----------------------|
| The user's request | Topic, task, constraints, anything they ruled in or out |
| `.pipeline/docs/research_brief.json` | `sections.ideation` (`research_goal`, `problem_framing`, `success_criteria`), `sections.survey` (`key_references`, `open_gaps`), `sections.experiment.dataset_or_data_source`, `meta.target_venue` |
| `instance.json` | `Ideation.ideas` and `Ideation.references` paths. They are absolute in Dr. Claw projects; if relative, resolve with `path.join(project_path, value)`. If the file is missing, use `<project>/Ideation/ideas` and `<project>/Ideation/references` |
| `Survey/reports/`, `Survey/references/` | Earlier literature reviews and reference lists |
| `Ideation/references/papers/` | Paper sources (`.tex`, `.md`, `.txt`, `.pdf`) |
| `Experiment/code_references/`, `Experiment/datasets/` | Codebases and data already available, which bound feasibility |

**Ask before generating** when the problem is too vague to write the task
contract in Step 1 (for example, only a field name, with no task, setting, or
data). Ask at most three short questions (task and target, data or setting,
hard constraints such as compute or deadline), then continue.

## Outputs

All files go to the `Ideation.ideas` directory (default `Ideation/ideas/`).

```
Ideation/ideas/
├── idea_context.md                       ← Step 1: task contract, evidence base, limitation card
├── idea_slate.md                         ← Step 2: 6–12 raw directions, grouped by family
├── idea_query_round_1.txt                ← Step 3: the round-1 query actually used
├── raw_idea_1.txt                        ← Step 3: full proposal, family A
├── raw_idea_2.txt                        ← Step 3: full proposal, family B
├── raw_idea_3.txt                        ← Step 3: full proposal, family C
├── selected_idea.txt                     ← Step 4: the selected and enhanced proposal (input of inno-idea-eval)
├── idea_ledger.md                        ← Step 4: selected / deferred / rejected, with scores and reasons
└── logs/
    ├── idea_generation_agent.json            ← after raw_idea_1.txt
    ├── idea_generation_agent_iter_1.json     ← after raw_idea_2.txt
    ├── idea_generation_agent_iter_2.json     ← after raw_idea_3.txt
    └── idea_generation_agent_iter_select.json ← after selected_idea.txt
```

### Write order

Always write the `.txt` / `.md` file first, then the `.json` log, copying the
text verbatim (never a summary) into the JSON fields.

### `.json` log format

```json
{
  "context_variables": {
    "ideas_path": "<instance.Ideation.ideas>",
    "references_path": "<instance.Ideation.references>",
    "task_contract": "<FULL text of the Task contract section of idea_context.md>",
    "evidence": [
      { "title": "...", "year": 2025, "source": "Ideation/references/papers/... or URL", "takeaway": "..." }
    ],
    "grounded": true,
    "idea_generation_history": [
      { "round": 1, "family": "<direction family>", "status": "raw", "content": "<FULL text of raw_idea_1.txt>" }
    ],
    "final_selected_idea_data": {
      "raw_idea": "<title of the chosen candidate>",
      "selected_idea_text": "<FULL text of selected_idea.txt>",
      "gate_scores": { "novelty": 2, "falsifiability": 2, "feasibility": 1, "evidence": 2, "constraint_fit": 2, "total": 9 },
      "novelty_label": "novel | incremental but valuable"
    }
  }
}
```

- `idea_generation_history` grows by one entry per round.
- `final_selected_idea_data` appears only in `idea_generation_agent_iter_select.json`.
  `inno-idea-eval` reads it (and `selected_idea.txt`) and updates both when it
  refines the idea.

## Step-by-step instructions

### Step 1 — Task contract and evidence base

1. **Task contract.** Write down, in a few lines each:
   - *Task*: what problem is being solved, in one sentence.
   - *Setting and data*: domain, datasets or data sources, modality.
   - *Target*: what is predicted, measured, or claimed; the main metric.
   - *Constraints*: compute, time, data access, things the user ruled out.
   - *Allowed to change*: which parts of the setup ideas may modify (method,
     objective, training, inference, evaluation protocol, data processing).
     Anything not listed is fixed. Ideas must not introduce new data sources,
     new labels, or new modalities unless the contract allows it.
2. **Evidence base.** List the papers you actually read, each with year, where
   it came from, and a one-line takeaway. Read the local sources first. Aim for
   5–10 relevant papers. If fewer than 5 are available locally, run a short
   literature search (web search, or `aris-arxiv` / `aris-semantic-scholar` if
   they are enabled) and add what you read. If you still cannot reach 5, set
   `grounded: false`, say so in `idea_context.md`, and continue.
   Never list a paper you did not open.
3. **Limitation card.** Pick the one limitation the ideas will target:
   observed symptom, condition where it appears, why it matters for the target
   metric, and the strongest evidence that it is real. Split it into
   *symptom → mechanism hypothesis → consequence*, and write one main
   hypothesis plus 2–3 competing hypotheses for the mechanism.

**Save** → `idea_context.md` with three sections: `## Task contract`,
`## Evidence base`, `## Limitation card`.

### Step 2 — Diverge: raw direction slate

Use `references/ideation_frameworks.md`. Pick at least three lenses with its
selection guide (and say which and why), then produce **6–12 raw directions**.
For each direction write one line each for:

- lens used, and lever bucket (data / model / objective / optimization /
  inference / evaluation protocol / infrastructure);
- the limitation or hypothesis it targets;
- the two-sentence pitch (problem + insight).

Merge micro-variants (same mechanism, different hyper-parameters) into one
direction. Group the survivors into **direction families** that differ in
mechanism, not in detail. Do not judge quality yet beyond the contract: drop
only directions that break the task contract.

**Save** → `idea_slate.md`.

### Step 3 — Develop three full candidates

Pick the three most promising families **that differ from each other**
(`DEFAULT_IDEA_NUM`, default 3). For each, write a full proposal following
`references/idea_report_template.md`.

- **Round 1**: fill `prompts/build_idea_query.md` with the task contract,
  evidence base, limitation card, and the chosen family. Save the filled query
  → `idea_query_round_1.txt`, the proposal → `raw_idea_1.txt`, then
  `logs/idea_generation_agent.json`.
- **Rounds 2..N**: continue in the same conversation with
  `prompts/new_idea_prompt.md`, naming the next family and listing all earlier
  candidates. Save → `raw_idea_{N}.txt`, then
  `logs/idea_generation_agent_iter_{N-1}.json`.

Every proposal must carry citation markers for the papers it builds on and
end with a reference list drawn only from the evidence base.

### Step 4 — Select, enhance, and ledger

Run the selection in a **fresh context**: use a sub-agent if your environment
has one; otherwise re-read the three `raw_idea_*.txt` files and the contract
and judge them without relying on earlier reasoning. Use
`prompts/build_idea_selection_query.md` and `references/selection_gate.md`:

1. Score every candidate on the five gate criteria (0/1/2 each) and give each
   an honest novelty label against its closest prior work.
2. Select the highest-scoring candidate whose total is at least
   `SELECTION_THRESHOLD` (default 7/10) and whose label is `novel` or
   `incremental but valuable`. Break ties by feasibility, then evidence.
3. Enhance it: fill any section of the report template that is thin, sharpen
   the falsifiable claim, and add the minimal experiment and abandon condition.
   Do not change its core mechanism.
4. If **no** candidate passes, do not promote one silently. Write the ledger,
   tell the user which criteria failed, and propose one of: another round on a
   new family, a narrower contract, or more literature.

**Save** → `selected_idea.txt` (the enhanced proposal only, starting with its
title), then `idea_ledger.md` (see `references/selection_gate.md` for the
format), then `logs/idea_generation_agent_iter_select.json`.

### Step 5 — Hand off

Tell the user, briefly: the selected idea's title and one-line claim, its gate
score and novelty label, where the files are, and the next step:

- `inno-idea-eval` to evaluate it with three reviewer personas;
- `aris-novelty-check` first, if it is enabled and the novelty label rests on
  a thin search.

Do not claim the idea is novel beyond what the evidence base supports.

### Refinement after inno-idea-eval

When `inno-idea-eval` returns refinement feedback
(`prompts/build_refinement_feedback_query.md` in that skill), revise the
selected idea in place: keep its core mechanism, address the listed
weaknesses, and save it as `refined_idea_v{N}.txt` as that skill describes. If
the original conversation is no longer available, rebuild context from
`idea_context.md`, `idea_ledger.md`, and `selected_idea.txt` first.

## Configuration

| Constant | Default | Description |
|----------|---------|-------------|
| `DEFAULT_IDEA_NUM` | 3 | Full candidate proposals written in Step 3 |
| `RAW_DIRECTIONS` | 6–12 | Raw directions in the Step 2 slate |
| `MIN_EVIDENCE_PAPERS` | 5 | Papers read before the run counts as grounded |
| `SELECTION_THRESHOLD` | 7 | Minimum gate total (out of 10) to select a candidate |

## Checklist

- [ ] Task contract written; vague problems clarified with the user first
- [ ] Evidence base lists only papers actually read; `grounded` set honestly
- [ ] Limitation card with main + 2–3 competing hypotheses
- [ ] `idea_slate.md` has 6–12 directions from at least 3 named lenses, grouped into families
- [ ] Three candidates from three different families, each following `idea_report_template.md`
- [ ] `raw_idea_{N}.txt` written before each `logs/*.json`, with full text copied
- [ ] Selection done in a fresh context and scored with the gate
- [ ] `selected_idea.txt`, `idea_ledger.md`, and `logs/idea_generation_agent_iter_select.json` written
- [ ] User told the result and the next step (`inno-idea-eval`)
