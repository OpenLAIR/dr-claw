import { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Loader2,
  Play,
  X,
} from 'lucide-react';
import { api } from '../utils/api';
import { CLAUDE_MODELS, CODEX_MODELS, GEMINI_MODELS } from '../../shared/modelConstants';

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

const REGISTRY_PROVIDER_MAP: Record<string, string> = {
  claude: 'anthropic',
  codex: 'openai',
  gemini: 'gemini',
};

type RunConfigModalProps = {
  toolId: string;
  toolName: string;
  recommendedProvider?: string;
  recommendedModel?: string;
  onClose: () => void;
  onStarted: () => void;
};

export default function RunConfigModal({
  toolId,
  toolName,
  recommendedProvider,
  recommendedModel,
  onClose,
  onStarted,
}: RunConfigModalProps) {
  const { t } = useTranslation('common');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load existing config from server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.communityTools.installed();
        if (!res.ok) return;
        const data = await res.json();
        const info = (data.tools || {})[toolId];
        const saved = info?.config || {};

        // Apply defaults
        const defaults: Record<string, string> = {
          llm_provider: REGISTRY_PROVIDER_MAP[recommendedProvider || ''] || 'anthropic',
          model: recommendedModel || 'claude-opus-4-6',
          output_dir: 'auto-research',
          experiment_mode: 'simulated',
          project_mode: 'full-auto',
        };

        if (!cancelled) {
          setConfig({ ...defaults, ...saved });
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [toolId, recommendedProvider, recommendedModel]);

  const currentProvider = config.llm_provider || '';
  const modelOptions = PROVIDER_MODEL_OPTIONS[currentProvider] || [];
  const hasModelOptions = modelOptions.length > 0;

  const handleProviderChange = useCallback((newProvider: string) => {
    setConfig((prev) => {
      const newOptions = PROVIDER_MODEL_OPTIONS[newProvider] || [];
      const modelValid = newOptions.some((o) => o.value === prev.model);
      return {
        ...prev,
        llm_provider: newProvider,
        model: modelValid ? prev.model : (PROVIDER_MODEL_DEFAULTS[newProvider] || newOptions[0]?.value || ''),
      };
    });
  }, []);

  const handleLaunch = async () => {
    if (!config.research_topic?.trim()) return;
    setLaunching(true);
    setError(null);

    try {
      // 1. Save configuration
      const cfgRes = await api.communityTools.configure(toolId, config);
      if (!cfgRes.ok) {
        const err = await cfgRes.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to save configuration');
      }

      // 2. Start the run
      const runRes = await api.communityTools.run(toolId, 'run', []);
      if (!runRes.ok) {
        const err = await runRes.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to start run');
      }

      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLaunching(false);
    }
  };

  const canLaunch = !!(config.research_topic?.trim());

  const content = (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm md:p-6"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              {toolName}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={launching}
            className="p-1 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 space-y-4 max-h-[60vh]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* Research Topic */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  {t('communityToolsPanel.researchTopic')} *
                </label>
                <textarea
                  className="w-full min-h-[80px] px-3 py-2 text-sm rounded-lg border bg-background resize-y focus:border-primary focus:outline-none"
                  placeholder={t('communityToolsPanel.researchTopicPlaceholder')}
                  value={config.research_topic || ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, research_topic: e.target.value }))}
                  disabled={launching}
                />
              </div>

              {/* LLM Provider */}
              <div className="grid gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-28 flex-shrink-0">
                    {t('communityToolsPanel.llmProvider')}
                  </label>
                  <select
                    className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                    value={currentProvider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    disabled={launching}
                  >
                    <option value="">Select...</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </div>

                {/* API Key */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-28 flex-shrink-0">
                    {t('communityToolsPanel.apiKey')}
                  </label>
                  <input
                    type="password"
                    className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                    placeholder={t('communityToolsPanel.apiKey')}
                    value={config.api_key || ''}
                    onChange={(e) => setConfig((prev) => ({ ...prev, api_key: e.target.value }))}
                    disabled={launching}
                  />
                </div>

                {/* Model */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-28 flex-shrink-0">
                    {t('communityToolsPanel.model')}
                  </label>
                  {hasModelOptions ? (
                    <select
                      className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                      value={config.model || ''}
                      onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
                      disabled={launching}
                    >
                      <option value="">Select...</option>
                      {modelOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                      placeholder={t('communityToolsPanel.model')}
                      value={config.model || ''}
                      onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
                      disabled={launching}
                    />
                  )}
                </div>

                {/* Run Mode */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-28 flex-shrink-0">
                    {t('communityToolsPanel.projectMode')}
                  </label>
                  <select
                    className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                    value={config.project_mode || 'full-auto'}
                    onChange={(e) => setConfig((prev) => ({ ...prev, project_mode: e.target.value }))}
                    disabled={launching}
                  >
                    <option value="full-auto">{t('communityToolsPanel.projectModeFullAuto')}</option>
                    <option value="semi-auto">{t('communityToolsPanel.projectModeSemiAuto')}</option>
                  </select>
                </div>
              </div>

              {/* Advanced */}
              <div className="rounded-lg border">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent/50 transition-colors"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('communityToolsPanel.advancedSettings')}
                  </span>
                  {showAdvanced ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                {showAdvanced && (
                  <div className="px-3 pb-3 grid gap-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground w-28 flex-shrink-0">
                        {t('communityToolsPanel.outputDir')}
                      </label>
                      <input
                        type="text"
                        className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                        placeholder="auto-research"
                        value={config.output_dir || ''}
                        onChange={(e) => setConfig((prev) => ({ ...prev, output_dir: e.target.value }))}
                        disabled={launching}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground w-28 flex-shrink-0">
                        {t('communityToolsPanel.experimentMode')}
                      </label>
                      <select
                        className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                        value={config.experiment_mode || 'simulated'}
                        onChange={(e) => setConfig((prev) => ({ ...prev, experiment_mode: e.target.value }))}
                        disabled={launching}
                      >
                        <option value="simulated">{t('communityToolsPanel.experimentModeSimulated')}</option>
                        <option value="sandbox">{t('communityToolsPanel.experimentModeSandbox')}</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={launching}
            className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-accent transition-colors text-muted-foreground"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={!canLaunch || launching || loading}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {launching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {launching ? 'Starting...' : 'Start Run'}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
