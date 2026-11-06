# build_idea_selection_query

The selection message for Step 4. Run it in a **fresh context** (a sub-agent,
or a deliberate re-read), not appended to the generation conversation, so the
judgment is not anchored on whichever idea was written last.

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `task_contract` | `idea_context.md` → `## Task contract` | Hard constraints to check against |
| `evidence_base` | `idea_context.md` → `## Evidence base` | To judge evidence and closest prior work |
| `idea_num` | Step 3 | Number of candidates |
| `ideas_text` | `raw_idea_*.txt` | All candidates, joined with the separator below |

Separator between candidates:

```text
===================
===================
```

## Template

```text
You are the Idea Agent in selection mode (see
references/idea_agent_instructions.md).

Task contract:
{task_contract}

Evidence base:
{evidence_base}

There are {idea_num} candidate research proposals:
{ideas_text}

1. Score every candidate with references/selection_gate.md (novelty,
   falsifiability, feasibility, evidence, constraint fit; 0/1/2 each), with one
   line of justification per score, and give each a novelty label.
2. Select the best eligible candidate (total >= 7, no zero, label "novel" or
   "incremental but valuable"). Break ties by feasibility, then evidence.
3. Enhance the selected proposal: fill thin sections, sharpen the claim, make
   sure the minimal experiment and abandon condition are explicit. Keep its
   core mechanism.

Output, in this order:
A. The score table and labels for all candidates, and why the winner won.
B. The full enhanced proposal, following references/idea_report_template.md,
   including the "Selection:" line.
If no candidate is eligible, output only A and say which criteria failed.
```

## Post-processing

1. Write part B (the proposal only, starting with its `#` title) to
   `selected_idea.txt`.
2. Write `idea_ledger.md` from part A plus the rejected directions in
   `idea_slate.md`.
3. Set `final_selected_idea_data.raw_idea` to the title of the candidate that
   was selected (match it against the `raw_idea_*.txt` titles), copy the full
   `selected_idea.txt` into `selected_idea_text`, add `gate_scores` and
   `novelty_label`, and write `logs/idea_generation_agent_iter_select.json`.
4. If no candidate was eligible, write only `idea_ledger.md` and report to the
   user (SKILL.md, Step 4.4). Do not create `selected_idea.txt`.
