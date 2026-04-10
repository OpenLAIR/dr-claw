# Skills

Skills are structured instruction files (SKILL.md) that tell an AI coding agent (Claude Code, Gemini CLI, etc.) what to do and how to do it. They are NOT standalone scripts — they are prompts/playbooks that an agent reads and follows:

`
Your instruction → Agent → reads SKILL.md → follows the instructions and use Skills
`
# InnoFlow Research Pipeline Skills

Project-scoped skills for the Research flow (idea generation, code survey, implementation plan, ML dev, experiments). Canonical behavior is in the Medical_ai_scientist_idea repo: `run_infer_idea_ours.py` (idea mode) and `run_infer.py` (plan mode).

## Project layout

When a project is **created in Dr. Claw**, the app creates **`instance.json`** at the project root (single config with **absolute paths**) and these preset directories:

- `Survey/references`, `Survey/reports`
- `Ideation/ideas`, `Ideation/references`
- `Experiment/code_references`, `Experiment/datasets`, `Experiment/core_code`, `Experiment/analysis`
- `Publication/paper`
- `Promotion/homepage`, `Promotion/slides`, `Promotion/audio`, `Promotion/video`

Skills read paths from `instance.json` and write logs under each area’s `logs/` as needed.

## Skill taxonomy

17 skills organized by pipeline stage. Depth follows natural structure — sub-groups only where real internal phases exist.

```
skills/
│
├─ Research & Discovery
│  ├─ inno-prepare-resources                Setup: load instance, GitHub search, arXiv download
│  ├─ dataset-discovery                     Find and evaluate datasets for a research task
│  ├─ inno-code-survey                      Repo acquisition (Phase A) + code survey (Phase B)
│  └─ inno-deep-research                    Comprehensive research assistant (multi-source synthesis with citations)
│
├─ Ideation
│  ├─ inno-idea-generation                  Structured brainstorming via creative frameworks (SCAMPER, SWOT)
│  └─ inno-idea-eval                        Multi-persona evaluation (5 dims) + quality gate
│
├─ Experiment
│  ├─ inno-experiment-dev                   Plan → implement → judge loop → submit
│  └─ inno-experiment-analysis              Analyse results with statistical methods for paper-ready content
│
├─ Publication
│  ├─ Authoring
│  │  ├─ inno-paper-writing                 Academic paper writing (IEEE/ACM format, citations, structure)
│  │  └─ inno-figure-gen                    Image generation via Nano Banana Pro (Gemini 3 Pro Image)
│  ├─ Review & Polish
│  │  ├─ inno-paper-reviewer                Structured peer review with checklist-based evaluation
│  │  ├─ inno-humanizer                     Rewrite to remove AI-writing markers
│  │  └─ inno-reference-audit               Citation verification and fake citation prevention
│  └─ inno-rclone-to-overleaf               Access & sync Overleaf projects via CLI
│
├─ Promotion
│  └─ making-academic-presentations         Slides, narration, TTS audio, and demo-video generation
│
├─ Knowledge Management
│  └─ managing-obsidian-notes               Obsidian vault CRUD via CLI, vault bootstrap, project scaffolding
│
└─ Domain-Specific
   └─ bioinformatics-init-analysis          CyTOF / scRNA-seq / flow cytometry pipeline
```

### Pipeline flow

```
Orchestration ──► Research & Discovery ──► Ideation ──► Experiment ──► Publication ──► Promotion
                  (can enter here if
                   plan already exists) ───────────────────────────────┘ skip if plan branch
```

### Depth rationale

| Group | Depth | Why |
|-------|-------|-----|
| Orchestration | 1 (standalone) | Single entry point, no peers |
| Research & Discovery | 2 | Literature Survey merged into single skill; other skills are independent |
| Ideation | 2 | Two tightly-coupled skills (generate → evaluate), flat is sufficient |
| Experiment | 2 | Two sequential skills (dev → analysis), flat is sufficient |
| Publication | 3 | Authoring vs Review & Polish are distinct concerns with different triggers |
| Promotion | 2 | Presentation and dissemination assets are a separate downstream stage |
| Domain-Specific | 2 | Extensible bucket; currently one entry |

> **Note:** Folder structure on disk is still flat (`skills/<skill-name>/`). This taxonomy is a logical grouping for documentation and navigation; `stage-skill-map.json` encodes the runtime mapping used by the Pipeline Board.

## Stage skill map (for Pipeline Board)

- File: `skills/stage-skill-map.json`
- Purpose: Runtime mapping from pipeline stage/task type to recommended skills used by TaskMaster task generation.
- Hot update behavior: Backend reloads this file by mtime, so editing it will update newly generated task recommendations without code changes.

## Skill tag mapping (for Skills panel)

- File: `skills/skill-tag-mapping.json`
- Purpose: Runtime mapping for skill tags shown in the **Skills Dashboard** (stage tags, domain tags, and platform source tag).

### Fields

- `stageOverrides`: Per-skill stage tag override, keyed by skill folder name.
- `domainOverrides`: Per-skill domain tag override, keyed by skill folder name.
- `platformNativeSkills`: Skills that should show the source tag (`来源: 平台自研` / `Source: Dr. Claw`).
- `domainCsAiExceptions`: Exception list for the global `cs.AI` domain policy.

### Current policy

- For skills in `platformNativeSkills`, domain is forced to `cs.AI`.
- Skills listed in `domainCsAiExceptions` keep their own domain mapping.

### Maintenance notes

- Keep keys exactly the same as skill directory names under `skills/`.
- Prefer updating this JSON instead of editing frontend code when tags change.

### Tag annotation conventions

- `domain`:
  - Prefer following the arXiv taxonomy (for example: `cs.AI`, `cs.CL`, `cs.CV`, `q-bio`).
  - Use the closest primary category for the skill's main capability; avoid overly broad custom names when a standard arXiv label exists.
- `source`:
  - Use two levels:
    - Internal: skills proposed/maintained by Dr. Claw (`来源: 平台自研` / `Source: Dr. Claw`).
    - External: skills introduced from outside Dr. Claw (third-party/community/imported repositories).
  - `platformNativeSkills` should include all internal skills.
- `stage`:
  - Keep stage tags aligned with the pipeline lifecycle. Recommended buckets:
    - Orchestration
    - Resource Prep
    - Idea Generation
    - Idea Evaluation
    - Survey
    - Experiment Dev
    - Analysis
    - Paper Writing
    - Paper Review
    - Publication Sync
    - Promotion Assets
  - Use `stageOverrides` for deterministic mapping when keyword inference is ambiguous.

## Script reuse (plan-scripts-reuse)

- **Call directly (same process / backend)**: All prompt builders (`build_*_query`, `build_*_query_for_plan`) and agents live in the research_agent Python codebase. When the Dr. Claw backend runs in an environment that can import `research_agent` (e.g. same repo or installed package), call the existing functions and agents directly; do not reimplement logic in SKILL.md.
- **Thin wrappers when needed**: If the backend cannot import the Medical_ai_scientist_idea project, add a thin API or CLI that invokes `run_infer_idea_ours.py` / `run_infer.py` (or a small runner that calls `load_instance`, `github_search`, etc.) and returns structured outputs. Skills then reference "call backend endpoint X" or "run script Y" instead of in-process calls.
- **Critical helpers**: Parsing `[REPO_ACQUIRED]` and scanning `.tex` in `workplace/papers_engineering` are small; either call the existing Python helpers or reimplement in a shared `scripts/` or `inno-utils/` folder and document the contract in the relevant SKILL.md (inno-code-survey, inno-idea-generation). The `github_search_clone.py` script in `inno-code-survey/scripts/` provides standalone GitHub repo search + clone.

## Progressive adoption

- **Phase 1**: Skills 1–3 (prepare, idea-generation, code-survey Phase A) for "idea-only" workflows.
- **Phase 2**: Add remaining skills for full pipeline (code survey Phase B → experiment-dev → experiment-analysis).
- **Phase 3**: Paper writing, review, and polish (`inno-paper-writing` + `inno-paper-reviewer` + `inno-humanizer`) for publication-ready deliverables.
- **Phase 4**: Promotion assets (`making-academic-presentations`) for homepage, slide deck, audio, and demo-video outputs.
