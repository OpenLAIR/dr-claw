# Selection Gate and Idea Ledger

Used in Step 4 to choose among the candidates. Adapted from the selection gate
in DeepScientist's idea stage (MIT).

## 1. Score each candidate (0/1/2 per criterion)

| Criterion | 0 | 1 | 2 |
|-----------|---|---|---|
| **Novelty** | Obvious tweak of the closest prior work | Moderate variant | Clear, non-trivial change of mechanism |
| **Falsifiability** | Vague claim | Partly testable | Explicit metric, direction, and boundary condition |
| **Feasibility** | No clear implementation path | Large refactor or compute risk | Minimal touchpoints and a compute estimate within the contract |
| **Evidence** | No credible citation | Weak or indirect support | Directly relevant papers plus baseline evidence |
| **Constraint fit** | Violates the task contract | Uncertain fit | Fully within data, protocol, and compute limits |

Total out of 10. A candidate is eligible only if the total is at least
`SELECTION_THRESHOLD` (default 7) **and** no criterion is 0.

## 2. Novelty label (one per candidate)

- `novel` — the closest prior work does not already make the same
  mechanism-plus-claim combination.
- `incremental but valuable` — overlap exists, but the new setting, evidence,
  or resolved failure mode still matters.
- `not sufficiently differentiated` — the closest prior work already covers it.
  Not eligible.

If the literature checked is too thin to judge, add "(unverified)" to the label
and recommend `aris-novelty-check` or a wider search before `inno-idea-eval`.

## 3. Promotion checks

Do not promote a candidate while any of these is unclear:

- what exactly is claimed, and on which metric;
- how it differs from the closest prior work;
- which minimal experiment could refute it;
- which code or pipeline parts it touches;
- which papers in the evidence base support the motivation and mechanism.

## 4. `idea_ledger.md` format

```markdown
# Idea Ledger

## Selected
- **<title>** (raw_idea_<N>.txt) — gate <total>/10, <label>
  - Why it won: <one or two sentences, in terms of the gate>

## Deferred
- **<title>** — gate <total>/10, <label>
  - Still plausible because: <...>; not first because: <...>

## Rejected
- **<title or slate direction>** — <one-line reason>, e.g.:
  redundant with closer prior work · too confounded to test cleanly ·
  weak value even if positive · too broad for current compute or code ·
  breaks the task contract

## Scores
| Candidate | Novelty | Falsifiability | Feasibility | Evidence | Constraint fit | Total | Label |
|-----------|---------|----------------|-------------|----------|----------------|-------|-------|
```

Keep rejected directions from the slate in the ledger too (one line each):
they are useful if the evaluation later asks for a different direction.
