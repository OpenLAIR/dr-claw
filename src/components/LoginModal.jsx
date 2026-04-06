import { useMemo, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Wrench, X } from 'lucide-react';
import StandaloneShell from './StandaloneShell';
import { authenticatedFetch } from '../utils/api';
import { IS_PLATFORM } from '../constants/config';
import { useDesktop } from '../hooks/useDesktop';

function LoginModal({
  isOpen,
  onClose,
  provider = 'claude',
  project,
  onComplete,
  onStatusRefresh,
  customCommand,
  isAuthenticated = false,
  isOnboarding = false,
  cliAvailable = true,
  installHint = null,
  installable = false,
  installerAvailable = true,
  installerHint = null,
  docsUrl = null,
  downloadUrl = null,
}) {
  const { openExternal: desktopOpenExternal } = useDesktop();
  const [isInstalling, setIsInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState('');
  const [installOutput, setInstallOutput] = useState('');

  const providerLabel = useMemo(() => {
    switch (provider) {
      case 'claude':
        return 'Claude CLI';
      case 'cursor':
        return 'Cursor CLI';
      case 'codex':
        return 'Codex CLI';
      case 'gemini':
        return 'Gemini CLI';
      default:
        return 'CLI';
    }
  }, [provider]);

  if (!isOpen) return null;

  const getTitle = () => {
    switch (provider) {
      case 'claude':
        return 'Claude CLI Login';
      case 'cursor':
        return 'Cursor CLI Login';
      case 'codex':
        return 'Codex CLI Login';
      case 'gemini':
        return 'Gemini CLI Login';
      default:
        return 'CLI Login';
    }
  };

  const getCommand = () => {
    if (customCommand) return customCommand;

    switch (provider) {
      case 'claude':
        return isAuthenticated
          ? 'claude --dangerously-skip-permissions setup-token'
          : isOnboarding
            ? 'claude --dangerously-skip-permissions /exit'
            : 'claude --dangerously-skip-permissions /login';
      case 'cursor':
        return 'agent login';
      case 'codex':
        return IS_PLATFORM ? 'codex login --device-auth' : 'codex login';
      case 'gemini':
        return 'gemini /quit';
      default:
        return isAuthenticated
          ? 'claude --dangerously-skip-permissions setup-token'
          : isOnboarding
            ? 'claude --dangerously-skip-permissions /exit'
            : 'claude --dangerously-skip-permissions /login';
    }
  };

  const handleComplete = (exitCode) => {
    if (onComplete) {
      onComplete(exitCode);
    }

    if (exitCode === 0) {
      setTimeout(() => {
        onClose();
      }, 1000);
    }
  };

  const handleOpenExternal = async (url) => {
    if (!url) {
      return;
    }

    desktopOpenExternal(url);
  };

  const handleRefresh = async () => {
    setInstallMessage('');
    setInstallOutput('');
    await onStatusRefresh?.();
  };

  const handleInstall = async () => {
    setIsInstalling(true);
    setInstallMessage('Installing CLI...');
    setInstallOutput('');

    try {
      const response = await authenticatedFetch(`/api/cli/install/${provider}`, {
        method: 'POST',
      });
      const data = await response.json();

      setInstallOutput([data.stdout, data.stderr].filter(Boolean).join('\n\n'));

      if (response.ok && data?.status?.cliAvailable !== false) {
        setInstallMessage('Installation finished. Rechecking CLI status...');
      } else {
        setInstallMessage(data.error || 'Installation failed. You can retry or open the official download page.');
      }

      await onStatusRefresh?.();
    } catch (error) {
      setInstallMessage(error.message || 'Installation failed.');
    } finally {
      setIsInstalling(false);
    }
  };

  if (!cliAvailable) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] max-md:items-stretch max-md:justify-stretch">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg flex flex-col md:rounded-lg md:m-4 max-md:max-w-none max-md:h-full max-md:rounded-none max-md:m-0">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {getTitle()}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="Close login modal"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              {installHint || 'Required CLI is not installed. Install it first, then retry login.'}
            </div>

            {installMessage && (
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground whitespace-pre-wrap">
                {installMessage}
              </div>
            )}

            {installOutput && (
              <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-slate-950 px-4 py-3 text-xs text-slate-100 whitespace-pre-wrap">
                {installOutput}
              </pre>
            )}

            <div className="flex flex-wrap gap-3">
              {installable && installerAvailable && (
                <button
                  onClick={handleInstall}
                  disabled={isInstalling}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {isInstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                  {isInstalling ? 'Installing...' : `Install ${providerLabel}`}
                </button>
              )}

              <button
                onClick={handleRefresh}
                disabled={isInstalling}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                <RefreshCw className="w-4 h-4" />
                Recheck
              </button>

              {(downloadUrl || docsUrl) && (
                <button
                  onClick={() => handleOpenExternal(downloadUrl || docsUrl)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Official Guide
                </button>
              )}
            </div>

            {installerHint && (
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground whitespace-pre-wrap">
                {installerHint}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] max-md:items-stretch max-md:justify-stretch">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl h-3/4 flex flex-col md:max-w-4xl md:h-3/4 md:rounded-lg md:m-4 max-md:max-w-none max-md:h-full max-md:rounded-none max-md:m-0">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {getTitle()}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close login modal"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <StandaloneShell
            project={project}
            command={getCommand()}
            onComplete={handleComplete}
            minimal={true}
          />
        </div>
      </div>
    </div>
  );
}

export default LoginModal;
