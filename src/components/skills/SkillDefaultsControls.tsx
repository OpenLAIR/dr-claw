import { AlertCircle, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { countEnabled, isSkillBaseline, type SkillBaseline, type SkillDefaultState, type SkillDefaultsResponse } from './skillDefaultsModel';

type SwitchProps = {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
};

export function SkillEnableSwitch({ checked, label, disabled, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-sky-600 bg-sky-600 dark:border-sky-500 dark:bg-sky-500' : 'border-border bg-muted'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
      />
    </button>
  );
}

type BadgeProps = { state: SkillDefaultState | undefined; scope: 'global' | 'project' };

export function SkillDefaultBadges({ state, scope }: BadgeProps) {
  const { t } = useTranslation();
  if (!state) return null;
  const badgeClass = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium';
  return (
    <>
      {state.isNew && (
        <span className={`${badgeClass} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200`}>
          {t('common:skillDefaults.badgeNew')}
        </span>
      )}
      {scope === 'project' && state.source === 'project' && (
        <span className={`${badgeClass} border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200`}>
          {t('common:skillDefaults.badgeProject')}
        </span>
      )}
      {scope === 'global' && state.source === 'global' && (
        <span className={`${badgeClass} border-border bg-muted/50 text-muted-foreground`}>
          {t('common:skillDefaults.badgeGlobal')}
        </span>
      )}
    </>
  );
}

type ProjectOption = { name: string; displayName?: string | null };

type BarProps = {
  data: SkillDefaultsResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  projectName: string | null;
  projects: ProjectOption[];
  onlyEnabled: boolean;
  onScopeChange: (projectName: string | null) => void;
  onBaselineChange: (baseline: SkillBaseline) => void;
  onResetProject: () => void;
  onAcknowledgeNew: () => void;
  onOnlyEnabledChange: (value: boolean) => void;
};

const BASELINES: SkillBaseline[] = ['recommended', 'all', 'none'];

export function SkillDefaultsBar({
  data,
  loading,
  saving,
  error,
  projectName,
  projects,
  onlyEnabled,
  onScopeChange,
  onBaselineChange,
  onResetProject,
  onAcknowledgeNew,
  onOnlyEnabledChange,
}: BarProps) {
  const { t } = useTranslation();
  const total = data?.skills.length ?? 0;
  const enabled = data ? countEnabled(data.skills) : 0;
  const projectOverrideCount = data?.project ? Object.keys(data.project.overrides).length : 0;
  const newSkills = data?.newSkills ?? [];

  return (
    <section
      aria-label={t('common:skillDefaults.scopeLabel')}
      className="mb-5 rounded-lg border border-border/80 bg-card/95 p-4"
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-xs font-medium text-muted-foreground sm:max-w-sm">
          {t('common:skillDefaults.scopeLabel')}
          <select
            value={projectName ?? ''}
            onChange={(event) => onScopeChange(event.target.value || null)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">{t('common:skillDefaults.scopeGlobal')}</option>
            {projects.map((project) => (
              <option key={project.name} value={project.name}>
                {t('common:skillDefaults.scopeProject', { name: project.displayName || project.name })}
              </option>
            ))}
          </select>
        </label>

        {!projectName && data && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground" id="skill-baseline-label">
              {t('common:skillDefaults.baselineLabel')}
            </span>
            <div role="radiogroup" aria-labelledby="skill-baseline-label" className="inline-flex rounded-lg border border-border bg-background p-0.5">
              {BASELINES.filter((value) => !data.baselines || data.baselines.includes(value)).map((value) => {
                const active = data.baseline === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={saving}
                    title={t(`common:skillDefaults.baselineHint_${value}`)}
                    onClick={() => { if (!active && isSkillBaseline(value)) onBaselineChange(value); }}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                      active ? 'bg-sky-600 text-white dark:bg-sky-500' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {t(`common:skillDefaults.baseline_${value}`)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {projectName && data?.project && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {projectOverrideCount > 0
                ? t('common:skillDefaults.projectInherits', { count: projectOverrideCount })
                : t('common:skillDefaults.projectInheritsAll')}
            </span>
            {projectOverrideCount > 0 && (
              <button
                type="button"
                onClick={onResetProject}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('common:skillDefaults.resetProject')}
              </button>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {(loading || saving) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
          {data && (
            <span className="text-sm tabular-nums text-muted-foreground">
              {t('common:skillDefaults.enabledCount', { enabled, total })}
            </span>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={onlyEnabled}
              onChange={(event) => onOnlyEnabledChange(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-sky-600"
            />
            {t('common:skillDefaults.onlyEnabled')}
          </label>
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted-foreground">{t('common:skillDefaults.explain')}</p>

      {error && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {data ? t('common:skillDefaults.saveFailed') : t('common:skillDefaults.loadFailed')} ({error})
        </p>
      )}

      {newSkills.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{t('common:skillDefaults.newSkillsTitle', { count: newSkills.length })}</span>
            {': '}
            <span className="break-words">{newSkills.slice(0, 8).join(', ')}{newSkills.length > 8 ? ' …' : ''}</span>
          </span>
          <button
            type="button"
            onClick={onAcknowledgeNew}
            disabled={saving}
            className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:hover:bg-amber-900/40"
          >
            {t('common:skillDefaults.newSkillsDismiss')}
          </button>
        </div>
      )}
    </section>
  );
}
