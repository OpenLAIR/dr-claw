import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  FlaskConical,
  Loader2,
  Package,
  Play,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import { AUTO_RESEARCH_PACKS, type LocaleKey, type PackDef } from '../constants/autoResearchPacks';
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

  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [expandedConfig, setExpandedConfig] = useState<Set<string>>(new Set());
  const [selectedMcp, setSelectedMcp] = useState<Record<string, string>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [apiKeyVisible, setApiKeyVisible] = useState<Record<string, boolean>>({});
  const [configuring, setConfiguring] = useState(false);
  const [configResult, setConfigResult] = useState<{ success: boolean; message: string } | null>(null);

  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<string>>(new Set());

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCommand(text);
      setTimeout(() => setCopiedCommand(null), 2000);
    });
  }, []);

  const handleConfigure = useCallback(async (pack: PackDef) => {
    const mcpKey = selectedMcp[pack.name] || pack.mcp[0]?.key;
    const mcpOpt = pack.mcp.find(m => m.key === mcpKey) || pack.mcp[0];

    const apiKeys: Record<string, string> = {};
    if (mcpOpt) {
      for (const ev of mcpOpt.envVars) {
        if (apiKeyInputs[ev.name]) apiKeys[ev.name] = apiKeyInputs[ev.name];
      }
    }

    setConfiguring(true);
    setConfigResult(null);
    try {
      const resp = await api.communityTools.configure(null, mcpKey, apiKeys, null);
      if (!resp.ok) {
        const text = await resp.text();
        setConfigResult({ success: false, message: `Server error (${resp.status}): ${text}` });
        return;
      }
      const data = await resp.json();
      setConfigResult({
        success: data.success,
        message: data.success ? t.configSuccess : (data.errors || []).map((e: { error: string }) => e.error).join('; '),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setConfigResult({ success: false, message: msg });
    } finally {
      setConfiguring(false);
    }
  }, [selectedMcp, apiKeyInputs, t.configSuccess]);

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
                  <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-sky-100">
                    {t.guideTitle}
                  </h3>
                  {!guideCollapsed ? (
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-sky-100/85">
                      {t.guideDesc}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-600 dark:text-sky-100/70">
                      {tr('computeMetrics.guideHidden')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-700 hover:bg-sky-100/60 hover:text-slate-900 dark:text-sky-100/80 dark:hover:bg-sky-900/30 dark:hover:text-sky-100"
                  onClick={() => setGuideCollapsed(!guideCollapsed)}
                >
                  {guideCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  {guideCollapsed ? t.guideExpand : t.guideCollapse}
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-700 hover:bg-sky-100/60 hover:text-slate-900 dark:text-sky-100/80 dark:hover:bg-sky-900/30 dark:hover:text-sky-100"
                  onClick={() => setGuideDismissed(true)}
                >
                  <X className="h-4 w-4" />
                  {t.guideDismiss}
                </button>
              </div>
            </div>
            {!guideCollapsed && (
              <div className="relative mt-4 space-y-3 sm:pl-8">
                <ol className="list-decimal pl-4 space-y-1.5 text-sm text-slate-700 dark:text-sky-100/85">
                  {(['guideStep1', 'guideStep2', 'guideStep3', 'guideStep4', 'guideStep5'] as const).map((key) => (
                    <li key={key}>{t[key]}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Packs — config only */}
        <div className="grid gap-4 xl:grid-cols-2">
          {PACKS.map((pack) => {
            const accent = packStyle;
            const mcpKey = selectedMcp[pack.name] || pack.mcp[0]?.key || '';
            const mcpOpt = pack.mcp.find(m => m.key === mcpKey);
            const wfExpanded = expandedWorkflows.has(pack.name);

            return (
              <div key={pack.name} className={`rounded-lg border ${accent.border} bg-card `}>
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
                          <a href={pack.repoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground transition-colors" title="GitHub">
                            ↗ GitHub
                          </a>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${accent.badge}`}>
                          {tr('autoResearchHub.workflowCount', { count: pack.workflows.length })}
                        </span>
                        {pack.mcp.length === 0 && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                            {tr('autoResearchHub.noMcp')}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{pack.description[locale]}</p>
                    </div>
                  </div>

                  {/* Collapsible workflows list */}
                  <button
                    type="button"
                    onClick={() => setExpandedWorkflows(prev => { const n = new Set(prev); n.has(pack.name) ? n.delete(pack.name) : n.add(pack.name); return n; })}
                    className="mt-3 flex w-full items-center justify-between rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60"
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
                        <div key={wf.command} className="flex items-center justify-between rounded-lg px-3 py-1.5 hover:bg-muted/30">
                          <div>
                            <span className="text-xs font-semibold text-foreground">{wf.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{wf.description[locale]}</span>
                          </div>
                          <code className="text-xs text-muted-foreground/60 font-mono">{wf.command}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Configuration — directly open for packs that need it */}
                {pack.mcp.length > 0 ? (
                  <div className="border-t border-border/40">
                    <button
                      type="button"
                      onClick={() => setExpandedConfig(prev => { const n = new Set(prev); n.has(pack.name) ? n.delete(pack.name) : n.add(pack.name); return n; })}
                      className="flex w-full items-center justify-between px-5 py-3 transition-colors hover:bg-muted/30"
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <AlertCircle className="h-4 w-4 text-sky-500" />
                        {t.config}
                      </span>
                      {expandedConfig.has(pack.name) ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </button>

                    {expandedConfig.has(pack.name) && (
                      <div className="space-y-4 px-5 pb-5">
                        {/* MCP */}
                        <div>
                          <h4 className="mb-1 text-sm font-semibold text-foreground">{pack.configLabel?.[locale]?.title ?? t.configMcp}</h4>
                          <p className="mb-2 text-xs text-muted-foreground">{pack.configLabel?.[locale]?.desc ?? t.configMcpDesc}</p>
                          {pack.mcp.length > 1 && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {pack.mcp.map(opt => (
                              <button key={opt.key} type="button" onClick={() => setSelectedMcp(p => ({ ...p, [pack.name]: opt.key }))}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${mcpKey === opt.key ? 'border-sky-400 bg-sky-100 text-sky-700  dark:border-sky-600 dark:bg-sky-900/40 dark:text-sky-200' : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/60'}`}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          )}
                          {mcpOpt && (
                            <div className="space-y-2 rounded-lg border border-sky-200/50 bg-sky-50/30 p-3 dark:border-sky-800/30 dark:bg-sky-950/10">
                              {mcpOpt.install && (
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 min-w-0 flex-1">
                                    <p className="mb-0.5 text-xs font-medium text-muted-foreground">{t.install}</p>
                                    <code className="block truncate rounded bg-slate-100 px-2 py-1 text-xs text-foreground dark:bg-slate-800">{mcpOpt.install}</code>
                                  </div>
                                  <button type="button" onClick={() => copyToClipboard(mcpOpt.install!)} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/30">
                                    {copiedCommand === mcpOpt.install ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                                  </button>
                                </div>
                              )}
                              {mcpOpt.register && (
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 min-w-0 flex-1">
                                  <p className="mb-0.5 text-xs font-medium text-muted-foreground">{t.register}</p>
                                  <code className="block truncate rounded bg-slate-100 px-2 py-1 text-xs text-foreground dark:bg-slate-800">{mcpOpt.register}</code>
                                </div>
                                <button type="button" onClick={() => copyToClipboard(mcpOpt.register!)} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/30">
                                  {copiedCommand === mcpOpt.register ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                              )}
                              {mcpOpt.envVars.map(ev => (
                                <div key={ev.name}>
                                  <p className="mb-1 text-xs font-medium text-muted-foreground">{ev.name}</p>
                                  <div className="relative">
                                    <input type={apiKeyVisible[ev.name] ? 'text' : 'password'} placeholder={ev.example} value={apiKeyInputs[ev.name] || ''} onChange={e => setApiKeyInputs(p => ({ ...p, [ev.name]: e.target.value }))}
                                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 pr-9 text-xs font-mono text-foreground outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-300/50 dark:focus:border-sky-600" />
                                    <button type="button" onClick={() => setApiKeyVisible(p => ({ ...p, [ev.name]: !p[ev.name] }))} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
                                      {apiKeyVisible[ev.name] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* GPU — auto-configured from Compute Panel, just show a note */}
                        {pack.gpu.length > 0 && (
                          <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                            <p className="text-xs text-muted-foreground">
                              <Cpu className="mr-1 inline h-3 w-3" />
                              {tr('autoResearchHub.gpuNote')}
                            </p>
                          </div>
                        )}

                        {/* Configure button */}
                        <button type="button" disabled={configuring} onClick={() => handleConfigure(pack)}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white  transition-colors hover:bg-sky-700 active:scale-[0.98] disabled:opacity-60 dark:bg-sky-500 dark:hover:bg-sky-600">
                          {configuring ? <><Loader2 className="h-4 w-4 animate-spin" />{t.configApplying}</> : <><Settings className="h-4 w-4" />{t.configApply}</>}
                        </button>
                        {configResult && (
                          <p className={`text-center text-xs font-medium ${configResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {configResult.message}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border-t border-border/40 px-5 py-3">
                    <p className="flex items-start gap-2 text-xs font-medium text-muted-foreground"><Check className="h-4 w-4 shrink-0" aria-hidden />{t.noDeps}</p>
                  </div>
                )}
              </div>
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
