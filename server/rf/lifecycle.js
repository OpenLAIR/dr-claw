// Default ResearchFlow lifecycle: 10 stages with gates, weights aligned to
// PRODUCT_SPEC §5 (gates) and §14.1 (weights: sum = 100).
//
// Stage/gate labels are stored in English as stable identifiers; the UI layer
// localizes them via i18n keys (PRODUCT_SPEC §22 — zh-CN default, English kept).

export const DEFAULT_LIFECYCLE = [
  {
    key: 'idea_locked',
    name: 'Idea Locked',
    weight: 7,
    gates: [
      'Research question defined',
      'Motivation defined',
      'Novelty hypothesis recorded',
      'At least one testable hypothesis',
      'Literature scope for next stage defined',
    ],
  },
  {
    key: 'literature_gap',
    name: 'Literature & Gap',
    weight: 10,
    gates: [
      'Core related work recorded',
      'Baseline list formed',
      'Research gap supported by evidence',
      'Idea not already published checked',
      'Related work matrix supports paper writing',
    ],
  },
  {
    key: 'research_design',
    name: 'Research Design',
    weight: 10,
    gates: [
      'Main hypothesis is experimentally testable',
      'Main baselines defined',
      'Primary metrics defined',
      'Main experiment matrix created',
      'Ablation plan created',
      'Prototype success criteria defined',
    ],
  },
  {
    key: 'prototype',
    name: 'Prototype',
    weight: 10,
    gates: [
      'Minimal implementation runs',
      'At least one key experiment completed successfully',
      'No fatal methodological blocker',
      'Continue / Pivot / Stop decision recorded',
    ],
  },
  {
    key: 'main_experiments',
    name: 'Main Experiments',
    weight: 20,
    gates: [
      'Core baseline comparison completed',
      'Required seeds completed',
      'Main metrics completed',
      'Results support at least one core claim',
      'Major abnormal runs investigated',
    ],
  },
  {
    key: 'validation',
    name: 'Validation',
    weight: 15,
    gates: [
      'Core ablation completed',
      'Robustness / sensitivity meets project requirements',
      'Failure cases recorded',
      'Claim-evidence matrix has no critical missing evidence',
      'Key results rechecked',
    ],
  },
  {
    key: 'results_frozen',
    name: 'Results Frozen',
    weight: 5,
    gates: [
      'Main table frozen',
      'Main figures frozen',
      'Core claims frozen',
      'All cited results traceable to experiment runs',
      'New experiments explicitly marked post-freeze',
    ],
  },
  {
    key: 'manuscript',
    name: 'Manuscript',
    weight: 15,
    gates: [
      'All required sections at least at draft',
      'All core claims have evidence in text',
      'Figure / table references complete',
      'References complete',
      'Paper compiles',
    ],
  },
  {
    key: 'internal_review',
    name: 'Internal Review',
    weight: 5,
    gates: [
      'At least one full internal review round',
      'Major comments addressed',
      'Reproducibility checklist completed',
      'Anonymous / formatting check passed',
      'Reviewer-risk checklist completed',
    ],
  },
  {
    key: 'submission',
    name: 'Submission',
    weight: 3,
    gates: [
      'PDF compiles',
      'Page limit met',
      'Anonymous requirements met',
      'References complete for portal',
      'Figure readability verified',
      'Main results reported',
      'Required ablations reported',
      'Statistical reporting done',
      'Frozen result snapshot included',
      'Supplementary ready',
      'Code snapshot ready (if required)',
      'Config snapshot ready',
      'Seeds / reproducibility record ready',
      'Portal title ready',
      'Portal abstract ready',
      'Portal authors ready',
      'Conflicts / topics ready',
      'Portal metadata ready',
    ],
  },
];

/** Total weight of the default lifecycle (must equal 100 per PRODUCT_SPEC §14.1). */
export const DEFAULT_LIFECYCLE_TOTAL_WEIGHT = DEFAULT_LIFECYCLE.reduce(
  (sum, stage) => sum + stage.weight,
  0
);
