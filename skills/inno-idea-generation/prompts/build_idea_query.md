# build_idea_query

The first message of the generation conversation (Step 3, round 1).

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `task_contract` | `idea_context.md` → `## Task contract` | Task, setting/data, target, constraints, allowed changes |
| `evidence_base` | `idea_context.md` → `## Evidence base` | Papers actually read, each with a one-line takeaway and its location |
| `limitation_card` | `idea_context.md` → `## Limitation card` | Targeted limitation, mechanism split, main + competing hypotheses |
| `family` | `idea_slate.md` | Name and one-paragraph description of the direction family for this round |
| `resources` | Project folders | What exists locally: paper files under `Ideation/references/papers/`, repos under `Experiment/code_references/`, data under `Experiment/datasets/` (write "none" if empty) |
| `target_venue` | `research_brief.json` → `meta.target_venue` | Optional; write "unspecified" if empty |

## Template

```text
You are the Idea Agent (see references/idea_agent_instructions.md).

Task contract:
{task_contract}

Evidence base (papers already read):
{evidence_base}

Limitation card:
{limitation_card}

Local resources:
{resources}

Target venue: {target_venue}

Write one full research proposal for this direction family:
{family}

Follow references/idea_report_template.md exactly. Read the relevant papers
and code before writing; cite only papers from the evidence base. Keep the
core equations complete and give pseudocode only for the new components.
Respect every hard constraint in the task contract.
```

## Usage

- Save the filled template to `Ideation/ideas/idea_query_round_1.txt` before
  answering it.
- The answer is the full text of `raw_idea_1.txt`.
- Later rounds continue the same conversation with `new_idea_prompt.md`.
