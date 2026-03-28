import { useState } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { LogIn, Server, Key } from 'lucide-react';
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

          {agent !== 'openrouter' && (
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
