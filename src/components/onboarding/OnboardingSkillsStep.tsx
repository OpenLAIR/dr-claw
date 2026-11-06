import { Check, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SKILL_BASELINES, type SkillBaseline } from '../skills/skillDefaultsModel';

export type OnboardingSkillsStepProps = {
  /** Skills each starting set enables; null while loading or when loading failed. */
  counts: Record<SkillBaseline, number> | null;
  loading: boolean;
  loadFailed: boolean;
  selected: SkillBaseline;
  onSelect: (baseline: SkillBaseline) => void;
  disabled?: boolean;
};

export default function OnboardingSkillsStep({ counts, loading, loadFailed, selected, onSelect, disabled = false }: OnboardingSkillsStepProps) {
  const { t } = useTranslation('common');

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">{t('skillDefaults.onboardingTitle')}</h2>
        <p className="text-muted-foreground">{t('skillDefaults.onboardingDescription')}</p>
      </div>

      <div role="radiogroup" aria-label={t('skillDefaults.onboardingTitle')} className="space-y-3">
        {SKILL_BASELINES.map((baseline) => {
          const isSelected = selected === baseline;
          return (
            <button
              key={baseline}
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-baseline={baseline}
              disabled={disabled}
              onClick={() => onSelect(baseline)}
              className={`w-full flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'
                }`}
              >
                {isSelected && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="font-medium text-foreground">{t(`skillDefaults.baseline_${baseline}`)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={t('onboarding.checking')} />
                    ) : counts ? (
                      t('skillDefaults.onboardingCount', { count: counts[baseline] })
                    ) : null}
                  </span>
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{t(`skillDefaults.onboardingHint_${baseline}`)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {loadFailed && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          {t('skillDefaults.loadFailed')}
        </div>
      )}

      <p className="text-center text-sm text-muted-foreground">{t('skillDefaults.onboardingLater')}</p>
    </div>
  );
}
