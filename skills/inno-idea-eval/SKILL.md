---
name: inno-idea-eval
description: >
  Multi-persona idea evaluation with quality gate. Evaluates ideas across
  5 InnoEval dimensions (Clarity, Novelty, Validity, Feasibility, Significance)
  using 3 reviewer personas and a meta-review. Sits between inno-idea-generation
  and inno-code-survey in the Idea branch. Use after inno-idea-generation.
---

# Inno Idea Eval

## Directory structure

```
skills/inno-idea-eval/
├── SKILL.md                                    ← this file
├── prompts/
│   ├── build_eval_query.md                     ← Per-persona evaluation query (all 5 dims)
│   ├── build_evidence_assembly.md              ← How to compose evidence from pipeline artifacts
│   ├── build_meta_review_query.md              ← Area-chair aggregation of 3 persona reviews
│   ├── build_novelty_queries.md                ← Query extraction for novelty verification (Step 0.5a)
│   ├── build_novelty_analysis.md               ← Similarity analysis for novelty verification (Step 0.5c)
│   └── build_refinement_feedback_query.md      ← Structured feedback for refinement loop
└── references/
    ├── eval_agent_instructions.md              ← Full eval agent system prompt + scoring rubrics
    ├── novelty_verification_config.md          ← Novelty search config, threat levels, fast-fail protocol
    └── reviewer_personas.md                    ← 3 persona definitions + evidence filter logic
```

> **How to use the resource files**: Each prompt template in `prompts/` documents
> the exact parameters, the full text template, and usage notes (when it is a new
> conversation vs. appended message, how to format evidence blocks, etc.).
> The `references/` directory contains the Eval Agent's complete system instructions
> including its scoring rubrics, persona definitions, and evidence filter logic.
> Consult these files for the authoritative details; the steps below provide a summary.

## Inputs

Paths for `Ideation/ideas` and `Ideation/references` come from **`instance.json`** (`instance.Ideation.ideas`, `instance.Ideation.references`). They are **absolute** in Dr. Claw-created projects; use as-is. If relative, resolve with `path.join(project_path, value)`.

| Parameter            | Required | Description |
|----------------------|----------|-------------|
| `selected_idea`      | Yes      | The idea to evaluate, read from `Ideation/ideas/selected_idea.txt` |
| `references`         | No\*     | Pre-formatted list of the source papers (`source_papers` in `Ideation/references/logs/load_instance.json`, from inno-prepare-resources) |
| `prepare_res`        | No\*     | Selected repositories and reasoning (`prepare_result` in `Ideation/references/logs/prepare_agent.json`, from inno-prepare-resources) |
| `download_res`       | No\*     | arXiv download results (`Ideation/references/logs/download_arxiv_source_by_title.json`) |
| `data_module`        | No\*     | Task description, exposed below as `data_module.TASK`: `task_instructions` in `load_instance.json`, or the task contract in `Ideation/ideas/idea_context.md`, or `sections.ideation` of the research brief |
| `context_variables`  | Yes      | Shared context dictionary (must contain `final_selected_idea_data`) |

\*Standalone mode: only `selected_idea` required; evaluation proceeds ungrounded with a noted limitation.

## Outputs

| Output                                         | Description |
|------------------------------------------------|-------------|
| `eval_report`                                  | Full markdown evaluation report (meta-review) |
| `eval_scores`                                  | Structured JSON: per-dimension, per-persona, aggregated |
| `eval_decision`                                | One of: `strong_accept` / `accept` / `borderline_accept` / `borderline_reject` / `reject` |
| `eval_feedback`                                | Strengths/weaknesses/suggestions (for refinement or downstream) |
| `context_variables["idea_evaluation_result"]`  | Complete structured result dict |

## Cache file outputs

Each step produces **two kinds** of files:

1. **`.txt` files** (primary) -- the full markdown content of each review, written directly to `Ideation/ideas/`
2. **`.json` files** (derived) -- structured metadata under `Ideation/ideas/logs/`, whose text fields **must be copied verbatim** from the corresponding `.txt` files (never summarized)

### Full directory layout

```
Ideation/ideas/
├── novelty_grounding_report.txt                ← Step 0.5: Active Novelty Verification report
├── eval_report.txt                             ← Step 4: full meta-review report (markdown)
├── eval_persona_1_review.txt                   ← Step 1: Senior ML Researcher review
├── eval_persona_2_review.txt                   ← Step 2: Domain Expert review
├── eval_persona_3_review.txt                   ← Step 3: Methods Specialist review
└── logs/
    ├── idea_eval_agent_novelty.json            ← Step 0.5: Novelty search + analysis structured data
    ├── idea_eval_agent_persona_1.json          ← Step 1: Persona 1 structured scores
    ├── idea_eval_agent_persona_2.json          ← Step 2: Persona 2 structured scores
    ├── idea_eval_agent_persona_3.json          ← Step 3: Persona 3 structured scores
    └── idea_eval_agent_meta_review.json        ← Step 4: Aggregated decision + full report
```

### Write order (critical)

For every step, **always write the `.txt` file first**, then build the `.json` file by copying the `.txt` content into the appropriate field:

For the novelty verification step:
1. Write `novelty_grounding_report.txt` with the full novelty analysis report
2. Copy that full text into `report_text`
3. Write `logs/idea_eval_agent_novelty.json`

For each persona review:
1. Write `eval_persona_{N}_review.txt` with the agent's full review
2. Read it back (or keep in memory) and embed the full text into `review_text`
3. Write the corresponding `logs/idea_eval_agent_persona_{N}.json`

For the meta-review step:
1. Write `eval_report.txt` with the agent's full meta-review report
2. Copy that full text into `report_text`
3. Write `logs/idea_eval_agent_meta_review.json`

### `.txt` file naming

| Step | File name | Content |
|------|-----------|---------|
| Novelty verification | `novelty_grounding_report.txt` | Active Novelty Verification report |
| Persona 1 review | `eval_persona_1_review.txt` | Full markdown review from Senior ML Researcher |
| Persona 2 review | `eval_persona_2_review.txt` | Full markdown review from Domain Expert |
| Persona 3 review | `eval_persona_3_review.txt` | Full markdown review from Methods Specialist |
| Meta-review | `eval_report.txt` | Full markdown meta-review report |

### `.json` file naming

| Step | File name | Key fields |
|------|-----------|------------|
| Novelty | `idea_eval_agent_novelty.json` | search_config, queries, novelty_threat_level, report_text |
| Persona 1 | `idea_eval_agent_persona_1.json` | persona, scores, review_text |
| Persona 2 | `idea_eval_agent_persona_2.json` | persona, scores, review_text |
| Persona 3 | `idea_eval_agent_persona_3.json` | persona, scores, review_text |
| Meta-review | `idea_eval_agent_meta_review.json` | aggregated_scores, decision, report |

### `.json` file format (each persona)

Each file contains `context_variables` only (no messages). The `review_text` field holds the **full text** copied from the corresponding `.txt` file:

```json
{
  "context_variables": {
    "ideas_path": "<instance.Ideation.ideas>",
    "references_path": "<instance.Ideation.references>",
    "persona": "senior_ml_researcher | domain_expert | methods_specialist",
    "scores": {
      "clarity": { "score": 0, "reason": "...", "references": [] },
      "novelty": { "score": 0, "reason": "...", "references": [] },
      "validity": { "score": 0, "reason": "...", "references": [] },
      "feasibility": { "score": 0, "reason": "...", "references": [] },
      "significance": { "score": 0, "reason": "...", "references": [] }
    },
    "strengths": [],
    "weaknesses": [],
    "suggestions": [],
    "recommendation": "Accept|Reject|...",
    "review_text": "<FULL text from eval_persona_{N}_review.txt>"
  }
}
```

### `.json` file format (meta-review)

```json
{
  "context_variables": {
    "ideas_path": "<instance.Ideation.ideas>",
    "references_path": "<instance.Ideation.references>",
    "aggregated_scores": {
      "clarity": { "avg": 0, "scores": [0, 0, 0] },
      "novelty": { "avg": 0, "scores": [0, 0, 0] },
      "validity": { "avg": 0, "scores": [0, 0, 0] },
      "feasibility": { "avg": 0, "scores": [0, 0, 0] },
      "significance": { "avg": 0, "scores": [0, 0, 0] }
    },
    "overall_avg": 0,
    "decision": "strong_accept|accept|borderline_accept|borderline_reject|reject",
    "report_text": "<FULL text from eval_report.txt>",
    "strengths": [],
    "weaknesses": [],
    "suggestions": [],
    "idea_evaluation_result": { "...complete structured result..." }
  }
}
```

### `.json` file format (novelty verification)

```json
{
  "context_variables": {
    "step": "novelty_verification",
    "search_config": {
      "num_queries": 4,
      "sources": ["arxiv", "semantic_scholar", "openalex"],
      "max_results_per_query": 10,
      "year_from": "<current_year - 3>"
    },
    "queries": [
      { "type": "core_method", "query": "...", "rationale": "..." },
      { "type": "problem_domain", "query": "...", "rationale": "..." },
      { "type": "key_component", "query": "...", "rationale": "..." },
      { "type": "broad_approach", "query": "...", "rationale": "..." }
    ],
    "idea_summary": "...",
    "search_results": { "total_raw": 0, "total_unique": 0 },
    "triage": [
      { "title": "...", "year": 0, "relevance": "high|medium|low|irrelevant", "is_inspiration_source": false, "assessment": "..." }
    ],
    "detailed_analysis": [
      { "title": "...", "year": 0, "overlap": "...", "differences": "...", "threat_level": "..." }
    ],
    "novelty_threat_level": "critical_overlap|high_overlap|moderate_overlap|low_overlap|novel",
    "genuine_novel_contributions": ["..."],
    "report_text": "<FULL text from novelty_grounding_report.txt>",
    "fast_fail_triggered": false,
    "user_decision": null
  }
}
```

- `review_text` and `report_text` must contain the **complete** markdown from the `.txt` file -- never a summary or abbreviation.
- **IMPORTANT**: Each persona `.json` grows independently; the meta-review `.json` aggregates all three.

## Step-by-step Instructions

### Step 0 -- Assemble Evidence

> Full template: [`prompts/build_evidence_assembly.md`](prompts/build_evidence_assembly.md)

Read existing pipeline artifacts and compose 3 evidence blocks (one per persona knowledge level):

| Persona Knowledge | Evidence Included |
|-------------------|-------------------|
| `high` (Senior ML) | All papers + LaTeX sources + all repos + full task context |
| `medium` (Domain Expert) | Paper titles/abstracts + repo descriptions + task context |
| `medium` (Methods Specialist) | Repo code + paper titles + implementation details |

Sources: `Ideation/references/papers/`, `Experiment/code_references/`, `references` string, `prepare_res`, `data_module.TASK`. No new search needed.

If running in standalone mode (no pipeline artifacts), note this limitation in each review and proceed with ungrounded evaluation.

### Step 0.5 -- Active Novelty Verification

> Query template: [`prompts/build_novelty_queries.md`](prompts/build_novelty_queries.md)
> Analysis template: [`prompts/build_novelty_analysis.md`](prompts/build_novelty_analysis.md)
> Configuration: [`references/novelty_verification_config.md`](references/novelty_verification_config.md)

Proactively search the literature to verify whether the idea (or key components) already exists. This step runs **before** persona reviews so all 3 reviewers have the prior art report as evidence.

**Sub-steps:**

**0.5a — Extract search queries** (LLM call using `build_novelty_queries.md`):
- Input: `selected_idea` + known `source_papers` (inspiration)
- Output: 4 search queries (core_method, problem_domain, key_component, broad_approach) + idea_summary + key_terms
- If query extraction fails, fall back to extracting queries from the idea title and key sentences

**0.5b — Execute searches** (4 invocations of `search_ai_papers.py`):
```bash
python3 <searching-ai-papers-skill-directory>/scripts/search_ai_papers.py \
  --query "<query>" --sources arxiv,semantic_scholar,openalex \
  --max-results 10 --year-from <current_year-3> --format json
```
- To resolve `<searching-ai-papers-skill-directory>`, search for the script at runtime:
  1. Look for a sibling skill directory: find a directory named `searching-ai-papers` alongside the other installed skills (e.g., next to this skill's own directory).
  2. Fallback: use `find` or `glob` to locate `searching-ai-papers/scripts/search_ai_papers.py` under common skill installation roots (`~/.claude/skills/`, `~/.codex/skills/`, or the parent of this skill's directory).
  3. If the script cannot be found, report the missing dependency to the user and skip the search step.
- Do not hardcode `~/.claude/...` or any other user-specific home path.
- Run once per query (4 total)
- Collect all results and cross-deduplicate by title similarity
- If a search fails, log the error and proceed with available results
- If ALL searches fail, proceed with unverified novelty (set threat level to `unverified`)

**0.5c — Analyze similarity** (LLM call using `build_novelty_analysis.md`):
- Input: `selected_idea` + deduplicated search results + `source_papers` + idea_summary + key_terms
- Three-phase analysis: Triage → Deep Analysis → Synthesis
- Papers matching known inspiration sources are tagged `[INSPIRATION_SOURCE]`
- Output: Novelty Grounding Report with threat level assessment

**0.5d — Fast-fail check**:
- If threat level is `critical_overlap` on a non-inspiration paper AND `CRITICAL_OVERLAP_FAST_FAIL` is true:
  - Present the overlapping paper to the user
  - Offer choices: **Proceed** / **Refine** / **Abandon**
  - Record the user's decision in the JSON log
- If user chooses "Refine": return to idea generation with the overlapping paper as context
- If user chooses "Abandon": stop evaluation

**0.5e — Inject report into evidence**:
- The Novelty Grounding Report is included in evidence blocks for ALL 3 personas (regardless of evidence level)
- In standalone mode, this step still runs (search does not depend on pipeline artifacts)

**Save (txt first, then json)**:
1. Write the full report -> `Ideation/ideas/novelty_grounding_report.txt`
2. Build structured data with `report_text` copied verbatim from the `.txt` file
3. Write -> `Ideation/ideas/logs/idea_eval_agent_novelty.json`

For refinement re-runs, save as `novelty_grounding_report_v{N}.txt` and `idea_eval_agent_novelty_v{N}.json`.

### Steps 1-3 -- Three Persona Reviews (each in a NEW conversation)

> Full template: [`prompts/build_eval_query.md`](prompts/build_eval_query.md)
> Agent system prompt: [`references/eval_agent_instructions.md`](references/eval_agent_instructions.md)
> Persona definitions: [`references/reviewer_personas.md`](references/reviewer_personas.md)

For each persona (1=Senior ML Researcher, 2=Domain Expert, 3=Methods Specialist):
1. Build eval query using `prompts/build_eval_query.md` template with persona-specific evidence block from Step 0
2. Start a NEW conversation with the Eval Agent
3. The agent evaluates all 5 dimensions and produces structured scores

**Scoring Calibration** (from InnoEval):
- 9-10 (10%): Groundbreaking / paradigm-shifting
- 7-8 (25%): Strong contribution with clear novelty
- 5-6 (45%): Solid but incremental
- 3-4 (15%): Notable weaknesses
- 0-2 (5%): Fundamentally flawed

**Self-Discovery Check** (Novelty only): If a found paper appears identical to the idea, assume it IS the idea's inspiration source -- don't penalize.

**Save (txt first, then json)** after each persona:
1. Write the agent's full review -> `Ideation/ideas/eval_persona_{N}_review.txt`
2. Build structured scores JSON
3. Write -> `Ideation/ideas/logs/idea_eval_agent_persona_{N}.json`

### Step 4 -- Meta-Review

> Full template: [`prompts/build_meta_review_query.md`](prompts/build_meta_review_query.md)

Aggregate all 3 reviews. The agent acts as Area Chair:
- Computes average score per dimension across all personas
- Resolves reviewer disagreements (where scores differ by >3 points)
- Produces final recommendation

**Decision Thresholds**:

| Average Score | Decision | Action |
|---------------|----------|--------|
| >= 7.0 | `strong_accept` | Proceed to code survey |
| >= 6.0 | `accept` | Proceed to code survey |
| >= 5.0 | `borderline_accept` | Present report, ask user whether to proceed or refine |
| >= 4.0 | `borderline_reject` | Suggest refinement, ask user |
| < 4.0 | `reject` | Trigger refinement loop automatically |

**Save (txt first, then json)**:
1. Write the meta-review report -> `Ideation/ideas/eval_report.txt`
2. Build aggregated scores and decision
3. Write -> `Ideation/ideas/logs/idea_eval_agent_meta_review.json`

### Step 5 -- Quality Gate

- **Accept path** (`strong_accept` or `accept`): Pipeline continues to `inno-code-survey`. `selected_idea` passes through unchanged.
- **Borderline path** (`borderline_accept` or `borderline_reject`): Present evaluation report to user. Ask whether to proceed, refine, or abandon.
- **Reject path** (`reject`): Build structured feedback via `prompts/build_refinement_feedback_query.md`. Trigger refinement loop.

### Step 6 -- Refinement Loop (if triggered)

> Full template: [`prompts/build_refinement_feedback_query.md`](prompts/build_refinement_feedback_query.md)

1. Build structured feedback from all persona reviews (weaknesses + suggestions)
2. Append refinement prompt to the original idea generation conversation (from `inno-idea-generation`)
3. Idea Agent revises the idea (not generates new)
4. Save revised idea as `Ideation/ideas/refined_idea_v{N}.txt`
5. Re-run evaluation (Steps 1-4) on the refined idea
6. Maximum 2 refinement iterations before requiring user decision
7. If accepted after refinement, update `selected_idea.txt` and `final_selected_idea_data`

### Step 7 -- Output

Set `context_variables["idea_evaluation_result"]` with complete structured data:

```json
{
  "decision": "strong_accept|accept|...",
  "overall_avg": 0.0,
  "aggregated_scores": { "..." },
  "persona_reviews": [ "..." ],
  "report": "<full report text>",
  "novelty_verification": {
    "threat_level": "critical_overlap|high_overlap|moderate_overlap|low_overlap|novel",
    "genuine_novel_contributions": ["..."],
    "search_coverage": { "total_raw": 0, "total_unique": 0, "sources": ["..."] },
    "fast_fail_triggered": false,
    "user_decision": null
  },
  "refinement_iterations": 0,
  "grounded": true
}
```

If refinement occurred, also update:
- `Ideation/ideas/selected_idea.txt` with the refined idea
- `context_variables["final_selected_idea_data"]` with updated text

## Configuration

| Constant                     | Default | Description |
|------------------------------|---------|-------------|
| `NUM_PERSONAS`               | 3       | Number of reviewer personas |
| `ACCEPT_THRESHOLD`           | 6.0     | Minimum avg score for automatic accept |
| `STRONG_ACCEPT_THRESHOLD`    | 7.0     | Minimum avg score for strong accept |
| `BORDERLINE_THRESHOLD`       | 5.0     | Minimum avg score before auto-reject |
| `REJECT_THRESHOLD`           | 4.0     | Below this triggers automatic refinement |
| `MAX_REFINEMENT_ITERATIONS`  | 2       | Maximum refinement attempts before user decision |
| `NUM_QUERIES`                | 4       | Search queries extracted from idea (Step 0.5) |
| `MAX_RESULTS_PER_QUERY`     | 10      | Results per query per source (Step 0.5) |
| `DEFAULT_SOURCES`            | `arxiv,semantic_scholar,openalex` | Search sources for novelty verification |
| `YEAR_WINDOW`                | 3       | Years back to search from current year |
| `CRITICAL_OVERLAP_FAST_FAIL` | `true`  | User checkpoint on critical overlap detection |

## Checklist

- [ ] Evidence assembled from pipeline artifacts (or standalone mode noted)
- [ ] Novelty queries extracted (4 queries: core_method, problem_domain, key_component, broad_approach)
- [ ] Literature search executed (4 queries x 3 sources) and results deduplicated
- [ ] Novelty Grounding Report generated with threat level assessment
- [ ] Fast-fail check applied (if critical_overlap detected on non-inspiration paper)
- [ ] Report saved -> `novelty_grounding_report.txt`, then full text copied into `logs/idea_eval_agent_novelty.json`
- [ ] Novelty report injected into evidence blocks for all 3 personas
- [ ] Persona 1 review saved -> `eval_persona_1_review.txt`, then full text copied into `logs/idea_eval_agent_persona_1.json`
- [ ] Persona 2 review saved -> `eval_persona_2_review.txt`, then full text copied into `logs/idea_eval_agent_persona_2.json`
- [ ] Persona 3 review saved -> `eval_persona_3_review.txt`, then full text copied into `logs/idea_eval_agent_persona_3.json`
- [ ] Meta-review saved -> `eval_report.txt`, then full text copied into `logs/idea_eval_agent_meta_review.json`
- [ ] Decision computed from aggregated scores
- [ ] Quality gate applied: accept -> proceed; borderline -> ask user; reject -> refine
- [ ] If refinement: feedback built, idea revised, re-evaluated (max 2 iterations)
- [ ] `context_variables["idea_evaluation_result"]` set with complete structured data (including `novelty_verification`)
- [ ] If refinement occurred: `selected_idea.txt` updated, `final_selected_idea_data` updated
- [ ] All `.txt` files written to `Ideation/ideas/`, all `.json` files written to `Ideation/ideas/logs/`
