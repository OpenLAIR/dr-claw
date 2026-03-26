import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FlaskConical, Sparkles, X } from 'lucide-react';

import { api } from '../../../utils/api';
import { Button } from '../../ui/button';

type AutoResearchProvider = 'claude' | 'codex' | 'gemini';

type Template = {
  id: string;
  name: string;
  description?: string;
  category?: string;
};

type AutoResearchWizardProps = {
  projectName: string;
  provider: AutoResearchProvider;
  model: string;
  providerLabel: string;
  modelLabel: string;
  onClose: () => void;
  onComplete: () => void;
};

export default function AutoResearchWizard({
  projectName,
  provider,
  model,
  providerLabel,
  modelLabel,
  onClose,
  onComplete,
}: AutoResearchWizardProps) {
  const { t } = useTranslation('common');
  const [step, setStep] = useState(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [paperTitle, setPaperTitle] = useState('');
  const [researchGoal, setResearchGoal] = useState('');
  const [targetVenue, setTargetVenue] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.taskmaster.getTemplates();
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        if (!cancelled) {
          const list: Template[] = data.templates || [];
          setTemplates(list);
          if (list.length > 0) setSelectedTemplateId(list[0].id);
        }
      } catch {
        if (!cancelled) setError(t('projectDashboard.autoResearch.errorLoadTemplates'));
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const selectedTemplate = templates.find((tpl) => tpl.id === selectedTemplateId);

  const canProceedStep2 = paperTitle.trim().length > 0 && researchGoal.trim().length > 0;

  const handleLaunch = async () => {
    if (!selectedTemplateId) return;
    setLaunching(true);
    setError(null);

    try {
      // 1. Apply template → creates research brief
      const applyRes = await api.taskmaster.applyTemplate(projectName, {
        templateId: selectedTemplateId,
        fileName: 'research_brief.json',
        customizations: {
          'meta.title': paperTitle.trim(),
          'sections.ideation.research_goal': researchGoal.trim(),
          ...(targetVenue.trim() ? { 'meta.target_venue': targetVenue.trim() } : {}),
        },
      });
      if (!applyRes.ok) {
        const err = await applyRes.json().catch(() => ({}));
        throw new Error(err?.message || t('projectDashboard.autoResearch.errorApplyTemplate'));
      }

      // 2. Parse PRD → generates tasks
      const parseRes = await api.taskmaster.parsePRD(projectName, {
        fileName: 'research_brief.json',
        numTasks: undefined,
        append: false,
      });
      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({}));
        throw new Error(err?.message || t('projectDashboard.autoResearch.errorParsePRD'));
      }

      // 3. Start Auto Research
      const startRes = await api.autoResearch.start(projectName, {
        provider,
        model,
      });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(err?.error || t('projectDashboard.autoResearch.errorStartRun'));
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLaunching(false);
    }
  };

  const stepIndicator = (
    <div className="flex items-center justify-center gap-2">
      {[1, 2, 3].map((s) => (
        <div
          key={s}
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
            s === step
              ? 'bg-primary text-primary-foreground'
              : s < step
                ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          {s}
        </div>
      ))}
    </div>
  );

  const content = (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm md:p-6"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-border/70 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-border/60 bg-gradient-to-r from-slate-50 via-white to-cyan-50 px-5 py-4 dark:from-slate-950 dark:via-slate-900 dark:to-cyan-950/20">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              {t('projectDashboard.autoResearch.wizardTitle')}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={launching}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Step indicator */}
        <div className="border-b border-border/40 px-5 py-3">
          {stepIndicator}
        </div>

        {/* Body */}
        <div className="min-h-[280px] overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Step 1: Template selection */}
          {step === 1 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('projectDashboard.autoResearch.wizardStep1Title')}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('projectDashboard.autoResearch.wizardStep1Subtitle')}
              </p>
              {loadingTemplates ? (
                <div className="mt-4 text-xs text-muted-foreground">Loading templates...</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                        selectedTemplateId === tpl.id
                          ? 'border-primary bg-primary/5 dark:bg-primary/10'
                          : 'border-border/50 bg-background/70 hover:border-border'
                      }`}
                      onClick={() => setSelectedTemplateId(tpl.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{tpl.name}</span>
                        {selectedTemplateId === tpl.id && (
                          <div className="h-2 w-2 rounded-full bg-primary" />
                        )}
                      </div>
                      {tpl.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{tpl.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Research details */}
          {step === 2 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('projectDashboard.autoResearch.wizardStep2Title')}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('projectDashboard.autoResearch.wizardStep2Subtitle')}
              </p>
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-foreground">
                    {t('projectDashboard.autoResearch.paperTitle')} *
                  </span>
                  <input
                    type="text"
                    value={paperTitle}
                    onChange={(e) => setPaperTitle(e.target.value)}
                    placeholder={t('projectDashboard.autoResearch.paperTitlePlaceholder')}
                    className="w-full rounded-xl border border-border/60 bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none dark:bg-slate-950"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-foreground">
                    {t('projectDashboard.autoResearch.researchGoal')} *
                  </span>
                  <textarea
                    value={researchGoal}
                    onChange={(e) => setResearchGoal(e.target.value)}
                    placeholder={t('projectDashboard.autoResearch.researchGoalPlaceholder')}
                    rows={3}
                    className="w-full resize-none rounded-xl border border-border/60 bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none dark:bg-slate-950"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-foreground">
                    {t('projectDashboard.autoResearch.targetVenue')}
                  </span>
                  <input
                    type="text"
                    value={targetVenue}
                    onChange={(e) => setTargetVenue(e.target.value)}
                    placeholder={t('projectDashboard.autoResearch.targetVenuePlaceholder')}
                    className="w-full rounded-xl border border-border/60 bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none dark:bg-slate-950"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('projectDashboard.autoResearch.wizardStep3Title')}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('projectDashboard.autoResearch.wizardStep3Subtitle')}
              </p>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('projectDashboard.autoResearch.template')}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {selectedTemplate?.name}
                  </div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('projectDashboard.autoResearch.paperTitle')}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">{paperTitle}</div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('projectDashboard.autoResearch.researchGoal')}
                  </div>
                  <div className="mt-1 text-sm text-foreground">{researchGoal}</div>
                </div>
                {targetVenue && (
                  <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      {t('projectDashboard.autoResearch.targetVenue')}
                    </div>
                    <div className="mt-1 text-sm text-foreground">{targetVenue}</div>
                  </div>
                )}
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('projectDashboard.autoResearch.model')}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {providerLabel} · {modelLabel}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/60 px-5 py-4">
          <div>
            {step > 1 && !launching && (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
                {t('projectDashboard.autoResearch.back')}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step < 3 && (
              <Button
                size="sm"
                className="rounded-full"
                disabled={
                  (step === 1 && !selectedTemplateId) ||
                  (step === 2 && !canProceedStep2)
                }
                onClick={() => setStep(step + 1)}
              >
                {t('projectDashboard.autoResearch.next')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {step === 3 && (
              <Button
                size="sm"
                className="rounded-full"
                disabled={launching}
                onClick={handleLaunch}
              >
                <Sparkles className="h-4 w-4" />
                {launching
                  ? t('projectDashboard.autoResearch.launching')
                  : t('projectDashboard.autoResearch.launch')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
