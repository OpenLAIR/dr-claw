# Skills Taxonomy v2

## Goal

Define a logical, scalable skill classification model for 100+ skills without mixing user intent, technical type, domain, and governance status into one layer.

## Design Principles

1. One primary navigation axis.
2. Secondary dimensions stay as filters, not top-level navigation.
3. Skills may have multiple labels in most dimensions.
4. Each dimension answers exactly one question.
5. Folder structure is an implementation detail, not a user-facing taxonomy.

## Recommended Model

### Primary axis

`primaryIntent` is the default browsing and grouping key.

It answers:

`What is the user trying to do right now?`

Allowed values:

- `research`
- `ideation`
- `data`
- `experiment`
- `training`
- `evaluation`
- `writing`
- `deployment`

### Secondary axes

`intents` is multi-label and extends `primaryIntent` when a skill spans multiple workflow stages.

It answers:

`What jobs can this skill help with?`

Allowed values:

- `research`
- `ideation`
- `data`
- `experiment`
- `training`
- `evaluation`
- `writing`
- `deployment`

`capabilities` is multi-label and describes the technical nature of the skill.

It answers:

`What kind of technical capability is this?`

Allowed values:

- `search-retrieval`
- `research-planning`
- `agent-workflow`
- `data-processing`
- `training-tuning`
- `inference-serving`
- `evaluation-benchmarking`
- `prompt-structured-output`
- `multimodal`
- `interpretability`
- `safety-alignment`
- `infrastructure-ops`
- `visualization-reporting`

`domains` is multi-label and describes the application context.

It answers:

`Where is this skill most applicable?`

Allowed values:

- `general`
- `cs-ai`
- `bioinformatics`
- `medical`
- `vision`
- `nlp`
- `data-engineering`

`keywords` is multi-label and stores freeform discovery terms.

It answers:

`What terms might a user search for?`

Examples:

- `rag`
- `literature review`
- `bpe`
- `vector database`
- `fine-tuning`

### Governance axes

`source` is single-value and identifies provenance.

Allowed values:

- `dr-claw`
- `imported`

Legacy compatibility:

- `vibelab` may still appear in migrated data and should be normalized to `dr-claw` on read.

`status` is single-value and identifies curation state.

Allowed values:

- `candidate`
- `verified`
- `experimental`
- `deprecated`

Optional governance fields:

- `owner`
- `maintainers`
- `lastReviewedAt`

## What To Remove From The User Taxonomy

These should not be first-class user-facing classification axes:

- folder path
- current top-level group labels like `RAG`, `Fine-Tuning`, `Observability`
- mixed stage/category buckets like `Survey` and `Training & Tuning` in the same level
- source as a primary navigation entry

Those are still useful as metadata, but not as the main information architecture.

## Field Design

Recommended skill shape:

```json
{
  "name": "academic-researcher",
  "primaryIntent": "research",
  "intents": ["research", "writing"],
  "capabilities": ["search-retrieval"],
  "domains": ["cs-ai"],
  "keywords": ["paper", "literature review", "citation"],
  "source": "imported",
  "status": "verified",
  "summary": "Academic research assistant for literature reviews and paper analysis.",
  "relatedSkills": ["inno-deep-research", "scientific-writing"]
}
```

## UI Mapping

Left navigation:

- group by `primaryIntent`

Top filters:

- `intents`
- `capabilities`
- `domains`
- `source`
- `status`

Search index:

- `name`
- `summary`
- `keywords`
- `capabilities`
- `domains`

Card badges:

- show at most one `primaryIntent`
- show up to two `capabilities`
- show up to two `domains`

Detail panel:

- show full labels
- show related skills
- show governance fields

## Mapping From Current Model

Current model fields should be translated as follows:

- `topLevelGroup` -> internal legacy metadata only
- `collection` -> split into `primaryIntent` or `capabilities`, depending on meaning
- `domain` -> map into `domains`
- `source` -> keep as `source`
- `tags.meta` -> map into `keywords`

## Migration Rules

1. Every skill must have one `primaryIntent`.
2. Every skill may have multiple `intents`.
3. Every skill should have one to three `capabilities`.
4. Every skill should have at least one `domain`.
5. `keywords` can remain broad and freeform.
6. Do not infer user-facing taxonomy directly from folder names.

Manual corrections live in [../skills/skills-taxonomy-v2.overrides.json](../skills/skills-taxonomy-v2.overrides.json). Keep skill-specific exceptions there instead of hardcoding them into the export script.

## Example Mappings

### `academic-researcher`

- `primaryIntent`: `research`
- `intents`: `research`, `writing`
- `capabilities`: `search-retrieval`
- `domains`: `cs-ai`

### `inno-research-orchestrator`

- `primaryIntent`: `research`
- `intents`: `research`, `experiment`
- `capabilities`: `research-planning`, `agent-workflow`
- `domains`: `general`

### `vllm`

- `primaryIntent`: `deployment`
- `intents`: `deployment`, `evaluation`
- `capabilities`: `inference-serving`, `infrastructure-ops`
- `domains`: `cs-ai`

### `peft`

- `primaryIntent`: `training`
- `intents`: `training`, `experiment`
- `capabilities`: `training-tuning`
- `domains`: `cs-ai`

### `biorxiv-database`

- `primaryIntent`: `research`
- `intents`: `research`, `data`
- `capabilities`: `search-retrieval`, `data-processing`
- `domains`: `bioinformatics`

## Why This Is Better

- Users browse by goal, not by implementation structure.
- Multi-label support handles cross-cutting skills cleanly.
- Technical type and domain stop competing with workflow stage.
- Governance stays available without polluting discovery.
- The taxonomy can scale beyond 100 skills without becoming inconsistent.
