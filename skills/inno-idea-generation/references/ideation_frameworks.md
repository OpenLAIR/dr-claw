# Research Ideation Lenses

Twelve lenses for Step 2. Each one is a different way to move from a
limitation to a direction. Condensed from the `brainstorming-research-ideas`
and `creative-thinking-for-research` skills (Orchestra Research, MIT) and the
idea playbook of DeepScientist (MIT).

Use at least three lenses per run. Generate first, judge later: in Step 2,
drop only directions that break the task contract.

## Which lenses to start with

| Situation | Start with |
|-----------|------------|
| The limitation is clear, the fix is not | L6 Boundary probing → L5 Constraint manipulation → L9 Compose/decompose |
| The area is clear, the limitation is not | L3 Tension hunting → L4 What changed → L6 Boundary probing |
| The current method is complex and fragile | L8 Simplicity test → L9 Compose/decompose |
| All ideas come from the same few papers | L7 Cross-domain analogy → L2 Reformulation |
| Every idea is "+1% on benchmark X" | L5 Constraint manipulation → L1 Abstraction ladder → L10 Negation |
| Stuck choosing between two approaches | L11 Dialectical synthesis |
| A new technique wants an application | L12 Problem-first check → L4 What changed |

## L1. Abstraction ladder

State the focus in one sentence, then move **up** (what general principle or
class of problems is this?), **down** (the most constrained or extreme
instance), and **sideways** (the same pattern in an adjacent area). Ask of
each: is this a contribution on its own?

## L2. Problem reformulation

List the hidden assumptions in the problem statement and change one:
the objective ("make X faster" → "avoid computing X"), the formalism (graph →
linear algebra), the granularity (token → span), the agent ("how should the
model learn" → "how should the data teach"), the timescale (per-instance →
amortized), or the direction (forward → inverse problem).

## L3. Tension hunting

List the 3–5 things everyone in the area wants (accuracy, efficiency,
robustness, interpretability, privacy, generality …) and the pairs treated as
trade-offs. For each pair: is the trade-off fundamental or an artifact of
current methods? If an artifact, resolving it is the contribution; if
fundamental, mapping the frontier is.

## L4. What changed?

Take an approach that was abandoned or a negative result from 3–10 years ago.
List the assumptions behind its rejection (compute, data scale, tooling,
model capability, evaluation practice). If one no longer holds, the idea is to
revisit it: "X was impractical because Y, but Z has changed." Also map recent
enablers (last 6–18 months) and ask what they make newly possible.

## L5. Constraint manipulation

List 5–10 constraints of the current approach and classify each as **hard**
(physically or logically necessary), **soft** (convention), or **hidden**
(assumed but never stated). Relax, tighten, or replace the soft and hidden
ones. Dropping a hidden constraint is often the most productive move. Stay
inside the task contract: the contract's fixed items are hard constraints.

## L6. Failure analysis and boundary probing

Take a strong method and list the implicit assumptions in how it was
evaluated (distribution, scale, composition, adversary, time). Violate each
one, find where it breaks, and explain **why**. A diagnosed failure plus a fix
is a direction; a diagnosed fundamental failure is an analysis contribution.

## L7. Cross-domain analogy

Describe the problem without field jargon, find a field that solves a
structurally similar problem (neuroscience, physics, economics, control,
ecology, linguistics, operations research …), and map its mechanism back. The
mapping must hold at the level of mechanism, not surface, and must produce a
testable prediction. A cross-product matrix (concepts of field A × problems of
field B) helps generate candidates.

## L8. Simplicity test

Strip the strongest current method to its one key idea, build the minimal
version carefully, and compare at equal compute and tuning. A small gap makes
simplicity the contribution; a large gap tells you which component matters.

## L9. Composition and decomposition

**Compose**: two methods that solve complementary sub-problems; what new
capability does the combination create? **Decompose**: a monolithic method
into parts; which part is the real bottleneck, and which is redundant?

## L10. Negation and inversion

List what "everyone knows" in the area and negate each: "labels are
necessary", "training and inference are separate", "answers must be exact".
Keep negations that are coherent and unexplored, or explored under conditions
that have since changed (see L4).

## L11. Dialectical synthesis

When two approaches or goals are treated as opposites, do not pick one. Ask
what a method achieving both would need, under which conditions the
opposition disappears, and whether it comes from how the problem was
formalized. A synthesis is a new framing, not a compromise.

## L12. Problem-first check (and stakeholder rotation)

For each direction, say whether it is problem-first (pain point → method) or
solution-first (technique → application). Problem-first: who suffers and how
much? Solution-first: name at least two real problems it addresses. Rotating
through stakeholders (end user, practitioner, theorist, adversary, operator,
affected community) surfaces concerns existing work leaves open.

## Lever buckets

Tag every direction with its primary lever: **data**, **model**,
**objective**, **optimization / training dynamics**, **inference**,
**evaluation protocol**, or **infrastructure**. If the lever is unclear, the
direction is still too fuzzy.

## Common pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Novelty without impact | "No one has done X", but no one needs X | L12 |
| Incremental by default | Every direction is a small benchmark gain | L1, L5 |
| Complexity worship | Many modules, each helping marginally | L8 |
| Echo chamber | All directions come from the same papers | L7, L2 |
| Stale assumptions | "Tried before and failed" (years ago) | L4 |
| Premature convergence | First idea committed without alternatives | Finish the full slate in Step 2 |
| Solution shopping | Mechanism picked before the limitation is understood | Redo the limitation card in Step 1 |
