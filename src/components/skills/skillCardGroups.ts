// Groups for the Skills Library card grid: core pipeline skills first, then
// the user's own imports, then the catalog's primary intents.

export const INTENT_GROUP_ORDER = [
  'research',
  'ideation',
  'experiment',
  'training',
  'evaluation',
  'deployment',
  'writing',
  'data',
] as const;

export type CardGroupKey = 'core' | 'imported' | 'other' | `intent:${string}`;

export type CardGroupSkill = {
  name: string;
  primaryIntentKey: string;
  isBundled: boolean;
};

export type SkillCardGroup<T> = {
  key: CardGroupKey;
  skills: T[];
  enabledCount: number;
};

type StateLike = { enabled: boolean; core: boolean };

export function groupKeyFor(skill: CardGroupSkill, state: StateLike | undefined): CardGroupKey {
  if (state?.core) return 'core';
  if (!skill.isBundled) return 'imported';
  if ((INTENT_GROUP_ORDER as readonly string[]).includes(skill.primaryIntentKey)) {
    return `intent:${skill.primaryIntentKey}`;
  }
  return 'other';
}

export function groupSkillsForCards<T extends CardGroupSkill>(
  skills: T[],
  statesByName: Map<string, StateLike>,
): SkillCardGroup<T>[] {
  const order: CardGroupKey[] = ['core', 'imported', ...INTENT_GROUP_ORDER.map((key) => `intent:${key}` as const), 'other'];
  const buckets = new Map<CardGroupKey, T[]>(order.map((key) => [key, []]));
  for (const skill of skills) {
    buckets.get(groupKeyFor(skill, statesByName.get(skill.name)))!.push(skill);
  }
  return order
    .map((key) => {
      const members = buckets.get(key)!;
      return {
        key,
        skills: members,
        enabledCount: members.filter((skill) => statesByName.get(skill.name)?.enabled).length,
      };
    })
    .filter((group) => group.skills.length > 0);
}

/**
 * A group starts expanded when it has an enabled skill or a search is active;
 * the user's own expand/collapse choice wins.
 */
export function isGroupExpanded(
  group: SkillCardGroup<unknown>,
  userChoice: boolean | undefined,
  searching: boolean,
): boolean {
  if (userChoice !== undefined) return userChoice;
  return searching || group.enabledCount > 0;
}
