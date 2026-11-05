import { describe, expect, it } from 'vitest';
import {
  applyLocalToggle,
  baselineToSave,
  buildToggleChange,
  countBaselineSkills,
  countEnabled,
  type SkillDefaultState,
  type SkillDefaultsResponse,
} from '../skillDefaultsModel';

function state(overrides: Partial<SkillDefaultState> = {}): SkillDefaultState {
  return {
    name: 'paper-finder',
    enabled: false,
    source: 'baseline',
    globalEnabled: false,
    baselineEnabled: false,
    core: false,
    recommended: false,
    isNew: false,
    ...overrides,
  };
}

function response(skills: SkillDefaultState[]): SkillDefaultsResponse {
  return { baselines: ['recommended', 'all', 'none'], baseline: 'recommended', globalOverrides: {}, project: null, skills, newSkills: [] };
}

describe('buildToggleChange', () => {
  it('stores a global override only when it differs from the baseline', () => {
    expect(buildToggleChange(state(), true, 'global')).toBe(true);
    expect(buildToggleChange(state({ enabled: true, globalEnabled: true, source: 'global' }), false, 'global')).toBeNull();
  });

  it('stores a project override only when it differs from the global defaults', () => {
    expect(buildToggleChange(state({ globalEnabled: true, enabled: true }), false, 'project')).toBe(false);
    expect(buildToggleChange(state({ globalEnabled: true, enabled: false, source: 'project' }), true, 'project')).toBeNull();
  });
});

describe('applyLocalToggle', () => {
  it('updates only the toggled skill', () => {
    const data = response([state(), state({ name: 'other', enabled: true })]);
    const next = applyLocalToggle(data, 'paper-finder', true, 'global');
    expect(next.skills[0]).toMatchObject({ enabled: true, globalEnabled: true, source: 'global' });
    expect(next.skills[1]).toBe(data.skills[1]);
    expect(countEnabled(next.skills)).toBe(2);
  });

  it('marks a project override in project scope', () => {
    const data = response([state({ globalEnabled: true, enabled: true })]);
    expect(applyLocalToggle(data, 'paper-finder', false, 'project').skills[0]).toMatchObject({ enabled: false, source: 'project', globalEnabled: true });
  });
});

describe('countBaselineSkills', () => {
  it('counts core and recommended skills for the recommended set', () => {
    const skills = [
      state({ name: 'a', core: true }),
      state({ name: 'b', recommended: true }),
      state({ name: 'c', core: true, recommended: true }),
      state({ name: 'd' }),
    ];
    expect(countBaselineSkills(skills)).toEqual({ recommended: 3, all: 4, none: 0 });
  });

  it('ignores the current enabled state and overrides', () => {
    const skills = [state({ name: 'a', enabled: true, source: 'global' }), state({ name: 'b', core: true, enabled: false })];
    expect(countBaselineSkills(skills)).toEqual({ recommended: 1, all: 2, none: 0 });
  });
});

describe('baselineToSave', () => {
  it('writes nothing when the user did not choose', () => {
    expect(baselineToSave('recommended', 'all', false)).toBeNull();
    expect(baselineToSave('recommended', null, false)).toBeNull();
  });

  it('writes nothing when the choice equals the stored value', () => {
    expect(baselineToSave('all', 'all', true)).toBeNull();
  });

  it('writes an explicit change', () => {
    expect(baselineToSave('none', 'recommended', true)).toBe('none');
    expect(baselineToSave('recommended', 'all', true)).toBe('recommended');
    expect(baselineToSave('all', null, true)).toBe('all');
  });
});
