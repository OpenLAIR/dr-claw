# `research_brief.json` Schema

Canonical contract for `.pipeline/docs/research_brief.json`.

```json
{
  "schemaVersion": "1.1",
  "templateId": "agent-generated",
  "meta": {
    "title": "<paper/project title from user; infer only from provided context>",
    "lead_author": "<string or empty string>",
    "target_venue": "<string or empty string>",
    "date": "<YYYY-MM-DD>"
  },
  "sections": {
    "survey": {
      "literature_scope": "<string>",
      "key_references": ["<string>"],
      "synthesis_summary": "<string>",
      "open_gaps": ["<string>"]
    },
    "ideation": {
      "research_goal": "<string>",
      "problem_framing": "<string>",
      "evidence_plan": "<string>",
      "success_criteria": ["<string>"]
    },
    "experiment": {
      "hypothesis_or_validation_goal": "<string>",
      "dataset_or_data_source": "<string>",
      "method_or_protocol": "<string>",
      "evaluation_plan": "<string>"
    },
    "publication": {
      "paper_outline": "<string>",
      "figures_tables_plan": "<string>",
      "artifact_plan": "<string>",
      "submission_checklist": []
    },
    "promotion": {
      "slide_outline": "<string>",
      "deck_style": "<string>",
      "tts_config": "<string>",
      "video_assembly_plan": "<string>",
      "homepage_plan": "<string>"
    }
  },
  "pipeline": {
    "version": "1.1",
    "mode": "idea",
    "startStage": "survey",
    "stages": {
      "survey": {
        "required_elements": [
          "sections.survey.literature_scope",
          "sections.survey.synthesis_summary"
        ],
        "optional_elements": [
          "sections.survey.key_references",
          "sections.survey.open_gaps"
        ],
        "quality_gate": [
          "Literature scope and search boundary are explicit",
          "Synthesis identifies concrete open gaps"
        ],
        "task_blueprints": [
          {
            "id": "survey_collect_references",
            "title": "Collect and triage the core literature set",
            "description": "Gather key references, cluster them by theme, and document inclusion boundaries.",
            "taskType": "exploration",
            "recommended_skills": ["inno-deep-research"]
          },
          {
            "id": "survey_summarize_gaps",
            "title": "Summarize trends, baselines, and open gaps",
            "description": "Synthesize the literature into trends, tensions, and high-value research gaps.",
            "taskType": "analysis",
            "recommended_skills": ["inno-deep-research", "academic-researcher"]
          }
        ],
        "recommended_skills": ["inno-deep-research", "academic-researcher", "dataset-discovery"]
      },
      "ideation": {
        "required_elements": [
          "sections.ideation.research_goal",
          "sections.ideation.problem_framing"
        ],
        "optional_elements": [
          "sections.ideation.evidence_plan",
          "sections.ideation.success_criteria"
        ],
        "quality_gate": [
          "<domain-specific gate>",
          "<domain-specific gate>"
        ],
        "task_blueprints": [
          {
            "id": "ideation_explore_directions",
            "title": "<topic-specific title>",
            "description": "<topic-specific description>",
            "taskType": "exploration",
            "recommended_skills": ["inno-idea-generation"]
          },
          {
            "id": "ideation_select_direction",
            "title": "Select research direction with explicit rationale",
            "description": "Compare candidate directions on novelty, feasibility, and impact; pick one and record trade-offs.",
            "taskType": "analysis",
            "recommended_skills": ["inno-idea-eval"]
          }
        ],
        "recommended_skills": ["inno-idea-generation", "inno-prepare-resources"]
      },
      "experiment": {
        "required_elements": [
          "sections.experiment.hypothesis_or_validation_goal",
          "sections.experiment.method_or_protocol",
          "sections.experiment.evaluation_plan"
        ],
        "optional_elements": [
          "sections.experiment.dataset_or_data_source"
        ],
        "quality_gate": [
          "<domain-specific gate>",
          "<domain-specific gate>"
        ],
        "task_blueprints": [
          {
            "id": "experiment_define_protocol",
            "title": "<topic-specific title>",
            "description": "<topic-specific description>",
            "taskType": "implementation",
            "recommended_skills": ["inno-experiment-dev", "inno-code-survey"]
          },
          {
            "id": "experiment_run_analysis",
            "title": "Run baseline analysis and record outcomes",
            "description": "Execute baseline validation and summarize findings and gaps.",
            "taskType": "analysis",
            "recommended_skills": ["inno-experiment-analysis"]
          }
        ],
        "recommended_skills": ["inno-code-survey", "inno-experiment-dev", "inno-experiment-analysis"]
      },
      "publication": {
        "required_elements": [
          "sections.publication.paper_outline",
          "sections.publication.submission_checklist"
        ],
        "optional_elements": [
          "sections.publication.figures_tables_plan",
          "sections.publication.artifact_plan"
        ],
        "quality_gate": [
          "Contribution narrative and structure are coherent",
          "Submission checklist and artifacts are complete"
        ],
        "task_blueprints": [
          {
            "id": "publication_outline_to_draft",
            "title": "Expand outline into draft sections",
            "description": "Convert outline into structured draft sections with claim-evidence alignment.",
            "taskType": "writing",
            "recommended_skills": ["ml-paper-writing"]
          },
          {
            "id": "publication_finalize_artifacts",
            "title": "Finalize figures, tables, and artifacts",
            "description": "Prepare visuals and reproducibility artifacts required for submission.",
            "taskType": "writing",
            "recommended_skills": ["ml-paper-writing", "inno-figure-gen"]
          }
        ],
        "recommended_skills": ["ml-paper-writing", "inno-reference-audit", "inno-rclone-to-overleaf"]
      },
      "promotion": {
        "required_elements": [
          "sections.promotion.slide_outline"
        ],
        "optional_elements": [
          "sections.promotion.deck_style",
          "sections.promotion.tts_config",
          "sections.promotion.video_assembly_plan",
          "sections.promotion.homepage_plan"
        ],
        "quality_gate": [
          "Slide outline and homepage plan cover key paper contributions",
          "Deck style is defined for visual consistency"
        ],
        "task_blueprints": [
          {
            "id": "promotion_draft_outline",
            "title": "Draft slide outline and narration scripts",
            "description": "Create per-slide content plan with talking points based on paper contributions.",
            "taskType": "scripting",
            "recommended_skills": ["making-academic-presentations"]
          },
          {
            "id": "promotion_prepare_homepage",
            "title": "Prepare research homepage content and assets",
            "description": "Organize homepage sections, key visuals, and links for project promotion.",
            "taskType": "delivery",
            "recommended_skills": ["making-academic-presentations"]
          },
          {
            "id": "promotion_generate_slides",
            "title": "Generate slide images from outline and paper figures",
            "description": "Render slide visuals while preserving paper-figure quality where possible.",
            "taskType": "rendering",
            "recommended_skills": ["making-academic-presentations"]
          },
          {
            "id": "promotion_generate_narration",
            "title": "Generate TTS audio for slide narration",
            "description": "Generate one audio track per slide and prepare inputs for demo-video assembly.",
            "taskType": "narration",
            "recommended_skills": ["making-academic-presentations"]
          }
        ],
        "recommended_skills": ["making-academic-presentations"]
      }
    }
  }
}
```
