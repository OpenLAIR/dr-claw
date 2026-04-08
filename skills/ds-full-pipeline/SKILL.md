---
name: ds-full-pipeline
description: "Full DeepScientist research pipeline: scout → baseline → idea → experiment → analysis → optimize → write → review → finalize. End-to-end autonomous research lifecycle."
license: MIT
metadata:
  author: ResearAI/DeepScientist
  version: "1.0.0"
---

# DeepScientist Full Pipeline

End-to-end autonomous research workflow for: **$ARGUMENTS**

## Overview

This skill chains all DeepScientist research stages into a single pipeline:

```
/ds-scout → /ds-baseline → /ds-idea → /ds-experiment → /ds-analysis-campaign → /ds-optimize → /ds-write → /ds-review → /ds-finalize
```

## Pipeline

### Stage 1: Scout

Frame the research problem, survey literature, identify datasets/metrics, discover existing baselines.

```
/ds-scout "$ARGUMENTS"
```

**Output:** Problem framing, literature map, baseline shortlist, evaluation contract.

**🚦 Gate 1:** Present the research landscape to the user. Wait for confirmation before proceeding.

### Stage 2: Baseline

Reproduce or import the most relevant baseline from Stage 1's shortlist.

```
/ds-baseline
```

**Output:** Working baseline with verified metrics, comparability contract.

### Stage 3: Idea

Generate concrete research hypotheses based on the literature gaps and baseline analysis.

```
/ds-idea
```

**Output:** Ranked candidate ideas with selection rationale.

**🚦 Gate 2:** Present top ideas to the user. Wait for confirmation of which idea to pursue.

### Stage 4: Experiment

Implement and run the main experiment for the selected idea.

```
/ds-experiment
```

**Output:** Experiment code, results, evidence artifacts.

### Stage 5: Analysis Campaign

Run follow-up experiments: ablations, robustness checks, error analysis.

```
/ds-analysis-campaign
```

**Output:** Ablation results, robustness data, writing-facing evidence slices.

### Stage 6: Optimize (Optional)

If results are promising but not yet strong enough, run algorithm-first iterative improvement.

```
/ds-optimize
```

Skip this stage if main experiment results already meet the success criteria.

### Stage 7: Write

Draft the paper from accepted evidence.

```
/ds-write
```

**Output:** LaTeX paper draft with figures and references.

### Stage 8: Review

Run an independent skeptical audit of the draft.

```
/ds-review
```

**Output:** Review report with severity-graded feedback.

If review identifies critical issues → fix and re-review (max 2 rounds).

### Stage 9: Finalize

Consolidate final claims, limitations, and recommendations.

```
/ds-finalize
```

**Output:** Final paper, summary state, resume packet.

## Key Rules

- **Gate checkpoints after Scout and Idea stages.** Do not proceed without user confirmation on research direction and idea selection.
- **Stages 4-9 can run autonomously** once the user confirms the idea.
- **Evidence-first writing.** Every claim in the paper must trace to an experiment artifact.
- **Fail gracefully.** If any stage fails, report clearly and suggest alternatives rather than forcing forward.
- **Git as memory.** Commit after each stage so progress is durable.

## Typical Timeline

| Stage | Duration | Autonomous? |
|-------|----------|-------------|
| 1. Scout | 20-40 min | Wait for Gate 1 |
| 2. Baseline | 15-60 min | Yes |
| 3. Idea | 15-30 min | Wait for Gate 2 |
| 4. Experiment | 30 min - hours | Yes |
| 5. Analysis | 30-60 min | Yes |
| 6. Optimize | 0-60 min | Yes (optional) |
| 7. Write | 30-60 min | Yes |
| 8. Review | 15-30 min | Yes |
| 9. Finalize | 10-20 min | Yes |
