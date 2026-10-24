import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Package, Play, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import { AUTO_RESEARCH_PACKS, type LocaleKey } from '../constants/autoResearchPacks';
import PackConfiguration, { type ConfigurationResult } from './auto-research/PackConfiguration';
import useLocalStorage from '../hooks/useLocalStorage';

function resolveLocaleKey(lang: string): LocaleKey {
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

const PACKS = AUTO_RESEARCH_PACKS;



export default function AutoResearchHub() {
  const { i18n, t: tr } = useTranslation('common');
  const locale = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const t = useMemo(() => tr('autoResearchHub', { returnObjects: true }) as Record<string, string>, [tr, i18n.language]);

  const [guideCollapsed, setGuideCollapsed] = useLocalStorage('auto-research-hub-guide-collapsed', true);
  const [guideDismissed, setGuideDismissed] = useLocalStorage('auto-research-hub-guide-dismissed', false);

  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<string>>(new Set());
  const [pendingPack, setPendingPack] = useState<string | null>(null);
  const writeLock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const configure = useCallback(async (pack: string, backend: string, values: Record<string, string>): Promise<ConfigurationResult | null> => {
    if (writeLock.current) return null;
    writeLock.current = true; setPendingPack(pack);
    try {
      const response = await api.communityTools.configure(null, backend, values, null);
      const data = await response.json().catch(() => { throw new Error(tr('autoResearchHub.invalidResponse', { status: response.status })); });
      if (!response.ok) throw new Error(data.error || tr('autoResearchHub.invalidResponse', { status: response.status }));
      if (typeof data.success !== 'boolean') throw new Error(tr('autoResearchHub.invalidResponse', { status: response.status }));
      return { success: data.success, steps: Array.isArray(data.steps) ? data.steps : [], errors: Array.isArray(data.errors) ? data.errors : [] };
    } finally { writeLock.current = false; if (mounted.current) setPendingPack(null); }
  }, [tr]);

  const packStyle = { border: 'border-border', bg: 'bg-muted/30', icon: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' };

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="workbench-page">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t.subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span>{tr('workbench.toolPacks', { count: PACKS.length })}</span>
            <span>{tr('workbench.workflows', { count: PACKS.reduce((sum, p) => sum + p.workflows.length, 0) })}</span>
            <span>{tr('workbench.noDependencyPacks', { count: PACKS.filter(p => p.mcp.length === 0).length })}</span>
          </div>
        </header>

        {/* Usage guide */}
        {!guideDismissed && (
          <div className="mb-5 rounded-lg border border-border p-4">

            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex shrink-0 items-center justify-center py-1 text-muted-foreground">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    {t.guideTitle}
                  </h3>
                  {!guideCollapsed ? (
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t.guideDesc}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tr('computeMetrics.guideHidden')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={!guideCollapsed}
                  onClick={() => setGuideCollapsed(!guideCollapsed)}
                >
                  {guideCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  {guideCollapsed ? t.guideExpand : t.guideCollapse}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setGuideDismissed(true)}
                >
                  <X className="h-4 w-4" />
                  {t.guideDismiss}
                </button>
              </div>
            </div>
            {!guideCollapsed && (
              <div className="relative mt-4 space-y-3 sm:pl-8">
                <ol className="list-decimal pl-4 space-y-1.5 text-sm text-muted-foreground">
                  {(['guideStep1', 'guideStep2', 'guideStep3', 'guideStep4', 'guideStep5'] as const).map((key) => (
                    <li key={key}>{t[key]}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Packs — config only */}
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
          {PACKS.map((pack) => {
            const accent = packStyle;
            const wfExpanded = expandedWorkflows.has(pack.name);

            return (
              <section data-research-pack={pack.name} key={pack.name} className={`min-w-0 rounded-lg border ${accent.border} bg-card `}>
                {/* Pack header */}
                <div className="p-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent.icon}`}>
                      <Package className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-foreground">{pack.name}</h2>
                        {pack.repoUrl && (
                          <a href={pack.repoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="GitHub">
                            ↗ GitHub
                          </a>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${accent.badge}`}>
                          {tr('autoResearchHub.workflowCount', { count: pack.workflows.length })}
                        </span>
                        {pack.mcp.length === 0 && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {tr('autoResearchHub.noMcp')}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{pack.description[locale]}</p>
                    </div>
                  </div>

                  {/* Collapsible workflows list */}
                  <button
                    type="button"
                    onClick={() => setExpandedWorkflows(prev => { const n = new Set(prev); n.has(pack.name) ? n.delete(pack.name) : n.add(pack.name); return n; })}
                    aria-expanded={wfExpanded}
                    className="mt-3 flex min-h-11 w-full items-center justify-between rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Play className="h-3 w-3" />
                      {tr('autoResearchHub.includedWorkflows')}
                    </span>
                    {wfExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  {wfExpanded && (
                    <div className="mt-2 space-y-1">
                      {pack.workflows.map((wf) => (
                        <div key={wf.command} className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-3 last:border-0">
                          <div className="min-w-0 flex-1 basis-48">
                            <span className="text-sm font-medium text-foreground">{wf.name}</span>
                            <p className="mt-1 text-sm text-muted-foreground">{wf.description[locale]}</p>
                          </div>
                          <code className="max-w-full break-all text-xs text-muted-foreground">{wf.command}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {pack.mcp.length > 0 ? (
                  <PackConfiguration pack={pack} locale={locale} pendingPack={pendingPack} configure={configure} />
                ) : (
                  <div className="border-t border-border/40 px-5 py-3">
                    <p className="flex items-start gap-2 text-xs font-medium text-muted-foreground"><Check className="h-4 w-4 shrink-0" aria-hidden />{t.noDeps}</p>
                  </div>
                )}
              </section>
            );
          })}

          <div className="flex flex-col items-start gap-2 border-t border-border pt-4 text-sm xl:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-muted-foreground">{t.ctaDesc}</p>
            <a href="https://github.com/OpenLAIR/dr-claw/issues/new?labels=auto-research-pack&template=pack_submission.md" target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md px-3 py-2 font-medium underline underline-offset-4 hover:bg-muted">{t.ctaButton}</a>
          </div>
        </div>
      </div>
    </div>
  );
}
