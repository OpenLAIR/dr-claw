import { useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  Download,
  FlaskConical,
  Layers,
  Lightbulb,
  PenLine,
  Rocket,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SkillDefaultBadges, SkillEnableSwitch } from './SkillDefaultsControls';
import { groupSkillsForCards, isGroupExpanded, type CardGroupKey, type CardGroupSkill } from './skillCardGroups';
import type { SkillDefaultState, SkillDefaultsScope } from './skillDefaultsModel';

export type CardSkill = CardGroupSkill & {
  dirPath: string;
  displayName: string;
  displaySummary: string;
};

const GROUP_ICONS: Record<string, LucideIcon> = {
  core: Workflow,
  imported: Download,
  'intent:research': BookOpen,
  'intent:ideation': Lightbulb,
  'intent:experiment': FlaskConical,
  'intent:training': Cpu,
  'intent:evaluation': BarChart3,
  'intent:deployment': Rocket,
  'intent:writing': PenLine,
  'intent:data': Database,
  other: Layers,
};

const GROUP_ICON_TONES: Record<string, string> = {
  core: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  imported: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
};

type Props<T extends CardSkill> = {
  skills: T[];
  statesByName: Map<string, SkillDefaultState>;
  scope: SkillDefaultsScope;
  groupLabel: (key: CardGroupKey) => string;
  searching: boolean;
  disabled: boolean;
  focusedDirPath: string | null;
  onToggle: (name: string, next: boolean) => void;
  onToggleGroup: (names: string[], next: boolean) => void;
  onOpen: (skill: T) => void;
};

export default function SkillCardGrid<T extends CardSkill>({
  skills,
  statesByName,
  scope,
  groupLabel,
  searching,
  disabled,
  focusedDirPath,
  onToggle,
  onToggleGroup,
  onOpen,
}: Props<T>) {
  const { t } = useTranslation();
  const [expandedChoice, setExpandedChoice] = useState<Partial<Record<CardGroupKey, boolean>>>({});
  const groups = useMemo(() => groupSkillsForCards(skills, statesByName), [skills, statesByName]);

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const label = groupLabel(group.key);
        const total = group.skills.length;
        const expanded = isGroupExpanded(group, expandedChoice[group.key], searching);
        const allOn = group.enabledCount === total;
        const someOn = group.enabledCount > 0 && !allOn;
        const Icon = GROUP_ICONS[group.key] ?? Layers;
        const headingId = `skill-group-${group.key.replace(/[^a-z0-9-]/gi, '-')}`;
        const names = group.skills.map((skill) => skill.name).filter((name) => statesByName.has(name));

        return (
          <section key={group.key} aria-labelledby={headingId}>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setExpandedChoice((prev) => ({ ...prev, [group.key]: !expanded }))}
                aria-expanded={expanded}
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left"
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${GROUP_ICON_TONES[group.key] ?? 'bg-muted text-muted-foreground'}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span id={headingId} className="truncate text-base font-semibold text-foreground">{label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t('common:skillDefaults.groupCount', { enabled: group.enabledCount, total })}
                </span>
                {expanded
                  ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </button>
              {names.length > 0 && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={allOn ? 'true' : someOn ? 'mixed' : 'false'}
                  aria-label={t(allOn ? 'common:skillDefaults.groupToggleOff' : 'common:skillDefaults.groupToggleOn', { group: label })}
                  title={t(allOn ? 'common:skillDefaults.groupToggleOff' : 'common:skillDefaults.groupToggleOn', { group: label })}
                  disabled={disabled}
                  onClick={() => onToggleGroup(names, !allOn)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                    allOn
                      ? 'border-sky-600 bg-sky-600 dark:border-sky-500 dark:bg-sky-500'
                      : someOn
                        ? 'border-sky-300 bg-sky-200 dark:border-sky-800 dark:bg-sky-900'
                        : 'border-border bg-muted'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                      allOn ? 'translate-x-[18px]' : someOn ? 'translate-x-[10px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              )}
            </div>

            {expanded ? (
              <ul className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
                {group.skills.map((skill) => {
                  const state = statesByName.get(skill.name);
                  const on = Boolean(state?.enabled);
                  const focused = focusedDirPath === skill.dirPath;
                  return (
                    <li
                      key={skill.dirPath}
                      className={`relative flex min-h-[132px] flex-col gap-2 rounded-xl border p-4 transition-colors ${
                        on
                          ? 'border-sky-300 bg-card hover:border-sky-400 dark:border-sky-800 dark:hover:border-sky-700'
                          : 'border-border/80 bg-muted/30 hover:border-border'
                      } ${focused ? 'ring-2 ring-sky-400/60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => onOpen(skill)}
                          aria-label={t('common:skillDefaults.openDetails', { name: skill.displayName })}
                          className={`min-w-0 text-left text-sm font-semibold leading-5 after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-sky-500 ${
                            on ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          <span className="break-words">{skill.displayName}</span>
                        </button>
                        {state && (
                          <span className="relative z-10">
                            <SkillEnableSwitch
                              checked={on}
                              label={t(on ? 'common:skillDefaults.toggleOff' : 'common:skillDefaults.toggleOn', { name: skill.displayName })}
                              disabled={disabled}
                              onChange={(next) => onToggle(skill.name, next)}
                            />
                          </span>
                        )}
                      </div>
                      <p
                        className="flex-1 text-xs leading-5 text-muted-foreground"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {skill.displaySummary}
                      </p>
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <SkillDefaultBadges state={state} scope={scope} imported={!skill.isBundled} />
                        {skill.displayName !== skill.name && (
                          <code className="min-w-0 truncate text-[11px] text-muted-foreground/80">{skill.name}</code>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <button
                type="button"
                onClick={() => setExpandedChoice((prev) => ({ ...prev, [group.key]: true }))}
                className="ml-11 mt-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {t('common:skillDefaults.expandGroup', { count: total })}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
