import { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { LogIn, Server, Key, Cpu, RefreshCw, HardDrive, Zap, MonitorSpeaker } from 'lucide-react';
import SessionProviderLogo from '../SessionProviderLogo';
import { useTranslation } from 'react-i18next';
import { authenticatedFetch } from '../../utils/api';

const agentConfig = {
  claude: {
    name: 'Claude',
    description: 'Anthropic Claude AI assistant',
    cliCommand: 'claude',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    borderClass: 'border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-900 dark:text-blue-100',
    subtextClass: 'text-blue-700 dark:text-blue-300',
    buttonClass: 'bg-blue-600 hover:bg-blue-700',
  },
  cursor: {
    name: 'Cursor',
    description: 'Cursor AI-powered code editor',
    cliCommand: 'agent',
    bgClass: 'bg-purple-50 dark:bg-purple-900/20',
    borderClass: 'border-purple-200 dark:border-purple-800',
    textClass: 'text-purple-900 dark:text-purple-100',
    subtextClass: 'text-purple-700 dark:text-purple-300',
    buttonClass: 'bg-purple-600 hover:bg-purple-700',
  },
  codex: {
    name: 'Codex',
    description: 'OpenAI Codex AI assistant',
    cliCommand: 'codex',
    bgClass: 'bg-gray-100 dark:bg-gray-800/50',
    borderClass: 'border-gray-300 dark:border-gray-600',
    textClass: 'text-gray-900 dark:text-gray-100',
    subtextClass: 'text-gray-700 dark:text-gray-300',
    buttonClass: 'bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600',
  },
  gemini: {
    name: 'Gemini',
    description: 'Google Gemini AI CLI assistant',
    cliCommand: 'gemini',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    borderClass: 'border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-900 dark:text-blue-100',
    subtextClass: 'text-blue-700 dark:text-blue-300',
    buttonClass: 'bg-blue-600 hover:bg-blue-700',
  },
  openrouter: {
    name: 'OpenRouter',
    description: 'Route to any model via OpenRouter API',
    cliCommand: 'openrouter',
    bgClass: 'bg-violet-50 dark:bg-violet-900/20',
    borderClass: 'border-violet-200 dark:border-violet-800',
    textClass: 'text-violet-900 dark:text-violet-100',
    subtextClass: 'text-violet-700 dark:text-violet-300',
    buttonClass: 'bg-violet-600 hover:bg-violet-700',
  },
  local: {
    name: 'Local GPU',
    description: 'Run open-source models on your own GPU',
    cliCommand: null,
    bgClass: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    textClass: 'text-emerald-900 dark:text-emerald-100',
    subtextClass: 'text-emerald-700 dark:text-emerald-300',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-700',
  },
};

export default function AccountContent({ agent, authStatus, onLogin }) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent];
  const cliMissing = authStatus?.cliAvailable === false;
  const installHint = authStatus?.installHint;

  const [customApiUrl, setCustomApiUrl] = useState('');
  const [customApiToken, setCustomApiToken] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [isVerifyingOpenRouter, setIsVerifyingOpenRouter] = useState(false);
  const [openrouterVerifyResult, setOpenrouterVerifyResult] = useState(null);

  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [isVerifyingOpenAI, setIsVerifyingOpenAI] = useState(false);
  const [openaiVerifyResult, setOpenaiVerifyResult] = useState(null);

  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [isVerifyingGemini, setIsVerifyingGemini] = useState(false);
  const [geminiVerifyResult, setGeminiVerifyResult] = useState(null);

  const [gpuInfo, setGpuInfo] = useState(null);
  const [isDetectingGpu, setIsDetectingGpu] = useState(false);
  const [gpuError, setGpuError] = useState(null);
  const [selectedGpu, setSelectedGpu] = useState(() =>
    localStorage.getItem('local-gpu-selected') || ''
  );
  const [localServerUrl, setLocalServerUrl] = useState(() => {
    const saved = localStorage.getItem('local-gpu-server-url');
    if (saved === 'http://localhost:8000') {
      localStorage.setItem('local-gpu-server-url', 'http://localhost:11434');
      return 'http://localhost:11434';
    }
    return saved || 'http://localhost:11434';
  });
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState(null);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [ollamaModelsError, setOllamaModelsError] = useState(null);
  const [pullModelName, setPullModelName] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullResult, setPullResult] = useState(null);

  const handleDetectGpus = useCallback(async () => {
    setIsDetectingGpu(true);
    setGpuError(null);
    try {
      const res = await authenticatedFetch('/api/cli/local/gpu-info');
      const data = await res.json();
      if (res.ok && data.gpus) {
        setGpuInfo(data);
        if (data.gpus.length > 0 && !selectedGpu) {
          setSelectedGpu(data.gpus[0].id);
          localStorage.setItem('local-gpu-selected', data.gpus[0].id);
        }
      } else {
        setGpuError(data.error || 'Could not detect GPUs');
      }
    } catch (err) {
      const isNetwork =
        err?.name === 'TypeError' && String(err?.message || '').toLowerCase().includes('fetch');
      setGpuError(
        isNetwork
          ? t('agents.account.local.gpuDetectNetworkError')
          : t('agents.account.local.gpuDetectFailed'),
      );
      console.warn('[AccountContent] GPU detection failed', err);
    } finally {
      setIsDetectingGpu(false);
    }
  }, [selectedGpu, t]);

  const handleLoadOllamaModels = useCallback(async () => {
    setIsLoadingModels(true);
    setOllamaModelsError(null);
    try {
      const res = await authenticatedFetch(`/api/cli/local/models?serverUrl=${encodeURIComponent(localServerUrl)}`);
      const data = await res.json();
      if (res.ok && data.models) {
        setOllamaModels(data.models);
        if (data.hasGpu && data.models.length > 0) {
          const smallModels = data.models.filter(m => m.sizeB && m.sizeB <= 14);
          if (smallModels.length > 0 && !localStorage.getItem('local-model')) {
            localStorage.setItem('local-model', smallModels[0].name);
          }
        }
      } else {
        setOllamaModels([]);
        setOllamaModelsError(data.error || t('agents.account.local.ollamaModelsLoadFailed'));
      }
    } catch (err) {
      setOllamaModels([]);
      setOllamaModelsError(t('agents.account.local.ollamaModelsNetworkError'));
      console.warn('[AccountContent] Ollama models load failed', err);
    }
    setIsLoadingModels(false);
  }, [localServerUrl, t]);

  useEffect(() => {
    if (agent === 'local') {
      handleDetectGpus();
      handleLoadOllamaModels();
    }
  }, [agent, handleDetectGpus, handleLoadOllamaModels]);

  const handleSaveLocalConfig = async () => {
    localStorage.setItem('local-gpu-selected', selectedGpu);
    try {
      const res = await authenticatedFetch('/api/cli/local/save-config', {
        method: 'POST',
        body: JSON.stringify({ serverUrl: localServerUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeployResult({
          success: false,
          message: data.error || 'Could not save configuration.',
        });
        return;
      }
      localStorage.setItem('local-gpu-server-url', localServerUrl);
      setDeployResult({ success: true, message: 'Configuration saved.' });
      handleLoadOllamaModels();
      if (typeof onLogin === 'function') onLogin();
    } catch (err) {
      setDeployResult({
        success: false,
        message: t('agents.account.local.ollamaModelsNetworkError'),
      });
      console.warn('[AccountContent] save local GPU config failed', err);
    }
  };

  const handleTestConnection = async () => {
    setIsDeploying(true);
    setDeployResult(null);
    try {
      const res = await authenticatedFetch(`/api/cli/local/models?serverUrl=${encodeURIComponent(localServerUrl)}`);
      const data = await res.json();
      if (res.ok && data.models) {
        setOllamaModels(data.models);
        setDeployResult({
          success: true,
          message: `Connected! Ollama has ${data.models.length} model${data.models.length !== 1 ? 's' : ''} available.${data.hasGpu ? ' GPU detected.' : ''}`,
        });
      } else {
        setDeployResult({ success: false, message: data.error || 'Could not connect' });
      }
    } catch (err) {
      setDeployResult({
        success: false,
        message: `Cannot reach Ollama at ${localServerUrl}. Run: ollama serve`,
      });
    } finally {
      setIsDeploying(false);
      if (typeof onLogin === 'function') onLogin();
    }
  };

  const handlePullModel = async () => {
    if (!pullModelName.trim()) return;
    setIsPulling(true);
    setPullResult(null);
    try {
      const res = await authenticatedFetch('/api/cli/local/pull-model', {
        method: 'POST',
        body: JSON.stringify({ modelName: pullModelName.trim(), serverUrl: localServerUrl }),
      });
      const data = await res.json();
      if (res.ok) {
        setPullResult({ success: true, message: data.message || `Pulled "${pullModelName}" successfully.` });
        setPullModelName('');
        handleLoadOllamaModels();
      } else {
        setPullResult({ success: false, message: data.error || 'Failed to pull model' });
      }
    } catch (err) {
      setPullResult({ success: false, message: err.message });
    } finally {
      setIsPulling(false);
      if (typeof onLogin === 'function') onLogin();
    }
  };

  const handleVerifyCustomApi = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const res = await authenticatedFetch('/api/cli/claude/verify-custom-api', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl: customApiUrl.trim() || undefined,
          token: customApiToken.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setVerifyResult({ success: true, message: data.message || 'Custom API verified and applied.' });
      } else {
        setVerifyResult({ success: false, message: data.error || 'Verification failed' });
      }
    } catch (err) {
      setVerifyResult({ success: false, message: err.message });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerifyOpenRouterKey = async () => {
    setIsVerifyingOpenRouter(true);
    setOpenrouterVerifyResult(null);
    try {
      const res = await authenticatedFetch('/api/cli/openrouter/verify-api-key', {
        method: 'POST',
        body: JSON.stringify({ apiKey: openrouterApiKey.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setOpenrouterVerifyResult({ success: true, message: data.message || 'API key verified and saved.' });
        setOpenrouterApiKey('');
      } else {
        setOpenrouterVerifyResult({ success: false, message: data.error || 'Invalid API key' });
      }
    } catch (err) {
      setOpenrouterVerifyResult({ success: false, message: err.message });
    } finally {
      setIsVerifyingOpenRouter(false);
    }
  };

  const handleVerifyOpenAIKey = async () => {
    setIsVerifyingOpenAI(true);
    setOpenaiVerifyResult(null);
    try {
      const res = await authenticatedFetch('/api/cli/codex/verify-api-key', {
        method: 'POST',
        body: JSON.stringify({ apiKey: openaiApiKey.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setOpenaiVerifyResult({ success: true, message: data.message || 'API key verified and saved.' });
        setOpenaiApiKey('');
      } else {
        setOpenaiVerifyResult({ success: false, message: data.error || 'Invalid API key' });
      }
    } catch (err) {
      setOpenaiVerifyResult({ success: false, message: err.message });
    } finally {
      setIsVerifyingOpenAI(false);
    }
  };

  const handleVerifyGeminiKey = async () => {
    setIsVerifyingGemini(true);
    setGeminiVerifyResult(null);
    try {
      const res = await authenticatedFetch('/api/cli/gemini/verify-api-key', {
        method: 'POST',
        body: JSON.stringify({ apiKey: geminiApiKey.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setGeminiVerifyResult({ success: true, message: data.message || 'API key verified and saved.' });
        setGeminiApiKey('');
      } else {
        setGeminiVerifyResult({ success: false, message: data.error || 'Invalid API key' });
      }
    } catch (err) {
      setGeminiVerifyResult({ success: false, message: err.message });
    } finally {
      setIsVerifyingGemini(false);
    }
  };

  if (!config) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <SessionProviderLogo provider={agent} className="w-6 h-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{config.name}</h3>
          <p className="text-sm text-muted-foreground">{t(`agents.account.${agent}.description`)}</p>
        </div>
      </div>

      <div className={`${config.bgClass} border ${config.borderClass} rounded-lg p-4`}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className={`font-medium ${config.textClass}`}>
                {t('agents.connectionStatus')}
              </div>
              <div className={`text-sm ${config.subtextClass}`}>
                {authStatus?.loading ? (
                  t('agents.authStatus.checkingAuth')
                ) : cliMissing ? (
                  t('agents.authStatus.cliMissing', { command: authStatus?.cliCommand || config.cliCommand })
                ) : authStatus?.authenticated ? (
                  t('agents.authStatus.loggedInAs', { email: authStatus.email || t('agents.authStatus.authenticatedUser') })
                ) : (
                  t('agents.authStatus.notConnected')
                )}
              </div>
            </div>
            <div>
              {authStatus?.loading ? (
                <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800">
                  {t('agents.authStatus.checking')}
                </Badge>
              ) : cliMissing ? (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {t('agents.authStatus.installRequired')}
                </Badge>
              ) : authStatus?.authenticated ? (
                <Badge variant="success" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  {t('agents.authStatus.connected')}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                  {t('agents.authStatus.disconnected')}
                </Badge>
              )}
            </div>
          </div>

          {agent !== 'openrouter' && agent !== 'local' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className={`font-medium ${config.textClass}`}>
                    {authStatus?.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
                  </div>
                  <div className={`text-sm ${config.subtextClass}`}>
                    {authStatus?.authenticated
                      ? t('agents.login.reAuthDescription')
                      : cliMissing
                        ? t('agents.login.installDescription', { agent: config.name })
                      : t('agents.login.description', { agent: config.name })}
                  </div>
                </div>
                <Button
                  onClick={onLogin}
                  className={`${config.buttonClass} text-white`}
                  size="sm"
                  disabled={authStatus?.loading || cliMissing}
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  {authStatus?.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
                </Button>
              </div>
            </div>
          )}

          {cliMissing && installHint && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="font-medium">{t('agents.install.title')}</div>
                <div className="mt-1">{installHint}</div>
                <div className="mt-2 font-mono text-xs">{authStatus?.cliCommand || config.cliCommand}</div>
              </div>
            </div>
          )}

          {agent === 'claude' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Server className="w-4 h-4 text-gray-500" />
                <div className="font-medium text-gray-900 dark:text-gray-100">Custom API Config</div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1">API Base URL</label>
                  <Input
                    placeholder="https://api.anthropic.com (default)"
                    value={customApiUrl}
                    onChange={e => setCustomApiUrl(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1 flex items-center gap-1">
                    <Key className="w-3.5 h-3.5" /> API Token
                  </label>
                  <Input
                    type="password"
                    placeholder="sk-ant-..."
                    value={customApiToken}
                    onChange={e => setCustomApiToken(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleVerifyCustomApi}
                  disabled={isVerifying || !customApiToken.trim()}
                  size="sm"
                  variant="outline"
                  className="w-full"
                >
                  {isVerifying ? 'Verifying...' : 'Verify & Save'}
                </Button>
                {verifyResult && (
                  <div className={`text-sm ${verifyResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {verifyResult.message}
                  </div>
                )}
              </div>
            </div>
          )}

          {agent === 'codex' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-4 h-4 text-gray-500" />
                <div className={`font-medium ${config.textClass}`}>OpenAI API Key</div>
              </div>
              <p className={`text-sm ${config.subtextClass} mb-3`}>
                {authStatus?.authenticated
                  ? 'Your API key is configured. Enter a new key below to replace it.'
                  : 'Enter your OpenAI API key to use Codex. Get one at platform.openai.com/api-keys.'}
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1 flex items-center gap-1">
                    <Key className="w-3.5 h-3.5" /> API Key
                  </label>
                  <Input
                    type="password"
                    placeholder="sk-..."
                    value={openaiApiKey}
                    onChange={e => setOpenaiApiKey(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleVerifyOpenAIKey}
                  disabled={isVerifyingOpenAI || !openaiApiKey.trim()}
                  size="sm"
                  className={`${config.buttonClass} text-white w-full`}
                >
                  {isVerifyingOpenAI ? 'Verifying...' : 'Verify & Save Key'}
                </Button>
                {openaiVerifyResult && (
                  <div className={`text-sm ${openaiVerifyResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {openaiVerifyResult.message}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-2">
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                    Get an API key at platform.openai.com
                  </a>
                  {' · '}
                  <span>Used for Codex agent and voice transcription.</span>
                </div>
              </div>
            </div>
          )}

          {agent === 'gemini' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-4 h-4 text-blue-500" />
                <div className={`font-medium ${config.textClass}`}>Google API Key</div>
              </div>
              <p className={`text-sm ${config.subtextClass} mb-3`}>
                {authStatus?.authenticated
                  ? 'Your API key is configured. Enter a new key below to replace it.'
                  : 'Enter your Google API key to use Gemini. Get one at aistudio.google.com/apikey.'}
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1 flex items-center gap-1">
                    <Key className="w-3.5 h-3.5" /> API Key
                  </label>
                  <Input
                    type="password"
                    placeholder="AIza..."
                    value={geminiApiKey}
                    onChange={e => setGeminiApiKey(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleVerifyGeminiKey}
                  disabled={isVerifyingGemini || !geminiApiKey.trim()}
                  size="sm"
                  className={`${config.buttonClass} text-white w-full`}
                >
                  {isVerifyingGemini ? 'Verifying...' : 'Verify & Save Key'}
                </Button>
                {geminiVerifyResult && (
                  <div className={`text-sm ${geminiVerifyResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {geminiVerifyResult.message}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-2">
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                    Get an API key at aistudio.google.com
                  </a>
                  {' · '}
                  <span>Used for Gemini CLI agent.</span>
                </div>
              </div>
            </div>
          )}

          {agent === 'openrouter' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-4 h-4 text-violet-500" />
                <div className={`font-medium ${config.textClass}`}>API Key Configuration</div>
              </div>
              <p className={`text-sm ${config.subtextClass} mb-3`}>
                {authStatus?.authenticated
                  ? 'Your API key is configured. Enter a new key below to replace it.'
                  : 'Enter your OpenRouter API key to connect. Get one at openrouter.ai/keys.'}
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1 flex items-center gap-1">
                    <Key className="w-3.5 h-3.5" /> OpenRouter API Key
                  </label>
                  <Input
                    type="password"
                    placeholder="sk-or-..."
                    value={openrouterApiKey}
                    onChange={e => setOpenrouterApiKey(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleVerifyOpenRouterKey}
                  disabled={isVerifyingOpenRouter || !openrouterApiKey.trim()}
                  size="sm"
                  className={`${config.buttonClass} text-white w-full`}
                >
                  {isVerifyingOpenRouter ? 'Verifying...' : 'Verify & Save Key'}
                </Button>
                {openrouterVerifyResult && (
                  <div className={`text-sm ${openrouterVerifyResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {openrouterVerifyResult.message}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-2">
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                    Get an API key at openrouter.ai/keys
                  </a>
                  {' · '}
                  <span>Supports 200+ models including GPT-5, Claude, Gemini, DeepSeek, Llama, and more.</span>
                </div>
              </div>
            </div>
          )}

          {agent === 'local' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-5">
              {/* GPU Detection */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-emerald-500" />
                    <div className={`font-medium ${config.textClass}`}>GPU Resources</div>
                  </div>
                  <Button
                    onClick={handleDetectGpus}
                    disabled={isDetectingGpu}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                  >
                    <RefreshCw className={`w-3 h-3 mr-1.5 ${isDetectingGpu ? 'animate-spin' : ''}`} />
                    {isDetectingGpu ? 'Detecting...' : 'Detect GPUs'}
                  </Button>
                </div>

                {gpuError && !gpuInfo && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <MonitorSpeaker className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-xs">No GPU info available</p>
                        <p className="text-xs mt-1 opacity-80">{gpuError}</p>
                      </div>
                    </div>
                  </div>
                )}

                {gpuInfo && gpuInfo.gpus && gpuInfo.gpus.length > 0 && (
                  <div className="space-y-2">
                    {gpuInfo.gpus.map((gpu, idx) => (
                      <label
                        key={gpu.id || idx}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedGpu === (gpu.id || String(idx))
                            ? 'border-emerald-400 bg-emerald-50/50 dark:border-emerald-600 dark:bg-emerald-900/20 ring-1 ring-emerald-400/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <input
                          type="radio"
                          name="gpu-select"
                          value={gpu.id || String(idx)}
                          checked={selectedGpu === (gpu.id || String(idx))}
                          onChange={(e) => {
                            setSelectedGpu(e.target.value);
                            localStorage.setItem('local-gpu-selected', e.target.value);
                          }}
                          className="sr-only"
                        />
                        <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                          selectedGpu === (gpu.id || String(idx))
                            ? 'border-emerald-500'
                            : 'border-gray-400'
                        }`}>
                          {selectedGpu === (gpu.id || String(idx)) && (
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          )}
                        </div>
                        <Zap className="w-4 h-4 text-emerald-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{gpu.name}</div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            {gpu.memory && (
                              <span className="flex items-center gap-1">
                                <HardDrive className="w-3 h-3" />
                                {gpu.memory}
                              </span>
                            )}
                            {gpu.utilization !== undefined && (
                              <span>Util: {gpu.utilization}%</span>
                            )}
                            {gpu.temperature !== undefined && (
                              <span>{gpu.temperature}°C</span>
                            )}
                          </div>
                        </div>
                      </label>
                    ))}
                    {gpuInfo.system && (
                      <div className="text-xs text-muted-foreground px-1 pt-1">
                        {gpuInfo.system.driver && <span>Driver: {gpuInfo.system.driver}</span>}
                        {gpuInfo.system.cuda && <span className="ml-3">CUDA: {gpuInfo.system.cuda}</span>}
                      </div>
                    )}
                  </div>
                )}

                {gpuInfo && gpuInfo.gpus && gpuInfo.gpus.length === 0 && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 text-sm text-muted-foreground">
                    No GPUs detected on this machine. Models will run on CPU.
                  </div>
                )}
              </div>

              {/* Ollama Server */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Server className="w-4 h-4 text-emerald-500" />
                  <div className={`font-medium ${config.textClass}`}>Ollama Server</div>
                </div>
                <p className={`text-sm ${config.subtextClass} mb-3`}>
                  Connect to Ollama to run open-source models locally.
                  {gpuInfo?.gpus?.length > 0 && ' GPU-accelerated models ≤14B will be auto-selected.'}
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1">Server URL</label>
                    <Input
                      placeholder="http://localhost:11434"
                      value={localServerUrl}
                      onChange={e => setLocalServerUrl(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleTestConnection}
                      disabled={isDeploying || !localServerUrl.trim()}
                      size="sm"
                      variant="outline"
                      className="flex-1"
                    >
                      {isDeploying ? 'Testing...' : 'Test Connection'}
                    </Button>
                    <Button
                      onClick={handleSaveLocalConfig}
                      size="sm"
                      className={`${config.buttonClass} text-white flex-1`}
                    >
                      Save & Refresh
                    </Button>
                  </div>
                  {deployResult && (
                    <div className={`text-sm ${deployResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {deployResult.message}
                    </div>
                  )}
                </div>
              </div>

              {/* Installed Models */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-500" />
                    <div className={`font-medium ${config.textClass}`}>Installed Models</div>
                  </div>
                  <Button
                    onClick={handleLoadOllamaModels}
                    disabled={isLoadingModels}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                  >
                    <RefreshCw className={`w-3 h-3 mr-1.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>

                {ollamaModelsError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200 mb-3">
                    {ollamaModelsError}
                  </div>
                )}

                {ollamaModels.length > 0 ? (
                  <div className="space-y-1.5">
                    {ollamaModels.map((m) => {
                      const currentModel = localStorage.getItem('local-model') || '';
                      const isSelected = currentModel === m.name;
                      const isSmall = m.sizeB && m.sizeB <= 14;
                      return (
                        <button
                          key={m.name}
                          onClick={() => {
                            localStorage.setItem('local-model', m.name);
                            setDeployResult({ success: true, message: `Selected model: ${m.name}` });
                          }}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                            isSelected
                              ? 'border-emerald-400 bg-emerald-50/50 dark:border-emerald-600 dark:bg-emerald-900/20 ring-1 ring-emerald-400/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                              <span className="text-sm font-medium text-foreground">{m.displayName || m.name}</span>
                              {m.quantization && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-muted-foreground">
                                  {m.quantization}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {m.size && <span>{m.size}</span>}
                              {isSmall && gpuInfo?.gpus?.length > 0 && (
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">GPU OK</span>
                              )}
                            </div>
                          </div>
                          {m.family && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 pl-4">{m.family}</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-3 text-sm text-muted-foreground text-center">
                    {isLoadingModels ? 'Loading models...' : 'No models found. Pull a model below or run: ollama pull qwen3:8b'}
                  </div>
                )}
              </div>

              {/* Pull New Model */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <HardDrive className="w-4 h-4 text-emerald-500" />
                  <div className={`font-medium ${config.textClass}`}>Pull New Model</div>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. qwen3:8b, llama3.2, deepseek-r1:7b"
                      value={pullModelName}
                      onChange={e => setPullModelName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handlePullModel(); }}
                      className="flex-1"
                    />
                    <Button
                      onClick={handlePullModel}
                      disabled={isPulling || !pullModelName.trim()}
                      size="sm"
                      className={`${config.buttonClass} text-white`}
                    >
                      {isPulling ? 'Pulling...' : 'Pull'}
                    </Button>
                  </div>
                  {pullResult && (
                    <div className={`text-sm ${pullResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {pullResult.message}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p className="font-medium">Recommended models for GPU ≤14B:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['qwen3:8b', 'llama3.2:latest', 'deepseek-r1:7b', 'gemma3:12b', 'phi4:latest', 'codestral:latest'].map(name => (
                        <button
                          key={name}
                          onClick={() => setPullModelName(name)}
                          className="text-[10px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2">
                      <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                        Browse all models at ollama.com/library
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {authStatus?.error && !cliMissing && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-sm text-red-600 dark:text-red-400">
                {t('agents.error', { error: authStatus.error })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
