import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardCopy,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  Stethoscope,
  Terminal,
  Trash2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../utils/api';
import { CLAUDE_MODELS, CODEX_MODELS, GEMINI_MODELS } from '../../shared/modelConstants';
import type { CommunityToolTerminalConfig } from './CommunityToolTerminalOverlay';

// ── Types ──

type ToolCommand = {
  name: string;
  description: string;
};

type ToolRequirements = {
  runtime: string;
  pythonVersion?: string;
  note?: string;
};

type RegistryTool = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  localPath?: string;
  type: 'claude-skill' | 'python-app';
  commands: ToolCommand[];
  requirements: ToolRequirements;
  tags: string[];
  preInstalled?: boolean;
  recommendedProvider?: string;
  recommendedModel?: string;
};

// Map community-tools llm_provider values to model constant keys
const PROVIDER_MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  anthropic: CLAUDE_MODELS.OPTIONS,
  openai: CODEX_MODELS.OPTIONS,
  gemini: GEMINI_MODELS.OPTIONS,
};

const PROVIDER_MODEL_DEFAULTS: Record<string, string> = {
  anthropic: CLAUDE_MODELS.DEFAULT || 'claude-opus-4-6',
  openai: CODEX_MODELS.DEFAULT || 'gpt-5.4',
  gemini: GEMINI_MODELS.DEFAULT || 'gemini-3-flash-preview',
};

type InstalledInfo = {
  installDir: string;
  setupDir?: string;
  installedAt: string;
  type: string;
  repoUrl: string;
  localPath?: string;
  config?: Record<string, string>;
  updatedAt?: string;
};

type ActiveOp = {
  type: string;
  logs: string[];
  running?: boolean;
};

type DoctorResult = {
  check: string;
  ok: boolean;
  message?: string;
};

// ── Main Panel ──

export default function CommunityToolsPanel({
  onOpenTerminal,
}: {
  onOpenTerminal?: (config: CommunityToolTerminalConfig) => void;
}) {
  const { t } = useTranslation('common');
  const [registry, setRegistry] = useState<RegistryTool[]>([]);
  const [installed, setInstalled] = useState<Record<string, InstalledInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [regRes, instRes] = await Promise.all([
        api.communityTools.registry(),
        api.communityTools.installed(),
      ]);
      if (!regRes.ok) throw new Error('Failed to load registry');
      if (!instRes.ok) throw new Error('Failed to load installed tools');
      const regData = await regRes.json();
      const instData = await instRes.json();
      setRegistry(regData.tools || []);
      setInstalled(instData.tools || {});
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-2">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <button onClick={fetchData} className="text-xs text-primary hover:underline">{t('communityToolsPanel.retry')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Wrench className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">{t('communityToolsPanel.title')}</h1>
          </div>
          <p className="text-sm text-muted-foreground ml-9">
            {t('communityToolsPanel.subtitle')}
          </p>
        </div>

        {/* Tool Cards */}
        <div className="space-y-4">
          {registry.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              installedInfo={installed[tool.id] || null}
              expanded={expandedTool === tool.id}
              onToggleExpand={() => setExpandedTool(expandedTool === tool.id ? null : tool.id)}
              onRefresh={fetchData}
              onOpenTerminal={onOpenTerminal}
            />
          ))}
        </div>

        {registry.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {t('communityToolsPanel.empty')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tool Card ──

function ToolCard({
  tool,
  installedInfo,
  expanded,
  onToggleExpand,
  onRefresh,
  onOpenTerminal,
}: {
  tool: RegistryTool;
  installedInfo: InstalledInfo | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onRefresh: () => void;
  onOpenTerminal?: (config: CommunityToolTerminalConfig) => void;
}) {
  const { t } = useTranslation('common');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [doctorResults, setDoctorResults] = useState<DoctorResult[] | null>(null);
  const [polling, setPolling] = useState(false);
  const [configValues, setConfigValues] = useState<Record<string, string>>(
    installedInfo?.config || {}
  );

  const isInstalled = !!installedInfo;

  // Poll for operation progress
  const pollStatus = useCallback(async () => {
    try {
      const res = await api.communityTools.status(tool.id);
      if (!res.ok) return;
      const data = await res.json();
      if (data.activeOperation) {
        setLogs(data.activeOperation.logs || []);
        // Use the `running` flag: process still alive → keep polling
        if (data.activeOperation.running) return true;
        // Process ended but logs still available → stop polling, keep logs
        return false;
      }
      return false;
    } catch {
      return false;
    }
  }, [tool.id]);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      const active = await pollStatus();
      if (!active) {
        setPolling(false);
        onRefresh();
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [polling, pollStatus, onRefresh]);

  // Auto-poll for pre-installed tools that haven't finished setting up yet
  useEffect(() => {
    if (!tool.preInstalled || isInstalled) return;
    const interval = setInterval(() => { onRefresh(); }, 3000);
    return () => clearInterval(interval);
  }, [tool.preInstalled, isInstalled, onRefresh]);

  const handleInstall = async () => {
    setActionLoading('install');
    setLogs([]);
    setDoctorResults(null);
    try {
      const res = await api.communityTools.install(tool.id);
      const data = await res.json();
      if (!res.ok) {
        setLogs([`Error: ${data.error}`]);
        return;
      }
      if (data.synchronous) {
        // Claude-skill installs complete immediately
        setLogs(data.logs || ['Installation complete']);
        onRefresh();
      } else {
        setPolling(true);
      }
    } catch (err: any) {
      setLogs([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUninstall = async () => {
    if (!confirm(`Uninstall ${tool.name}? This will remove all installed files.`)) return;
    setActionLoading('uninstall');
    setLogs([]);
    try {
      const res = await api.communityTools.uninstall(tool.id);
      const data = await res.json();
      if (!res.ok) {
        setLogs([`Error: ${data.error}`]);
        return;
      }
      setLogs([data.message]);
      onRefresh();
    } catch (err: any) {
      setLogs([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDoctor = async () => {
    setActionLoading('doctor');
    setDoctorResults(null);
    try {
      const res = await api.communityTools.doctor(tool.id);
      const data = await res.json();
      if (data.success) {
        setDoctorResults(data.results);
      } else {
        setLogs([`Doctor error: ${data.error}`]);
      }
    } catch (err: any) {
      setLogs([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveConfig = async () => {
    setActionLoading('config');
    try {
      const res = await api.communityTools.configure(tool.id, configValues);
      const data = await res.json();
      if (!res.ok) {
        setLogs([`Config error: ${data.error}`]);
        return;
      }
      setLogs([data.message]);
      onRefresh();
    } catch (err: any) {
      setLogs([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenTerminal = (command?: string) => {
    if (!installedInfo || !onOpenTerminal) return;
    onOpenTerminal({
      toolId: tool.id,
      toolName: tool.name,
      installDir: installedInfo.installDir,
      setupDir: installedInfo.setupDir || '',
      initialCommand: command,
    });
  };

  const typeBadge = tool.type === 'claude-skill'
    ? { label: t('communityToolsPanel.typeClaude'), className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' }
    : { label: t('communityToolsPanel.typePython'), className: 'bg-green-500/10 text-green-600 dark:text-green-400' };

  const statusBadge = polling
    ? { label: t('communityToolsPanel.statusWorking'), className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' }
    : isInstalled
    ? { label: tool.preInstalled ? t('communityToolsPanel.statusPreInstalled') : t('communityToolsPanel.statusInstalled'), className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
    : tool.preInstalled
    ? { label: t('communityToolsPanel.statusSettingUp'), className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' }
    : { label: t('communityToolsPanel.statusNotInstalled'), className: 'bg-muted text-muted-foreground' };

  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      {/* Card Header */}
      <button
        type="button"
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-accent/50 transition-colors"
        onClick={onToggleExpand}
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{tool.name}</span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${typeBadge.className}`}>
              {typeBadge.label}
            </span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusBadge.className}`}>
              {statusBadge.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isInstalled && !polling && !tool.preInstalled && (
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={(e) => { e.stopPropagation(); handleInstall(); }}
              disabled={!!actionLoading}
            >
              {actionLoading === 'install' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {t('communityToolsPanel.install')}
            </button>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t px-5 py-4 space-y-4">
          {/* Action Buttons */}
          {isInstalled && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-accent transition-colors"
                onClick={handleDoctor}
                disabled={!!actionLoading || polling}
              >
                {actionLoading === 'doctor' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
                {t('communityToolsPanel.doctor')}
              </button>
              {!tool.preInstalled && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                  onClick={handleUninstall}
                  disabled={!!actionLoading || polling}
                >
                  {actionLoading === 'uninstall' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {t('communityToolsPanel.uninstall')}
                </button>
              )}
            </div>
          )}

          {/* Tool-specific detail */}
          {tool.type === 'claude-skill' && (
            <ClaudeSkillDetail tool={tool} isInstalled={isInstalled} />
          )}
          {tool.type === 'python-app' && isInstalled && (
            <PythonAppDetail
              tool={tool}
              configValues={configValues}
              onConfigChange={setConfigValues}
              onSaveConfig={handleSaveConfig}
              onOpenTerminal={handleOpenTerminal}
              actionLoading={actionLoading}
              polling={polling}
            />
          )}
          {tool.type === 'python-app' && isInstalled && (
            <ResultsViewer toolId={tool.id} />
          )}

          {/* Doctor results */}
          {doctorResults && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('communityToolsPanel.doctorResults')}</h4>
              <div className="space-y-1">
                {doctorResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {r.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-destructive" />}
                    <span className={r.ok ? 'text-foreground' : 'text-destructive'}>{r.check}</span>
                    {r.message && <span className="text-muted-foreground">— {r.message}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Operation Log */}
          {logs.length > 0 && (
            <LogOutput title={t('communityToolsPanel.operationLog')} lines={logs} />
          )}

          {/* Info */}
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              {t('communityToolsPanel.repository')}: <a href={tool.repoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{tool.repoUrl}</a>
            </p>
            {tool.requirements.note && <p>{tool.requirements.note}</p>}
            {isInstalled && installedInfo && (
              <p>{t('communityToolsPanel.installedDate')}: {new Date(installedInfo.installedAt).toLocaleDateString()}</p>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Claude Skill Detail ──

function ClaudeSkillDetail({ tool, isInstalled }: { tool: RegistryTool; isInstalled: boolean }) {
  const { t } = useTranslation('common');
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('communityToolsPanel.availableCommands')}</h4>
      <div className="space-y-1.5">
        {tool.commands.map((cmd) => (
          <div key={cmd.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
            <code className="text-xs font-mono text-foreground flex-1">{cmd.name}</code>
            <span className="text-xs text-muted-foreground flex-1">{cmd.description}</span>
            {isInstalled && (
              <button
                type="button"
                className="p-1 rounded hover:bg-accent transition-colors"
                onClick={() => handleCopy(cmd.name)}
                title="Copy command"
              >
                {copied === cmd.name ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardCopy className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
            )}
          </div>
        ))}
      </div>
      {!isInstalled && (
        <p className="text-xs text-muted-foreground italic">{t('communityToolsPanel.installHint')}</p>
      )}
    </div>
  );
}

// ── Python App Detail ──

function PythonAppDetail({
  tool,
  configValues,
  onConfigChange,
  onSaveConfig,
  onOpenTerminal,
  actionLoading,
  polling,
}: {
  tool: RegistryTool;
  configValues: Record<string, string>;
  onConfigChange: (v: Record<string, string>) => void;
  onSaveConfig: () => void;
  onOpenTerminal: (command?: string) => void;
  actionLoading: string | null;
  polling: boolean;
}) {
  const { t } = useTranslation('common');
  const [showGuide, setShowGuide] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const currentProvider = configValues.llm_provider || '';
  const modelOptions = PROVIDER_MODEL_OPTIONS[currentProvider] || [];
  const hasModelOptions = modelOptions.length > 0;

  // Map registry recommendedProvider (e.g. 'claude') → config llm_provider key (e.g. 'anthropic')
  const registryProviderToConfigProvider: Record<string, string> = {
    claude: 'anthropic',
    codex: 'openai',
    gemini: 'gemini',
  };

  // Set recommended defaults when provider or model is empty
  useEffect(() => {
    const updates: Record<string, string> = { ...configValues };
    let changed = false;
    if (!configValues.llm_provider && tool.recommendedProvider) {
      updates.llm_provider = registryProviderToConfigProvider[tool.recommendedProvider] || tool.recommendedProvider;
      changed = true;
    }
    if (!configValues.model && tool.recommendedModel) {
      updates.model = tool.recommendedModel;
      changed = true;
    }
    if (!configValues.output_dir) {
      updates.output_dir = 'auto-research';
      changed = true;
    }
    if (!configValues.experiment_mode) {
      updates.experiment_mode = 'simulated';
      changed = true;
    }
    if (!configValues.project_mode) {
      updates.project_mode = 'full-auto';
      changed = true;
    }
    if (changed) onConfigChange(updates);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProviderChange = (newProvider: string) => {
    const updates: Record<string, string> = { ...configValues, llm_provider: newProvider };
    // Auto-set model to default for new provider if current model doesn't belong
    const newOptions = PROVIDER_MODEL_OPTIONS[newProvider] || [];
    if (newOptions.length > 0) {
      const currentModel = configValues.model || '';
      const modelValid = newOptions.some((o) => o.value === currentModel);
      if (!modelValid) {
        updates.model = PROVIDER_MODEL_DEFAULTS[newProvider] || newOptions[0].value;
      }
    }
    onConfigChange(updates);
  };

  return (
    <div className="space-y-4">
      {/* Guide */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-left"
          onClick={() => setShowGuide(!showGuide)}
        >
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
              {t('communityToolsPanel.guideTitle')}
            </span>
          </div>
          {showGuide ? <ChevronUp className="w-4 h-4 text-blue-400" /> : <ChevronDown className="w-4 h-4 text-blue-400" />}
        </button>
        {showGuide && (
          <div className="px-4 pb-3 space-y-2">
            <p className="text-xs text-blue-600 dark:text-blue-400">
              {t('communityToolsPanel.guideDescription')}
            </p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>{t('communityToolsPanel.guideStep1')}</li>
              <li>{t('communityToolsPanel.guideStep2')}</li>
              <li>{t('communityToolsPanel.guideStep3')}</li>
              <li>{t('communityToolsPanel.guideStep4')}</li>
              <li>{t('communityToolsPanel.guideStep5')}</li>
            </ol>
          </div>
        )}
      </div>

      {/* Configuration */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('communityToolsPanel.configuration')}</h4>

        {/* Research Topic — primary field */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">{t('communityToolsPanel.researchTopic')}</label>
          <textarea
            className="w-full min-h-[80px] px-3 py-2 text-sm rounded-lg border bg-background resize-y"
            placeholder={t('communityToolsPanel.researchTopicPlaceholder')}
            value={configValues.research_topic || ''}
            onChange={(e) => onConfigChange({ ...configValues, research_topic: e.target.value })}
          />
        </div>

        <div className="grid gap-2">
          {/* LLM Provider */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-32 flex-shrink-0">{t('communityToolsPanel.llmProvider')}</label>
            <select
              className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
              value={currentProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
            >
              <option value="">{t('communityToolsPanel.selectPlaceholder')}</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
            </select>
          </div>
          {/* API Key */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-32 flex-shrink-0">{t('communityToolsPanel.apiKey')}</label>
            <input
              type="password"
              className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
              placeholder={t('communityToolsPanel.apiKey')}
              value={configValues.api_key || ''}
              onChange={(e) => onConfigChange({ ...configValues, api_key: e.target.value })}
            />
          </div>
          {/* GitHub Token */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-32 flex-shrink-0">{t('communityToolsPanel.githubToken')}</label>
            <input
              type="password"
              className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
              placeholder="ghp_..."
              value={configValues.github_token || ''}
              onChange={(e) => onConfigChange({ ...configValues, github_token: e.target.value })}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/70 ml-[136px] -mt-1">
            {t('communityToolsPanel.githubTokenHint')}{' '}
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-primary/70 hover:text-primary"
            >
              github.com/settings/tokens
            </a>
          </p>
          {/* Model */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-32 flex-shrink-0">{t('communityToolsPanel.model')}</label>
            {hasModelOptions ? (
              <select
                className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                value={configValues.model || ''}
                onChange={(e) => onConfigChange({ ...configValues, model: e.target.value })}
              >
                <option value="">{t('communityToolsPanel.selectPlaceholder')}</option>
                {modelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                placeholder={t('communityToolsPanel.model')}
                value={configValues.model || ''}
                onChange={(e) => onConfigChange({ ...configValues, model: e.target.value })}
              />
            )}
          </div>
          {/* Run Mode */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-32 flex-shrink-0">{t('communityToolsPanel.projectMode')}</label>
            <select
              className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
              value={configValues.project_mode || 'full-auto'}
              onChange={(e) => onConfigChange({ ...configValues, project_mode: e.target.value })}
            >
              <option value="full-auto">{t('communityToolsPanel.projectModeFullAuto')}</option>
              <option value="semi-auto">{t('communityToolsPanel.projectModeSemiAuto')}</option>
            </select>
          </div>
        </div>

        {/* Advanced Settings */}
        <div className="rounded-lg border">
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent/50 transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span className="text-xs font-medium text-muted-foreground">{t('communityToolsPanel.advancedSettings')}</span>
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          {showAdvanced && (
            <div className="px-3 pb-3 grid gap-2">
              {/* Output Directory */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-32 flex-shrink-0">{t('communityToolsPanel.outputDir')}</label>
                <input
                  type="text"
                  className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                  placeholder="auto-research"
                  value={configValues.output_dir || ''}
                  onChange={(e) => onConfigChange({ ...configValues, output_dir: e.target.value })}
                />
              </div>
              {/* Experiment Mode */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-32 flex-shrink-0">{t('communityToolsPanel.experimentMode')}</label>
                <select
                  className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                  value={configValues.experiment_mode || 'simulated'}
                  onChange={(e) => onConfigChange({ ...configValues, experiment_mode: e.target.value })}
                >
                  <option value="simulated">{t('communityToolsPanel.experimentModeSimulated')}</option>
                  <option value="sandbox">{t('communityToolsPanel.experimentModeSandbox')}</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-accent transition-colors"
            onClick={onSaveConfig}
            disabled={!!actionLoading}
          >
            {actionLoading === 'config' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {t('communityToolsPanel.saveConfig')}
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-accent transition-colors"
            onClick={() => onOpenTerminal()}
          >
            <Terminal className="w-3.5 h-3.5" />
            {t('communityToolsPanel.openTerminal')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Results Viewer ──

type OutputNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: OutputNode[];
};

function ResultsViewer({ toolId }: { toolId: string }) {
  const { t } = useTranslation('common');
  const [tree, setTree] = useState<OutputNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.communityTools.outputs(toolId);
      if (res.ok) {
        const data = await res.json();
        setTree(data.tree || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [toolId]);

  useEffect(() => {
    if (open && tree.length === 0) fetchTree();
  }, [open, tree.length, fetchTree]);

  const handleViewFile = async (filePath: string) => {
    if (previewPath === filePath) { setPreviewPath(null); setPreviewContent(null); return; }
    setPreviewPath(filePath);
    setPreviewLoading(true);
    try {
      const res = await api.communityTools.readOutputFile(toolId, filePath);
      if (res.ok) {
        const data = await res.json();
        setPreviewContent(data.content);
      } else {
        setPreviewContent('Failed to load file.');
      }
    } catch { setPreviewContent('Failed to load file.'); }
    finally { setPreviewLoading(false); }
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath);
      return next;
    });
  };

  // Auto-expand the latest run (last artifacts/* dir)
  useEffect(() => {
    if (tree.length === 0) return;
    const autoExpand = new Set<string>();
    const artifactsDir = tree.find(n => n.name === 'artifacts' && n.type === 'dir');
    if (artifactsDir?.children?.length) {
      autoExpand.add(artifactsDir.path);
      const latestRun = artifactsDir.children[artifactsDir.children.length - 1];
      if (latestRun.type === 'dir') {
        autoExpand.add(latestRun.path);
        latestRun.children?.forEach(child => {
          if (child.type === 'dir') autoExpand.add(child.path);
        });
      }
    }
    if (autoExpand.size > 0) setExpandedDirs(autoExpand);
  }, [tree]);

  const renderNode = (node: OutputNode, depth: number) => {
    if (node.type === 'dir') {
      const isExpanded = expandedDirs.has(node.path);
      return (
        <div key={node.path}>
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left py-0.5 hover:bg-accent/50 rounded px-1 transition-colors"
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
            onClick={() => toggleDir(node.path)}
          >
            {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
            <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            <span className="text-xs text-foreground truncate">{node.name}</span>
          </button>
          {isExpanded && node.children?.map(child => renderNode(child, depth + 1))}
        </div>
      );
    }

    const isActive = previewPath === node.path;
    return (
      <button
        key={node.path}
        type="button"
        className={`flex items-center gap-1.5 w-full text-left py-0.5 rounded px-1 transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50'}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => handleViewFile(node.path)}
      >
        <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs truncate">{node.name}</span>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setOpen(!open)}
      >
        <Eye className="w-4 h-4 text-primary" />
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-1">
          {t('communityToolsPanel.resultsTitle')}
        </h4>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border hover:bg-accent transition-colors"
              onClick={fetchTree}
              disabled={loading}
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              {t('communityToolsPanel.resultsRefresh')}
            </button>
          </div>

          {loading && tree.length === 0 && (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t('communityToolsPanel.resultsLoading')}</span>
            </div>
          )}

          {!loading && tree.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-2">{t('communityToolsPanel.resultsEmpty')}</p>
          )}

          {tree.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              {/* File tree */}
              <div className="max-h-64 overflow-y-auto bg-muted/30 py-1">
                {tree.map(node => renderNode(node, 0))}
              </div>

              {/* File preview */}
              {previewPath && (
                <div className="border-t">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50">
                    <span className="text-[11px] font-mono text-muted-foreground truncate">{previewPath}</span>
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-accent transition-colors"
                      onClick={() => { setPreviewPath(null); setPreviewContent(null); }}
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground/80 bg-background">
                    {previewLoading ? (
                      <div className="flex items-center gap-2 py-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      </div>
                    ) : previewContent}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Log Output ──

function LogOutput({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h4>
      <div className="bg-muted/50 rounded-lg p-3 max-h-60 overflow-y-auto font-mono text-xs leading-5 whitespace-pre-wrap text-foreground/80">
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
