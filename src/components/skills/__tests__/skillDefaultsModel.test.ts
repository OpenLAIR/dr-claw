import { describe, expect, it } from 'vitest';
import {
  applyLocalToggle,
  buildToggleChange,
  countEnabled,
  type SkillDefaultState,
  type SkillDefaultsResponse,
} from '../skillDefaultsModel';

function state(overrides: Partial<SkillDefaultState> = {}): SkillDefaultState {
  return {
    name: 'paper-analyzer',
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
    const next = applyLocalToggle(data, 'paper-analyzer', true, 'global');
    expect(next.skills[0]).toMatchObject({ enabled: true, globalEnabled: true, source: 'global' });
    expect(next.skills[1]).toBe(data.skills[1]);
    expect(countEnabled(next.skills)).toBe(2);
  });

  it('marks a project override in project scope', () => {
    const data = response([state({ globalEnabled: true, enabled: true })]);
    expect(applyLocalToggle(data, 'paper-analyzer', false, 'project').skills[0]).toMatchObject({ enabled: false, source: 'project', globalEnabled: true });
  });
});
