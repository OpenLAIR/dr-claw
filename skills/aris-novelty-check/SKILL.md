---
name: aris-novelty-check
description: Verify research idea novelty against recent literature. Use when user says "查新", "novelty check", "有没有人做过", "check novelty", or wants to verify a research idea is novel before implementing.
argument-hint: "[method-or-idea-description]"
allowed-tools: WebSearch, WebFetch, Grep, Read, Glob, Agent, Bash(curl *), Bash(python3 *), mcp__codex__codex
license: MIT
metadata:
  author: wanshuiyin/ARIS
  version: "1.0.0"
---

# Novelty Check Skill

Check whether a proposed method/idea has already been done in the literature: **$ARGUMENTS**

## Constants

- REVIEWER_MODEL = `gpt-5.4` — Model used via Codex MCP. Must be an OpenAI model (e.g., `gpt-5.4`, `o3`, `gpt-4o`)

Codex MCP is **optional**. Without it, Phase C runs a same-model adversarial review
instead (see below), and the report says so.

## Instructions

Given a method description, systematically verify its novelty:

### Phase A: Extract Key Claims
1. Read the user's method description
2. Identify 3-5 core technical claims that would need to be novel:
   - What is the method?
   - What problem does it solve?
   - What is the mechanism?
   - What makes it different from obvious baselines?

### Phase B: Multi-Source Literature Search
For EACH core claim, search using ALL available sources:

1. **Web Search** (via `WebSearch`):
   - Search arXiv, Google Scholar, Semantic Scholar
   - Use specific technical terms from the claim
   - Try at least 3 different query formulations per claim
   - Focus on the last 2–3 years, and always include the last 6 months of arXiv

   If `WebSearch` is not available in this environment, query the APIs directly:
   ```bash
   # arXiv (Atom XML; wait 3 s between calls)
   curl -s "https://export.arxiv.org/api/query?search_query=all:%22<url-encoded phrase>%22&sortBy=submittedDate&max_results=20"
   # Semantic Scholar (JSON; rate-limited without SEMANTIC_SCHOLAR_API_KEY)
   curl -s "https://api.semanticscholar.org/graph/v1/paper/search?query=<url-encoded query>&limit=20&fields=title,year,venue,abstract,externalIds"
   ```
   The `aris-arxiv` and `aris-semantic-scholar` skills wrap the same APIs, if enabled.

2. **Known paper databases**: Check against:
   - The main venues of the field for the last two years (for ML: ICLR, NeurIPS, ICML; add ACL/EMNLP, CVPR/ICCV, KDD, etc. as relevant)
   - Recent arXiv preprints (last 12 months)

3. **Read abstracts**: For each potentially overlapping paper, WebFetch its abstract and related work section

### Phase C: Cross-Model Verification

First check whether Codex MCP is available: the `mcp__codex__codex` tool must be
in your tool list, and a call must not fail with a missing-key or connection
error. Then follow **C1** or **C2**.

#### C1. With Codex MCP (preferred)

Call REVIEWER_MODEL via Codex MCP (`mcp__codex__codex`) with xhigh reasoning:
```
config: {"model_reasoning_effort": "xhigh"}
```
Prompt should include:
- The proposed method description
- All papers found in Phase B
- Ask: "Is this method novel? What is the closest prior work? What is the delta?"

#### C2. Without Codex MCP (fallback)

Run an adversarial review with the same model, kept apart from your own
reasoning so far:

1. If you can start a sub-agent (the `Agent` tool or equivalent), give it only
   the method description and the Phase B paper list (titles, years, abstracts,
   links), with this brief: "You are a skeptical area chair. Argue that this
   method is NOT novel: name the closest prior work, explain the overlap
   concretely, and list any search you would still run. Then state the strongest
   remaining delta, if any." Ask it to run up to 3 extra searches of its own.
2. If no sub-agent is available, do the same yourself as a separate pass: write
   the strongest case against novelty first, run at least 3 new queries aimed
   at that case (other names for the mechanism, adjacent fields, older work),
   and only then weigh it against the delta you found in Phase B.
3. Reconcile: every overlap raised must be answered with a concrete difference
   or accepted as prior work.

Same-model review is weaker than a second model. Lower your confidence
accordingly, and never give an overall score above 7/10 on this path unless the
closest prior work is clearly identified and clearly different.

### Phase D: Novelty Report
Output a structured report:

```markdown
## Novelty Check Report

### Proposed Method
[1-2 sentence description]

### Verification
[Cross-model (Codex, REVIEWER_MODEL) | Same-model adversarial review (no Codex MCP) — weaker]. Sources searched: [WebSearch / arXiv API / Semantic Scholar / ...]

### Core Claims
1. [Claim 1] — Novelty: HIGH/MEDIUM/LOW — Closest: [paper]
2. [Claim 2] — Novelty: HIGH/MEDIUM/LOW — Closest: [paper]
...

### Closest Prior Work
| Paper | Year | Venue | Overlap | Key Difference |
|-------|------|-------|---------|----------------|

### Overall Novelty Assessment
- Score: X/10
- Recommendation: PROCEED / PROCEED WITH CAUTION / ABANDON
- Key differentiator: [what makes this unique, if anything]
- Risk: [what a reviewer would cite as prior work]

### Suggested Positioning
[How to frame the contribution to maximize novelty perception]
```

### Important Rules
- Be BRUTALLY honest — false novelty claims waste months of research time
- "Applying X to Y" is NOT novel unless the application reveals surprising insights
- Check both the method AND the experimental setting for novelty
- If the method is not novel but the FINDING would be, say so explicitly
- Always check the most recent 6 months of arXiv — the field moves fast
