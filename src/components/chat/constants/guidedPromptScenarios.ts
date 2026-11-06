export interface GuidedPromptScenario {
  id: string;
  icon: string;
  titleKey: string;
  descriptionKey: string;
  skills: string[];
  /** If set, clicking this scenario injects a slash command instead of a skill template */
  slashCommand?: string;
  /** Visual grouping — scenarios with the same group render under a dropdown */
  group?: string;
}

export const GUIDED_PROMPT_SCENARIOS: GuidedPromptScenario[] = [
  {
    id: 'start-full-project',
    icon: '🚀',
    titleKey: 'guidedStarter.scenarios.startFullProject.title',
    descriptionKey: 'guidedStarter.scenarios.startFullProject.description',
    skills: ['inno-pipeline-planner', 'academic-researcher', 'inno-idea-generation'],
  },
  {
    id: 'paper-reproduction',
    icon: '📄',
    titleKey: 'guidedStarter.scenarios.paperReproduction.title',
    descriptionKey: 'guidedStarter.scenarios.paperReproduction.description',
    skills: ['inno-deep-research', 'gemini-deep-research', 'academic-researcher', 'inno-paper-reviewer'],
  },
  {
    id: 'literature-survey',
    icon: '🔎',
    titleKey: 'guidedStarter.scenarios.literatureSurvey.title',
    descriptionKey: 'guidedStarter.scenarios.literatureSurvey.description',
    skills: ['inno-deep-research', 'gemini-deep-research', 'dataset-discovery', 'inno-code-survey'],
  },
  {
    id: 'research-idea',
    icon: '💡',
    titleKey: 'guidedStarter.scenarios.researchIdea.title',
    descriptionKey: 'guidedStarter.scenarios.researchIdea.description',
    skills: ['inno-idea-generation', 'inno-idea-eval', 'academic-researcher'],
  },
  {
    id: 'experiment-plan',
    icon: '🧪',
    titleKey: 'guidedStarter.scenarios.experimentPlan.title',
    descriptionKey: 'guidedStarter.scenarios.experimentPlan.description',
    skills: ['inno-experiment-dev', 'inno-experiment-analysis', 'inno-prepare-resources'],
  },
  {
    id: 'paper-writing',
    icon: '✍️',
    titleKey: 'guidedStarter.scenarios.paperWriting.title',
    descriptionKey: 'guidedStarter.scenarios.paperWriting.description',
    skills: ['ml-paper-writing', 'scientific-writing', 'inno-humanizer'],
  },
  {
    id: 'manuscript-review',
    icon: '🧾',
    titleKey: 'guidedStarter.scenarios.manuscriptReview.title',
    descriptionKey: 'guidedStarter.scenarios.manuscriptReview.description',
    skills: ['inno-paper-reviewer', 'inno-reference-audit', 'inno-humanizer'],
  },
  {
    id: 'rebuttal-response',
    icon: '💬',
    titleKey: 'guidedStarter.scenarios.rebuttalResponse.title',
    descriptionKey: 'guidedStarter.scenarios.rebuttalResponse.description',
    skills: ['inno-rebuttal'],
  },
  {
    id: 'presentation-promotion',
    icon: '🎬',
    titleKey: 'guidedStarter.scenarios.presentationPromotion.title',
    descriptionKey: 'guidedStarter.scenarios.presentationPromotion.description',
    skills: ['making-academic-presentations'],
  },
  {
    id: 'grant-proposal',
    icon: '📝',
    titleKey: 'guidedStarter.scenarios.grantProposal.title',
    descriptionKey: 'guidedStarter.scenarios.grantProposal.description',
    skills: ['inno-grant-proposal'],
  },
];

export const AUTO_RESEARCH_SCENARIOS: GuidedPromptScenario[] = [
  {
    id: 'aris-full-pipeline',
    icon: '🔬',
    titleKey: 'guidedStarter.scenarios.arisFullPipeline.title',
    descriptionKey: 'guidedStarter.scenarios.arisFullPipeline.description',
    skills: ['aris-research-pipeline'],
    slashCommand: '/aris-research-pipeline',
    group: 'auto-research',
  },
  {
    id: 'aris-idea-discovery',
    icon: '💡',
    titleKey: 'guidedStarter.scenarios.arisIdeaDiscovery.title',
    descriptionKey: 'guidedStarter.scenarios.arisIdeaDiscovery.description',
    skills: ['aris-idea-discovery'],
    slashCommand: '/aris-idea-discovery',
    group: 'auto-research',
  },
  {
    id: 'aris-auto-review',
    icon: '🔄',
    titleKey: 'guidedStarter.scenarios.arisAutoReview.title',
    descriptionKey: 'guidedStarter.scenarios.arisAutoReview.description',
    skills: ['aris-auto-review-loop'],
    slashCommand: '/aris-auto-review-loop',
    group: 'auto-research',
  },
  {
    id: 'aris-paper-writing',
    icon: '📑',
    titleKey: 'guidedStarter.scenarios.arisPaperWriting.title',
    descriptionKey: 'guidedStarter.scenarios.arisPaperWriting.description',
    skills: ['aris-paper-writing'],
    slashCommand: '/aris-paper-writing',
    group: 'auto-research',
  },
  {
    id: 'autoresearch-loop',
    icon: '🔁',
    titleKey: 'guidedStarter.scenarios.autoresearchLoop.title',
    descriptionKey: 'guidedStarter.scenarios.autoresearchLoop.description',
    skills: ['autoresearch'],
    slashCommand: '/autoresearch',
    group: 'auto-research',
  },
];
