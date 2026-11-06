import { AlertCircle, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { countEnabled, type SkillBaseline, type SkillDefaultState, type SkillDefaultsResponse } from './skillDefaultsModel';

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

const badgeClass = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4';

type BadgeProps = {
  state: SkillDefaultState | undefined;
  scope: 'global' | 'project';
  imported?: boolean;
};

export function SkillDefaultBadges({ state, scope, imported }: BadgeProps) {
  const { t } = useTranslation();
  return (
    <>
      {state?.core && (
        <span className={`${badgeClass} border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200`}>
          {t('common:skillDefaults.badgeCore')}
        </span>
      )}
      {imported && (
        <span className={`${badgeClass} border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200`}>
          {t('common:skillDefaults.badgeImported')}
        </span>
      )}
      {state?.isNew && (
        <span className={`${badgeClass} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200`}>
          {t('common:skillDefaults.badgeNew')}
        </span>
      )}
      {scope === 'project' && state?.source === 'project' && (
        <span className={`${badgeClass} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200`}>
          {t('common:skillDefaults.badgeProject')}
        </span>
      )}
      {scope === 'global' && state?.source === 'global' && (
        <span className={`${badgeClass} border-border bg-muted/50 text-muted-foreground`}>
          {t('common:skillDefaults.badgeGlobal')}
        </span>
      )}
    </>
  );
}

type SummaryProps = {
  data: SkillDefaultsResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  projectLabel: string | null;
  onBaselineChange: (baseline: SkillBaseline) => void;
  onResetProject: () => void;
  onAcknowledgeNew: () => void;
};

const BASELINES: SkillBaseline[] = ['recommended', 'all', 'none'];

/** One-sentence summary of what is on, with the preset picker (global) or reset (project). */
export function SkillDefaultsSummary({
  data,
  loading,
  saving,
  error,
  projectLabel,
  onBaselineChange,
  onResetProject,
  onAcknowledgeNew,
}: SummaryProps) {
  const { t } = useTranslation();
  const enabled = data ? countEnabled(data.skills) : 0;
  const globalOverrideCount = data ? Object.keys(data.globalOverrides).length : 0;
  const projectOverrideCount = data?.project ? Object.keys(data.project.overrides).length : 0;
  const newSkills = data?.newSkills ?? [];
  const isProject = Boolean(projectLabel);

  const pickBaseline = (value: SkillBaseline) => {
    if (!data) return;
    if (value === data.baseline && globalOverrideCount === 0) return;
    if (globalOverrideCount > 0 && !window.confirm(t('common:skillDefaults.confirmPreset', { count: globalOverrideCount }))) return;
    onBaselineChange(value);
  };

  return (
    <section className="mb-4 rounded-xl border border-border/80 bg-card/95 px-5 py-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            {data
              ? (isProject
                ? t('common:skillDefaults.summaryProject', { count: enabled, name: projectLabel })
                : t('common:skillDefaults.summaryGlobal', { count: enabled }))
              : t('common:skillDefaults.scopeLabel')}
            {(loading || saving) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isProject
              ? (projectOverrideCount > 0
                ? t('common:skillDefaults.projectInherits', { count: projectOverrideCount })
                : t('common:skillDefaults.projectInheritsAll'))
              : t('common:skillDefaults.summaryGlobalHint')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('common:skillDefaults.explain')}</p>
        </div>

        {!isProject && data && (
          <div className="flex flex-col items-end gap-1.5">
            <div role="radiogroup" aria-label={t('common:skillDefaults.presetLabel')} className="inline-flex rounded-lg border border-border bg-background p-0.5">
              {BASELINES.filter((value) => !data.baselines || data.baselines.includes(value)).map((value) => {
                const active = data.baseline === value && globalOverrideCount === 0;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={saving}
                    title={t(`common:skillDefaults.baselineHint_${value}`)}
                    onClick={() => pickBaseline(value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                      active
                        ? 'bg-sky-600 text-white dark:bg-sky-500'
                        : data.baseline === value
                          ? 'text-sky-700 ring-1 ring-inset ring-sky-300 dark:text-sky-300 dark:ring-sky-800'
                          : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {t(`common:skillDefaults.baseline_${value}`)}
                  </button>
                );
              })}
            </div>
            {globalOverrideCount > 0 && (
              <span className="text-xs text-muted-foreground">{t('common:skillDefaults.customized', { count: globalOverrideCount })}</span>
            )}
          </div>
        )}

        {isProject && projectOverrideCount > 0 && (
          <button
            type="button"
            onClick={onResetProject}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            <RotateCcw className="h-4 w-4" />
            {t('common:skillDefaults.resetProject')}
          </button>
        )}
      </div>

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
