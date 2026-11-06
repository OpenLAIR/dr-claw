import { describe, expect, it } from 'vitest';
import { groupSkillsForCards, isGroupExpanded } from '../skillCardGroups';
import { buildBulkChanges, type SkillDefaultState } from '../skillDefaultsModel';

const skill = (name: string, primaryIntentKey: string, isBundled = true) => ({ name, primaryIntentKey, isBundled });
const state = (name: string, enabled: boolean, extra: Partial<SkillDefaultState> = {}): SkillDefaultState => ({
  name, enabled, source: 'baseline', globalEnabled: enabled, baselineEnabled: enabled, core: false, recommended: false, isNew: false, ...extra,
});

describe('groupSkillsForCards', () => {
  it('puts core first, then imports, then intents in a fixed order, and drops empty groups', () => {
    const skills = [
      skill('vllm', 'deployment'),
      skill('mine', 'writing', false),
      skill('planner', 'ideation'),
      skill('finder', 'research'),
      skill('odd', 'unknown-intent'),
    ];
    const states = new Map([
      ['planner', state('planner', true, { core: true })],
      ['finder', state('finder', true)],
      ['vllm', state('vllm', false)],
      ['mine', state('mine', true)],
      ['odd', state('odd', false)],
    ]);
    const groups = groupSkillsForCards(skills, states);
    expect(groups.map((g) => g.key)).toEqual(['core', 'imported', 'intent:research', 'intent:deployment', 'other']);
    expect(groups.map((g) => g.enabledCount)).toEqual([1, 1, 1, 0, 0]);
  });
});

describe('isGroupExpanded', () => {
  const group = (enabledCount: number) => ({ key: 'other' as const, skills: [], enabledCount });
  it('opens groups with something on, or while searching; the user choice wins', () => {
    expect(isGroupExpanded(group(0), undefined, false)).toBe(false);
    expect(isGroupExpanded(group(2), undefined, false)).toBe(true);
    expect(isGroupExpanded(group(0), undefined, true)).toBe(true);
    expect(isGroupExpanded(group(2), false, true)).toBe(false);
  });
});

describe('buildBulkChanges', () => {
  it('only sends skills whose state changes, as overrides or inherit (null)', () => {
    const states = [
      state('a', true),
      state('b', false),
      state('c', false, { globalEnabled: true, source: 'project' }),
    ];
    expect(buildBulkChanges(states, true, 'project')).toEqual({ b: true, c: null });
    expect(buildBulkChanges(states, false, 'global')).toEqual({ a: false });
  });
});
