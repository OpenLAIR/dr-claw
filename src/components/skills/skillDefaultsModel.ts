// Client-side model for the skill defaults API (server/utils/skillDefaults.js).

export type SkillBaseline = 'recommended' | 'all' | 'none';

export type SkillDefaultSource = 'project' | 'global' | 'baseline';

export type SkillDefaultState = {
  name: string;
  enabled: boolean;
  source: SkillDefaultSource;
  /** Value a project inherits from the global defaults. */
  globalEnabled: boolean;
  /** Value the global defaults have from the baseline alone. */
  baselineEnabled: boolean;
  core: boolean;
  recommended: boolean;
  isNew: boolean;
};

export type SkillDefaultsResponse = {
  baselines: SkillBaseline[];
  baseline: SkillBaseline;
  globalOverrides: Record<string, boolean>;
  project: { name: string; displayName: string | null; overrides: Record<string, boolean> } | null;
  skills: SkillDefaultState[];
  newSkills: string[];
};

export type SkillDefaultsScope = 'global' | 'project';

/**
 * The override to send when a skill is switched: null when the new value is
 * what the scope would inherit anyway, so no redundant override is stored.
 */
export function buildToggleChange(state: SkillDefaultState, nextEnabled: boolean, scope: SkillDefaultsScope): boolean | null {
  const inherited = scope === 'project' ? state.globalEnabled : state.baselineEnabled;
  return nextEnabled === inherited ? null : nextEnabled;
}

/** Optimistic local update while the change is saved. */
export function applyLocalToggle(
  data: SkillDefaultsResponse,
  name: string,
  nextEnabled: boolean,
  scope: SkillDefaultsScope,
): SkillDefaultsResponse {
  return {
    ...data,
    skills: data.skills.map((state) => {
      if (state.name !== name) return state;
      const change = buildToggleChange(state, nextEnabled, scope);
      if (scope === 'project') {
        return { ...state, enabled: nextEnabled, source: change === null ? (state.source === 'project' ? 'global' : state.source) : 'project' };
      }
      return {
        ...state,
        enabled: nextEnabled,
        globalEnabled: nextEnabled,
        source: change === null ? 'baseline' : 'global',
      };
    }),
  };
}

/** Overrides to send when switching several skills at once (e.g. a whole group). */
export function buildBulkChanges(
  states: SkillDefaultState[],
  nextEnabled: boolean,
  scope: SkillDefaultsScope,
): Record<string, boolean | null> {
  const changes: Record<string, boolean | null> = {};
  for (const state of states) {
    if (state.enabled === nextEnabled) continue;
    changes[state.name] = buildToggleChange(state, nextEnabled, scope);
  }
  return changes;
}

export function countEnabled(skills: SkillDefaultState[]): number {
  return skills.reduce((total, state) => total + (state.enabled ? 1 : 0), 0);
}

export function isSkillBaseline(value: unknown): value is SkillBaseline {
  return value === 'recommended' || value === 'all' || value === 'none';
}

export const SKILL_BASELINES: SkillBaseline[] = ['recommended', 'all', 'none'];

/**
 * How many skills each starting set enables, before any per-skill overrides:
 * 'recommended' is the `recommendedSkills` list in skill-tag-mapping.json,
 * 'none' enables nothing (core skills included).
 */
export function countBaselineSkills(skills: SkillDefaultState[]): Record<SkillBaseline, number> {
  return {
    recommended: skills.reduce((total, state) => total + (state.recommended ? 1 : 0), 0),
    all: skills.length,
    none: 0,
  };
}

/**
 * The starting set to save when the user leaves the onboarding step, or null
 * when nothing should be written. Only an explicit choice that differs from
 * the stored value is saved, so passing through the step never changes an
 * existing setting (e.g. 'all' kept for installs upgraded from older versions).
 */
export function baselineToSave(
  selected: SkillBaseline,
  current: SkillBaseline | null,
  chosenByUser: boolean,
): SkillBaseline | null {
  if (!chosenByUser) return null;
  return selected === current ? null : selected;
}
