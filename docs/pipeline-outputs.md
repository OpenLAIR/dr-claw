# Pipeline Outputs

Dr. Claw's research pipeline produces structured artifacts across five stages. Each stage writes to a dedicated directory created when the project is initialized.

## Output Artifacts

| | Artifact | Location | Description |
|---|---|---|---|
| 📚 | Survey reports | `Survey/reports/` | Literature review summaries with citations, synthesized from arXiv, Semantic Scholar, and web sources |
| 📄 | Reference papers | `Survey/references/` | Downloaded PDFs and structured notes (abstract, methodology, evaluation, knowledge graph entries) |
| 💡 | Research ideas | `Ideation/ideas/` | Structured brainstorming outputs using creative frameworks (SCAMPER, SWOT, Mind Mapping) with multi-persona evaluation scores |
| 📖 | Ideation references | `Ideation/references/` | Supporting materials and prior work collected during idea generation |
| 🔬 | Experiment code | `Experiment/core_code/` | Implementation code produced by the plan → implement → judge loop |
| 📦 | Datasets | `Experiment/datasets/` | Downloaded or generated datasets used in experiments |
| 🧪 | Code references | `Experiment/code_references/` | Cloned GitHub repos and code survey outputs (architecture maps, dependency graphs) |
| 📊 | Analysis results | `Experiment/analysis/` | Statistical analysis, tables, charts, and paper-ready figures from experiment runs |
| 📝 | Paper draft | `Publication/paper/` | Academic manuscript in IEEE/ACM format with proper citations, structure, and LaTeX math |
| 🖼️ | Generated figures | `Publication/paper/` | AI-generated figures via Gemini image models (Nano Banana Pro) |
| 🎞️ | Slide deck | `Promotion/slides/` | Academic presentation slides with narration scripts |
| 🔊 | Audio narration | `Promotion/audio/` | TTS-generated audio for presentation delivery |
| 🎬 | Demo video | `Promotion/video/` | Combined slides + audio demo video |
| 🌐 | Project homepage | `Promotion/homepage/` | Generated project landing page for dissemination |

## Project Directory Structure

When a project is created, Dr. Claw initializes the following workspace:

```
your-project/
├── instance.json                    # Project config with absolute paths
├── Survey/
│   ├── references/                  # Downloaded papers and structured notes
│   └── reports/                     # Literature review summaries
├── Ideation/
│   ├── ideas/                       # Generated and evaluated research ideas
│   └── references/                  # Supporting materials for ideation
├── Experiment/
│   ├── code_references/             # Cloned repos and code survey outputs
│   ├── datasets/                    # Experiment datasets
│   ├── core_code/                   # Implementation code
│   └── analysis/                    # Results, statistics, and figures
├── Publication/
│   └── paper/                       # Manuscript drafts and generated figures
└── Promotion/
    ├── homepage/                    # Project landing page
    ├── slides/                      # Presentation deck
    ├── audio/                       # TTS narration
    └── video/                       # Demo video
```

## Pipeline Flow

```
Survey → Ideation → Experiment → Publication → Promotion
```

Each stage is powered by one or more [research skills](../skills/README.md). The agent reads and follows the corresponding `SKILL.md` to produce the artifacts above. Skills can be run independently (e.g., only paper writing) or as a full end-to-end pipeline.

## Stage → Skill Mapping

| Stage | Skills Used | Key Outputs |
|-------|------------|-------------|
| **Survey** | `inno-prepare-resources`, `inno-code-survey`, `inno-deep-research`, `paper-analyzer`, `paper-finder` | Literature reports, reference notes, code survey maps |
| **Ideation** | `inno-idea-generation`, `inno-idea-eval` | Ranked research ideas with multi-dimension scores |
| **Experiment** | `inno-experiment-dev`, `inno-experiment-analysis` | Runnable code, results tables, statistical analysis |
| **Publication** | `inno-paper-writing`, `inno-figure-gen`, `inno-paper-reviewer`, `inno-humanizer`, `inno-reference-audit`, `inno-rclone-to-overleaf` | Manuscript, figures, review feedback, Overleaf sync |
| **Promotion** | `making-academic-presentations` | Slides, narration audio, demo video, homepage |
