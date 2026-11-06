# Idea Report Template

Every `raw_idea_{N}.txt` and the final `selected_idea.txt` use this structure.
Keep it tight: a full proposal is usually 800–1800 words. Section names are
fixed so that `inno-idea-eval`, `inno-code-survey`, and `inno-experiment-dev`
can find what they need.

```markdown
# <Idea title>

**Claim.** <One falsifiable sentence: what improves, on which metric, in which
direction, under which condition.>

**Pitch.** <Two sentences. 1: "<Field> currently struggles with <problem>,
which matters because <consequence>." 2: "We <approach> by <key mechanism>,
which works because <reason>.">

**Direction family:** <family name from idea_slate.md> · **Lever:** <data /
model / objective / optimization / inference / evaluation protocol /
infrastructure> · **Lens(es):** <from ideation_frameworks.md>

## 1. Challenges
The limitation targeted (from the limitation card): symptom, where it appears,
why it matters. Evidence that it is real, with citations.

## 2. Existing methods and closest prior work
How current methods handle it and where they fall short. Name the **closest
prior work** explicitly and state the difference in one or two sentences.

## 3. Motivation
Situation → complication → question → answer (SCQA), in a short paragraph.

## 4. Hypotheses
- Main hypothesis (the mechanism this idea bets on).
- 2–3 competing hypotheses that would also explain the limitation, and how the
  experiments will tell them apart.

## 5. Proposed method
3–4 core modules at most. For each: purpose, key equation(s), and how it
connects to the others. Give a pseudocode skeleton for the new forward logic
or algorithm only. Note which parts reuse existing code
(`Experiment/code_references/...`) if any.

## 6. Technical details
Architecture or pipeline, data flow, training/inference procedure, important
hyper-parameters, compute estimate (rough GPU-hours or CPU time), and what is
needed that is not already available.

## 7. Validation plan
- **Minimal experiment:** the smallest run that could refute the claim.
- Datasets/splits, baselines (including the closest prior work where
  possible), metrics, and the ablations that isolate each module.

## 8. Expected outcomes and abandon condition
What result would support the claim, what result would refute it, and the
explicit condition under which the idea should be dropped.

## 9. Risks
Top 2–3 risks (technical, data, compute, confounds) and a mitigation for each.

## References
Standard format (authors, title, venue/arXiv id, year), only papers from the
evidence base, matching the citation markers used above.
```

For `selected_idea.txt`, add one line after the pitch:

```markdown
**Selection:** gate <total>/10 (novelty <n>, falsifiability <n>, feasibility
<n>, evidence <n>, constraint fit <n>) · <novelty label>
```
