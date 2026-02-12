# InnoFlow Research Pipeline Skills

Project-scoped skills for the Research flow (idea generation, code survey, implementation plan, ML dev, experiments). Canonical behavior is in the Medical_ai_scientist_idea repo: `run_infer_idea_ours.py` (idea mode) and `run_infer.py` (plan mode).

## Skill list

| Skill | Purpose |
|-------|---------|
| **inno-research-orchestrator** | Meta skill: maturity judgment (plan vs idea) and flow control |
| inno-prepare-resources | Load instance, GitHub search, Prepare Agent, arXiv download |
| inno-idea-generation | Generate/select/refine ideas (Idea branch only) |
| inno-code-survey | Phase A: acquire missing repos + merge into prepare_res; Phase B: comprehensive code survey. Both phases for Idea branch; Phase B only for Plan branch |
| inno-experiment-dev | Implementation plan + ML code + Judge loop + experiment submission |
| inno-experiment-analysis | Analyse experiment results, draw charts, suggest and implement refinements |
| inno-paper-writing | Write publication-ready ML/AI papers with LaTeX templates, citation verification, and conference checklists |

## Script reuse (plan-scripts-reuse)

- **Call directly (same process / backend)**: All prompt builders (`build_*_query`, `build_*_query_for_plan`) and agents live in the research_agent Python codebase. When the VibeLab backend runs in an environment that can import `research_agent` (e.g. same repo or installed package), call the existing functions and agents directly; do not reimplement logic in SKILL.md.
- **Thin wrappers when needed**: If the backend cannot import the Medical_ai_scientist_idea project, add a thin API or CLI that invokes `run_infer_idea_ours.py` / `run_infer.py` (or a small runner that calls `load_instance`, `github_search`, etc.) and returns structured outputs. Skills then reference "call backend endpoint X" or "run script Y" instead of in-process calls.
- **Critical helpers**: Parsing `[REPO_ACQUIRED]` and scanning `.tex` in `workplace/papers_engineering` are small; either call the existing Python helpers or reimplement in a shared `scripts/` or `inno-utils/` folder and document the contract in the relevant SKILL.md (inno-code-survey, inno-idea-generation). The `github_search_clone.py` script in `inno-code-survey/scripts/` provides standalone GitHub repo search + clone.

## Progressive adoption

- **Phase 1**: Skills 1–3 (prepare, idea-generation, code-survey Phase A) for "idea-only" workflows.
- **Phase 2**: Add remaining skills for full pipeline (code survey Phase B → experiment-dev → experiment-analysis).
- **Phase 3**: Paper writing (inno-paper-writing) for generating publication-ready papers from experiment results.
