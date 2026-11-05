import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import WorkbenchDialog from './ui/WorkbenchDialog';
import { Button } from './ui/button';
import { ExternalLink, Loader2, RefreshCw, Wrench } from 'lucide-react';
import LazyLoadBoundary from './LazyLoadBoundary';
import lazyWithRetry from '../utils/lazyWithRetry';
import { authenticatedFetch } from '../utils/api';
import { IS_PLATFORM } from '../constants/config';
import { useDesktop } from '../hooks/useDesktop';

// StandaloneShell pulls in xterm; this modal is reachable before login, so keep it off the entry chunk.
const StandaloneShell = lazyWithRetry(() => import('./StandaloneShell'));

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
  const { t } = useTranslation('common');
  const { openExternal: desktopOpenExternal } = useDesktop();
  const closeTimer = useRef(null);
  const requestLock = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  useEffect(() => () => clearTimeout(closeTimer.current), [isOpen, provider]);
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
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => {
        onClose();
      }, 1000);
    }
  };

  const handleOpenExternal = async (url) => {
    if (!url) {
      return;
    }

    try { await desktopOpenExternal(url); }
    catch { setInstallMessage(t('loginDialog.openFailed')); }
  };

  const handleRefresh = async () => {
    if (requestLock.current) return;
    requestLock.current = true;
    setIsRefreshing(true);
    setInstallMessage('');
    setInstallOutput('');
    try { await onStatusRefresh?.(); }
    catch { setInstallMessage(t('loginDialog.refreshFailed')); }
    finally { requestLock.current = false; setIsRefreshing(false); }
  };

  const handleInstall = async () => {
    if (requestLock.current) return;
    requestLock.current = true;
    setIsInstalling(true);
    setInstallMessage(t('loginDialog.installing'));
    setInstallOutput('');

    try {
      const response = await authenticatedFetch(`/api/cli/install/${provider}`, {
        method: 'POST',
      });
      const data = await response.json();

      setInstallOutput([data.stdout, data.stderr].filter(Boolean).join('\n\n'));

      if (response.ok && data?.status?.cliAvailable !== false) {
        setInstallMessage(t('loginDialog.installed'));
      } else {
        setInstallMessage(data.error || t('loginDialog.installFailed'));
      }

      await onStatusRefresh?.();
    } catch (error) {
      setInstallMessage(error.message || t('loginDialog.installFailed'));
    } finally {
      requestLock.current = false;
      setIsInstalling(false);
    }
  };

  const busy = isInstalling || isRefreshing;
  return (
    <WorkbenchDialog title={t('loginDialog.title', { provider: providerLabel })} onClose={onClose} size={cliAvailable ? 'wide' : 'default'} busy={busy}>
      {!cliAvailable ? (
        <div className="space-y-4">
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm break-words">
            {installHint || t('loginDialog.missing')}
          </p>
          {installMessage && <p role="status" className="text-sm whitespace-pre-wrap break-words">{installMessage}</p>}
          {installOutput && <pre className="max-h-52 overflow-auto rounded-md border border-border bg-muted p-3 text-xs whitespace-pre-wrap break-words">{installOutput}</pre>}
          <div className="flex flex-wrap gap-2">
            {installable && installerAvailable && (
              <Button type="button" className="min-h-11" disabled={busy} onClick={handleInstall}>
                {isInstalling ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Wrench className="h-4 w-4" />}
                {isInstalling ? t('loginDialog.installing') : t('loginDialog.install', { provider: providerLabel })}
              </Button>
            )}
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={handleRefresh}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              {t('loginDialog.recheck')}
            </Button>
            {(downloadUrl || docsUrl) && (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => handleOpenExternal(downloadUrl || docsUrl)}>
                <ExternalLink className="h-4 w-4" />{t('loginDialog.guide')}
              </Button>
            )}
          </div>
          {installerHint && <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{installerHint}</p>}
        </div>
      ) : (
        <div className="h-[min(60dvh,600px)] min-h-0 overflow-hidden rounded-md border border-border">
          <LazyLoadBoundary onClose={onClose}>
            <Suspense fallback={<div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />{t('loginDialog.loading')}</div>}>
              <StandaloneShell project={project} command={getCommand()} onComplete={handleComplete} minimal={true} />
            </Suspense>
          </LazyLoadBoundary>
        </div>
      )}
    </WorkbenchDialog>
  );
}

export default LoginModal;
