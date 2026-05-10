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
import { emitAutoresearchEvent } from '../utils/autoresearchTelemetry';
import { AUTO_RESEARCH_PACKS, type LocaleKey, type PackDef } from '../constants/autoResearchPacks';
import useLocalStorage from '../hooks/useLocalStorage';

function resolveLocaleKey(lang: string): LocaleKey {
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

const PACKS = AUTO_RESEARCH_PACKS;

const TEXT: Record<LocaleKey, Record<string, string>> = {
  zh: {
    title: 'Auto Research Hub',
    subtitle: '端到端自动研究工具。选择工具包，配置环境，一键开始研究。',
    useInChat: '在 Chat 中使用',
    workflows: '工作流',
    config: '环境配置',
    configMcp: '① MCP 审稿服务',
    configMcpDesc: '选择外部 LLM 进行跨模型审稿（必填）',
    configGpu: '② GPU 环境',
    configGpuDesc: '添加到项目 CLAUDE.md（跑实验需要）',
    configSetup: '③ 一键安装',
    configApply: '一键配置',
    configApplying: '配置中...',
    configSuccess: '配置完成！重启 Claude Code 会话后生效。',
    install: '安装',
    register: '注册 MCP',
    envVar: '环境变量',
    claudeMd: '添加到 CLAUDE.md',
    copied: '已复制!',
    noDeps: '零依赖，无需配置，直接使用。',
    existingServer: '已有服务器',
    detectGpu: '检测 GPU',
    quickStart: '快速开始',
    selectWorkflow: '选择研究工作流',
    inputPlaceholder: '输入你的研究方向或主题...',
    startResearch: '开始研究',
    guideTitle: '如何使用 Auto Research Hub',
    guideDesc: '从选择工具包到执行研究，只需 5 步即可开始自动化研究。',
    guideStep1: '浏览下方的工具包，选择一个适合你研究需求的（如 ARIS、Autoresearch 或 DeepScientist）。',
    guideStep2: '对于需要配置的工具包（如 ARIS），展开"环境配置"，选择 MCP 审稿服务，输入 API Key，然后点击"一键配置"。零依赖工具包无需此步骤。',
    guideStep3: '前往 Chat 页面，点击输入框上方的"Auto Research"下拉菜单，选择对应的工具包和工作流。',
    guideStep4: '输入你的研究方向或主题，Agent 将端到端执行所选工作流。',
    guideStep5: '在 Research Lab 中查看研究成果，或直接查看项目的 pipeline 目录下的产出文件。',
    guideCollapse: '收起',
    guideExpand: '展开',
    guideDismiss: '不再显示',
    ctaTitle: '你的工具包',
    ctaDesc: '有自己的 Auto Research 流程？提交你的工具包，让全球研究者使用！',
    ctaButton: '提交工具包',
  },
  en: {
    title: 'Auto Research Hub',
    subtitle: 'End-to-end autonomous research tools. Pick a pack, configure, start researching.',
    useInChat: 'Use in Chat',
    workflows: 'Workflows',
    config: 'Configuration',
    configMcp: '① MCP Reviewer',
    configMcpDesc: 'Choose an external LLM for cross-model review (required)',
    configGpu: '② GPU Environment',
    configGpuDesc: 'Add to your project CLAUDE.md (for experiments)',
    configSetup: '③ Setup Script',
    configApply: 'Auto Configure',
    configApplying: 'Configuring...',
    configSuccess: 'Configured! Restart Claude Code session to activate.',
    install: 'Install',
    register: 'Register MCP',
    envVar: 'Env Variable',
    claudeMd: 'Add to CLAUDE.md',
    copied: 'Copied!',
    noDeps: 'Zero dependencies. No setup needed — use directly.',
    existingServer: 'Existing Server',
    detectGpu: 'Detect GPU',
    quickStart: 'Quick Start',
    selectWorkflow: 'Select workflow',
    inputPlaceholder: 'Enter your research topic...',
    startResearch: 'Start Research',
    guideTitle: 'How to Use Auto Research Hub',
    guideDesc: 'From picking a tool pack to running research — get started in 5 steps.',
    guideStep1: 'Browse the packs below and pick one that fits your research needs (e.g. ARIS, Autoresearch, or DeepScientist).',
    guideStep2: 'For packs that require configuration (e.g. ARIS), expand "Configuration", select an MCP Reviewer, enter your API key, and click "Auto Configure". Zero-dependency packs skip this step.',
    guideStep3: 'Go to Chat, click the "Auto Research" dropdown above the input box, and select your pack and workflow.',
    guideStep4: 'Enter your research topic — the agent will execute the selected workflow end-to-end.',
    guideStep5: 'Check results in Research Lab or browse the output files in your project\'s pipeline directory.',
    guideCollapse: 'Collapse',
    guideExpand: 'Expand',
    guideDismiss: 'Remove forever',
    ctaTitle: 'Your Pack Here',
    ctaDesc: 'Built your own Auto Research workflow? Submit it as a tool pack and share it with researchers worldwide!',
    ctaButton: 'Submit a Pack',
  },
  ko: {
    title: 'Auto Research Hub',
    subtitle: 'End-to-end autonomous research tools.',
    useInChat: 'Use in Chat',
    workflows: 'Workflows',
    config: 'Configuration',
    configMcp: '① MCP Reviewer',
    configMcpDesc: 'Choose external LLM (required)',
    configGpu: '② GPU Environment',
    configGpuDesc: 'Add to CLAUDE.md',
    configSetup: '③ Setup Script',
    configApply: 'Auto Configure',
    configApplying: 'Configuring...',
    configSuccess: 'Configured!',
    install: 'Install',
    register: 'Register MCP',
    envVar: 'Env Variable',
    claudeMd: 'Add to CLAUDE.md',
    copied: 'Copied!',
    noDeps: 'Zero dependencies.',
    existingServer: 'Existing Server',
    detectGpu: 'Detect GPU',
    quickStart: 'Quick Start',
    selectWorkflow: 'Select workflow',
    inputPlaceholder: 'Enter your research topic...',
    startResearch: 'Start Research',
    guideTitle: 'Auto Research Hub 사용법',
    guideDesc: '도구 팩 선택부터 연구 실행까지 5단계로 시작하세요.',
    guideStep1: '아래 도구 팩을 둘러보고 연구 목적에 맞는 팩을 선택하세요 (예: ARIS, Autoresearch, DeepScientist).',
    guideStep2: '설정이 필요한 팩(예: ARIS)은 "Configuration"을 펼치고 MCP Reviewer를 선택한 뒤 API 키를 입력하고 "Auto Configure"를 클릭하세요.',
    guideStep3: 'Chat으로 이동하여 입력창 위의 "Auto Research" 드롭다운에서 팩과 워크플로를 선택하세요.',
    guideStep4: '연구 주제를 입력하면 에이전트가 선택한 워크플로를 실행합니다.',
    guideStep5: 'Research Lab에서 결과를 확인하거나 프로젝트의 pipeline 디렉터리에서 출력 파일을 확인하세요.',
    guideCollapse: '접기',
    guideExpand: '펼치기',
    guideDismiss: '다시 표시 안 함',
    ctaTitle: '나만의 팩',
    ctaDesc: '나만의 Auto Research 워크플로를 만들었나요? 도구 팩으로 제출하고 전 세계 연구자와 공유하세요!',
    ctaButton: '팩 제출하기',
  },
};

export default function AutoResearchHub() {
  const { i18n } = useTranslation();
  const locale = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const t = TEXT[locale];

  const [guideCollapsed, setGuideCollapsed] = useLocalStorage('auto-research-hub-guide-collapsed', false);
  const [guideDismissed, setGuideDismissed] = useLocalStorage('auto-research-hub-guide-dismissed', false);

  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [expandedConfig, setExpandedConfig] = useState<Set<string>>(new Set());
  const [selectedMcp, setSelectedMcp] = useState<Record<string, string>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [apiKeyVisible, setApiKeyVisible] = useState<Record<string, boolean>>({});
  const [configuring, setConfiguring] = useState(false);
  const [configResult, setConfigResult] = useState<{ success: boolean; message: string } | null>(null);

  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<string>>(new Set());

  useEffect(() => {
    emitAutoresearchEvent('autoresearch_hub_viewed', {
      pack_count: PACKS.length,
      workflow_count: PACKS.reduce((sum, p) => sum + p.workflows.length, 0),
    });
  }, []);

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
    let envVarsFilled = 0;
    if (mcpOpt) {
      for (const ev of mcpOpt.envVars) {
        if (apiKeyInputs[ev.name]) {
          apiKeys[ev.name] = apiKeyInputs[ev.name];
          envVarsFilled += 1;
        }
      }
    }

    emitAutoresearchEvent('autoresearch_configure_clicked', {
      pack: pack.name,
      mcp_key: mcpKey || null,
      env_vars_required: mcpOpt?.envVars.length ?? 0,
      env_vars_filled: envVarsFilled,
    });

    setConfiguring(true);
    setConfigResult(null);
    try {
      const resp = await api.communityTools.configure(null, mcpKey, apiKeys, null);
      if (!resp.ok) {
        const text = await resp.text();
        emitAutoresearchEvent('autoresearch_configure_result', {
          pack: pack.name,
          mcp_key: mcpKey || null,
          success: false,
          error_type: 'http_error',
          http_status: resp.status,
        });
        setConfigResult({ success: false, message: `Server error (${resp.status}): ${text}` });
        return;
      }
      const data = await resp.json();
      emitAutoresearchEvent('autoresearch_configure_result', {
        pack: pack.name,
        mcp_key: mcpKey || null,
        success: Boolean(data.success),
        error_type: data.success ? null : 'server_reported_error',
        error_count: Array.isArray(data.errors) ? data.errors.length : 0,
      });
      setConfigResult({
        success: data.success,
        message: data.success ? t.configSuccess : (data.errors || []).map((e: { error: string }) => e.error).join('; '),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitAutoresearchEvent('autoresearch_configure_result', {
        pack: pack.name,
        mcp_key: mcpKey || null,
        success: false,
        error_type: 'exception',
      });
      setConfigResult({ success: false, message: msg });
    } finally {
      setConfiguring(false);
    }
  }, [selectedMcp, apiKeyInputs, t.configSuccess]);

  // Distinct accent colors per pack index
  const PACK_ACCENTS = [
    { border: 'border-purple-200/60 dark:border-purple-800/30', bg: 'bg-purple-50/40 dark:bg-purple-950/10', icon: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
    { border: 'border-teal-200/60 dark:border-teal-800/30', bg: 'bg-teal-50/40 dark:bg-teal-950/10', icon: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200', badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
    { border: 'border-amber-200/60 dark:border-amber-800/30', bg: 'bg-amber-50/40 dark:bg-amber-950/10', icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    { border: 'border-rose-200/60 dark:border-rose-800/30', bg: 'bg-rose-50/40 dark:bg-rose-950/10', icon: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  ];

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
        {/* Header */}
        <div className="relative mb-5 overflow-hidden rounded-[28px] border border-purple-200/60 bg-[radial-gradient(circle_at_top_left,_rgba(168,85,247,0.15),_transparent_40%),linear-gradient(135deg,_rgba(248,250,252,0.95),_rgba(250,245,255,0.9))] p-5 shadow-sm dark:border-purple-800/30 dark:bg-[radial-gradient(circle_at_top_left,_rgba(168,85,247,0.12),_transparent_40%),linear-gradient(135deg,_rgba(2,6,23,0.96),_rgba(15,10,30,0.92))]">
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-purple-200/50 blur-3xl dark:bg-purple-500/20" />
          <div className="absolute bottom-0 right-20 h-24 w-24 rounded-full bg-fuchsia-200/40 blur-2xl dark:bg-fuchsia-500/10" />

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-200/70 bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-purple-700 shadow-sm dark:border-purple-800/60 dark:bg-slate-950/60 dark:text-purple-200">
              <FlaskConical className="h-3.5 w-3.5" />
              Auto Research
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t.title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{t.subtitle}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/50">
                <p className="text-xl font-semibold text-foreground">{PACKS.length}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {locale === 'zh' ? '工具包' : 'Tool Packs'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/50">
                <p className="text-xl font-semibold text-foreground">{PACKS.reduce((sum, p) => sum + p.workflows.length, 0)}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {locale === 'zh' ? '工作流' : 'Workflows'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/50">
                <p className="text-xl font-semibold text-foreground">{PACKS.filter(p => p.mcp.length === 0).length}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {locale === 'zh' ? '零依赖' : 'Zero Deps'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Usage guide */}
        {!guideDismissed && (
          <div className="relative mb-5 overflow-hidden rounded-[28px] border border-sky-200/70 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.24),transparent_38%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(239,246,255,0.94))] p-5 shadow-sm dark:border-sky-900/70 dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_38%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.94))]">
            <div className="absolute -right-10 -top-8 h-28 w-28 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-500/10" />
            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-sky-200/80 bg-white/80 text-sky-700 shadow-sm dark:border-sky-900/70 dark:bg-slate-950/50 dark:text-sky-300">
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
                      {locale === 'zh' ? '教程已折叠，点击展开查看。' : 'Guide hidden. Expand to view steps.'}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-700 hover:bg-sky-100/60 hover:text-slate-900 dark:text-sky-100/80 dark:hover:bg-sky-900/30 dark:hover:text-sky-100"
                  onClick={() => {
                    emitAutoresearchEvent('autoresearch_guide_toggled', { collapsed: !guideCollapsed });
                    setGuideCollapsed(!guideCollapsed);
                  }}
                  data-telemetry-id="autoresearch-hub-guide-toggle"
                >
                  {guideCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  {guideCollapsed ? t.guideExpand : t.guideCollapse}
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-700 hover:bg-sky-100/60 hover:text-slate-900 dark:text-sky-100/80 dark:hover:bg-sky-900/30 dark:hover:text-sky-100"
                  onClick={() => {
                    emitAutoresearchEvent('autoresearch_guide_dismissed', {});
                    setGuideDismissed(true);
                  }}
                  data-telemetry-id="autoresearch-hub-guide-dismiss"
                >
                  <X className="h-4 w-4" />
                  {t.guideDismiss}
                </button>
              </div>
            </div>
            {!guideCollapsed && (
              <div className="relative mt-4 space-y-3 pl-14">
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
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {PACKS.map((pack, packIdx) => {
            const accent = PACK_ACCENTS[packIdx % PACK_ACCENTS.length];
            const mcpKey = selectedMcp[pack.name] || pack.mcp[0]?.key || '';
            const mcpOpt = pack.mcp.find(m => m.key === mcpKey);
            const wfExpanded = expandedWorkflows.has(pack.name);

            return (
              <div key={pack.name} className={`rounded-2xl border ${accent.border} bg-card shadow-sm`}>
                {/* Pack header */}
                <div className="p-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accent.icon}`}>
                      <Package className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-foreground">{pack.name}</h2>
                        {pack.repoUrl && (
                          <a href={pack.repoUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors" title="GitHub">
                            ↗ GitHub
                          </a>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${accent.badge}`}>
                          {pack.workflows.length} {locale === 'zh' ? '个工作流' : 'workflows'}
                        </span>
                        {pack.mcp.length === 0 && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                            {locale === 'zh' ? '零依赖' : 'Zero deps'}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{pack.description[locale]}</p>
                    </div>
                  </div>

                  {/* Collapsible workflows list */}
                  <button
                    type="button"
                    onClick={() => setExpandedWorkflows(prev => {
                      const n = new Set(prev);
                      const willExpand = !n.has(pack.name);
                      emitAutoresearchEvent('autoresearch_pack_expanded', {
                        pack: pack.name,
                        expanded: willExpand,
                        source: 'hub',
                      });
                      if (n.has(pack.name)) n.delete(pack.name); else n.add(pack.name);
                      return n;
                    })}
                    data-telemetry-id={`autoresearch-hub-pack-workflows-${pack.name}`}
                    className="mt-3 flex w-full items-center justify-between rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Play className="h-3 w-3" />
                      {locale === 'zh' ? '包含的工作流' : 'Included workflows'}
                    </span>
                    {wfExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  {wfExpanded && (
                    <div className="mt-2 space-y-1">
                      {pack.workflows.map((wf) => (
                        <div key={wf.command} className="flex items-center justify-between rounded-lg px-3 py-1.5 hover:bg-muted/30">
                          <div>
                            <span className="text-xs font-semibold text-foreground">{wf.name}</span>
                            <span className="ml-2 text-[10px] text-muted-foreground">{wf.description[locale]}</span>
                          </div>
                          <code className="text-[10px] text-muted-foreground/60 font-mono">{wf.command}</code>
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
                      onClick={() => setExpandedConfig(prev => {
                        const n = new Set(prev);
                        const willExpand = !n.has(pack.name);
                        emitAutoresearchEvent('autoresearch_config_section_opened', {
                          pack: pack.name,
                          expanded: willExpand,
                        });
                        if (n.has(pack.name)) n.delete(pack.name); else n.add(pack.name);
                        return n;
                      })}
                      data-telemetry-id={`autoresearch-hub-config-${pack.name}`}
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
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => {
                                  emitAutoresearchEvent('autoresearch_mcp_selected', {
                                    pack: pack.name,
                                    mcp_key: opt.key,
                                  });
                                  setSelectedMcp(p => ({ ...p, [pack.name]: opt.key }));
                                }}
                                data-telemetry-id={`autoresearch-hub-mcp-${pack.name}-${opt.key}`}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${mcpKey === opt.key ? 'border-sky-400 bg-sky-100 text-sky-700 shadow-sm dark:border-sky-600 dark:bg-sky-900/40 dark:text-sky-200' : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/60'}`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          )}
                          {mcpOpt && (
                            <div className="space-y-2 rounded-xl border border-sky-200/50 bg-sky-50/30 p-3 dark:border-sky-800/30 dark:bg-sky-950/10">
                              {mcpOpt.install && (
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
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
                                <div className="min-w-0 flex-1">
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
                              {locale === 'zh'
                                ? 'GPU 环境会自动从 Compute Panel 中已连接的服务器读取，无需在此配置。'
                                : 'GPU environment is auto-detected from servers connected in the Compute Panel.'}
                            </p>
                          </div>
                        )}

                        {/* Configure button */}
                        <button
                          type="button"
                          disabled={configuring}
                          onClick={() => handleConfigure(pack)}
                          data-telemetry-id={`autoresearch-hub-configure-${pack.name}`}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-sky-700 active:scale-[0.98] disabled:opacity-60 dark:bg-sky-500 dark:hover:bg-sky-600"
                        >
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
                    <p className="text-xs font-medium text-green-600 dark:text-green-400">✓ {t.noDeps}</p>
                  </div>
                )}
              </div>
            );
          })}

          {/* CTA placeholder card */}
          <a
            href="https://github.com/OpenLAIR/dr-claw/issues/new?labels=auto-research-pack&template=pack_submission.md"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border/60 bg-muted/20 p-8 text-center transition-all hover:border-purple-300 hover:bg-purple-50/30 dark:hover:border-purple-700 dark:hover:bg-purple-950/20"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/30 text-muted-foreground/50 transition-colors group-hover:border-purple-400 group-hover:text-purple-600 dark:group-hover:border-purple-500 dark:group-hover:text-purple-300">
              <Plus className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-muted-foreground/70 transition-colors group-hover:text-purple-700 dark:group-hover:text-purple-200">
                {t.ctaTitle}
              </h2>
              <p className="mt-1.5 max-w-xs text-xs text-muted-foreground/60 transition-colors group-hover:text-muted-foreground">
                {t.ctaDesc}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-200/60 bg-purple-50/60 px-4 py-1.5 text-xs font-semibold text-purple-600 transition-all group-hover:bg-purple-100 group-hover:text-purple-700 dark:border-purple-800/40 dark:bg-purple-950/30 dark:text-purple-300 dark:group-hover:bg-purple-900/40">
              {t.ctaButton}
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
