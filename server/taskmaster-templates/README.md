# TaskMaster Template Schema

This directory contains JSON templates used by the Pipeline Board.

Each template serves two purposes:

1. Define the web form fields users fill in (`metaFields`, `sectionFields`).
2. Define how tasks are generated from `research_brief.json` (`pipeline.stages.*.task_blueprints`).

## How Templates Are Used

When a user applies a template:

1. Backend creates `.pipeline/docs/research_brief.json` using the selected template.
2. User-provided form values are mapped into JSON paths (for example `sections.ideation.problem_framing`).
3. Backend parses that brief and generates `.pipeline/tasks/tasks.json` from `pipeline.stages`.

## Required Top-Level Fields

Each template JSON should include:

- `id`: Stable template identifier.
- `name`: Human-readable template name shown in UI.
- `description`: Short UI description.
- `domain`: Logical grouping (for filtering).
- `category`: Usually same as domain.
- `format`: Currently `research-brief-json`.
- `fileName`: Usually `research_brief.json`.
- `metaFields`: Array of meta form field definitions.
- `sectionFields`: Form field definitions grouped by `survey`, `ideation`, `experiment`, `publication`, `promotion`.
- `pipeline`: Task generation blueprint (stage requirements, quality gates, and task blueprints).

## Field Definition Schema

Fields inside `metaFields` and `sectionFields.*` use:

- `key`: Local field key.
- `label`: UI label.
- `path`: Dot-path written into the brief JSON.
- `placeholder`: Optional UI hint text.
- `type`: Optional, use `"array"` for multi-line list input.

For `type: "array"`, each input line becomes one array item.

## Pipeline Schema

`pipeline` drives task generation. Typical shape:

- `version`: Pipeline schema version.
- `mode`: Optional mode marker (for example `"idea"`).
- `stages`: Object with keys:
  - `survey`
  - `ideation`
  - `experiment`
  - `publication`
  - `promotion`

Each stage may define:

- `required_elements`: JSON paths that should exist in the brief.
- `optional_elements`: Additional paths for guidance.
- `quality_gate`: Checklist items.
- `task_blueprints`: Ordered task definitions used to build `tasks.json`.
- `recommended_skills`: Suggested skills for that stage.

## Stage-to-Skills Mapping

Current backend stage skill map (also used as fallback when a task does not provide explicit `recommended_skills`):

| Stage | Base Skills | Type-Specific Hints |
|---|---|---|
| `survey` | `inno-deep-research`, `academic-researcher`, `dataset-discovery` | `exploration` -> `inno-deep-research`, `academic-researcher`, `dataset-discovery`; `analysis` -> `inno-deep-research`, `academic-researcher` |
| `ideation` | `inno-pipeline-planner`, `inno-idea-generation`, `inno-prepare-resources` | `analysis` -> `inno-idea-generation`, `academic-researcher`; `exploration` -> `inno-idea-generation`, `inno-code-survey` |
| `experiment` | `inno-code-survey`, `inno-experiment-dev`, `inno-experiment-analysis` | `implementation` -> `inno-experiment-dev`, `analysis` -> `inno-experiment-analysis`, `exploration` -> `inno-code-survey` |
| `publication` | `ml-paper-writing`, `inno-reference-audit`, `inno-rclone-to-overleaf` | `writing` -> `ml-paper-writing`, `analysis` -> `inno-reference-audit` |
| `promotion` | `making-academic-presentations` | `scripting`/`rendering`/`narration`/`delivery` -> `making-academic-presentations` |

Recommendation priority for each task:

1. Stage-level `recommended_skills`
2. Stage map base skills
3. Stage map task-type skills
4. Task blueprint `recommended_skills`

## Task Blueprint Schema

Each item in `task_blueprints` supports:

- `id`: Stable blueprint id.
- `title`: Task title shown in UI.
- `description`: Task description.
- `taskType`: Suggested type (for example `analysis`, `implementation`, `writing`, `exploration`, `scripting`, `rendering`, `narration`, `delivery`).
- `priority`: Optional (`low`, `medium`, `high`).
- `dependencies`: Optional array of task IDs.
- `inputsNeeded`: Optional array of required JSON paths or inputs.
- `recommended_skills`: Optional per-task skills.
- `nextActionPrompt`: Optional prompt used by chat handoff.

## Minimal Template Example

```json
{
  "id": "example-template",
  "name": "Example Template",
  "description": "Demo template",
  "domain": "ai-research",
  "category": "ai-research",
  "format": "research-brief-json",
  "fileName": "research_brief.json",
  "metaFields": [
    { "key": "title", "label": "Title", "path": "meta.title" }
  ],
  "sectionFields": {
    "ideation": [
      { "key": "problem_framing", "label": "Problem Framing", "path": "sections.ideation.problem_framing" }
    ],
    "experiment": [],
    "publication": [],
    "promotion": []
  },
  "pipeline": {
    "version": "1.1",
    "mode": "idea",
    "stages": {
      "ideation": {
        "required_elements": ["sections.ideation.problem_framing"],
        "quality_gate": ["Problem framing is specific"],
        "task_blueprints": [
          {
            "id": "define_problem_scope",
            "title": "Define problem scope",
            "description": "Clarify scope, assumptions, and constraints.",
            "taskType": "analysis"
          }
        ],
        "recommended_skills": ["inno-idea-generation"]
      },
      "experiment": { "task_blueprints": [] },
      "publication": { "task_blueprints": [] },
      "promotion": { "task_blueprints": [] }
    }
  }
}
```

## Notes

- Keep `id` stable once released (it may be used in saved briefs).
- Keep `path` values aligned with the `research_brief.json` shape.
- Task order in `task_blueprints` matters; it affects generated task order.
