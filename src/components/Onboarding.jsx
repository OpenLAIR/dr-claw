import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronLeft, Check, ExternalLink, LogIn, Loader2, Wrench, FileText, Monitor, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';
import CodexLogo from './CodexLogo';
import GeminiLogo from './GeminiLogo';
import LoginModal from './LoginModal';
import { authenticatedFetch } from '../utils/api';
import { IS_PLATFORM } from '../constants/config';
import { isTelemetryEnabled, setTelemetryEnabled } from '../utils/telemetry';
import { writeCliAvailability } from '../utils/cliAvailability';
import { useDesktop } from '../hooks/useDesktop';
import { useTranslation } from 'react-i18next';

const Onboarding = ({ onComplete }) => {
  const { t } = useTranslation('common');
  const { isDesktop, checkDependencies, appInfo, openExternal: desktopOpenExternal } = useDesktop();
  const [currentStep, setCurrentStep] = useState(0);
  const [telemetryConsent, setTelemetryConsentState] = useState(() => isTelemetryEnabled());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [activeLoginProvider, setActiveLoginProvider] = useState(null);
  const [selectedProject] = useState({ name: 'default', fullPath: IS_PLATFORM ? '/workspace' : '' });

  const [systemDeps, setSystemDeps] = useState([]);
  const [systemDepsLoading, setSystemDepsLoading] = useState(false);
  const [systemDepsChecked, setSystemDepsChecked] = useState(false);

  const runSystemCheck = async () => {
    if (!isDesktop) return;
    setSystemDepsLoading(true);
    try {
      const results = await checkDependencies();
      setSystemDeps(results);
      setSystemDepsChecked(true);
    } catch {
      setSystemDeps([]);
    } finally {
      setSystemDepsLoading(false);
    }
  };

  useEffect(() => {
    if (isDesktop && currentStep === 1 && !systemDepsChecked) {
      runSystemCheck();
    }
  }, [isDesktop, currentStep]);

  const [claudeAuthStatus, setClaudeAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'claude',
    installHint: null,
    loading: true,
    error: null,
    installable: false,
    installerAvailable: true,
    installerHint: null,
    docsUrl: null,
    downloadUrl: null
  });

  const [cursorAuthStatus, setCursorAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'agent',
    installHint: null,
    loading: true,
    error: null,
    installable: false,
    installerAvailable: true,
    installerHint: null,
    docsUrl: null,
    downloadUrl: null
  });

  const [codexAuthStatus, setCodexAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'codex',
    installHint: null,
    loading: true,
    error: null,
    installable: false,
    installerAvailable: true,
    installerHint: null,
    docsUrl: null,
    downloadUrl: null
  });

  const [geminiAuthStatus, setGeminiAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'gemini',
    installHint: null,
    loading: true,
    error: null,
    installable: false,
    installerAvailable: true,
    installerHint: null,
    docsUrl: null,
    downloadUrl: null
  });

  const buildDefaultAuthState = (overrides = {}) => ({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: null,
    installHint: null,
    loading: false,
    error: null,
    installable: false,
    installerAvailable: true,
    installerHint: null,
    docsUrl: null,
    downloadUrl: null,
    ...overrides
  });

  const normalizeAuthStatus = (data, fallbackCliCommand) => ({
    authenticated: data.authenticated,
    email: data.email,
    cliAvailable: data.cliAvailable !== false,
    cliCommand: data.cliCommand || fallbackCliCommand,
    installHint: data.installHint || null,
    loading: false,
    error: data.error || null,
    installable: data.installable === true,
    installerAvailable: data.installerAvailable !== false,
    installerHint: data.installerHint || null,
    docsUrl: data.docsUrl || null,
    downloadUrl: data.downloadUrl || null
  });

  const prevActiveLoginProviderRef = useRef(undefined);

  useEffect(() => {
    const prevProvider = prevActiveLoginProviderRef.current;
    prevActiveLoginProviderRef.current = activeLoginProvider;

    const isInitialMount = prevProvider === undefined;
    const isModalClosing = prevProvider !== null && activeLoginProvider === null;

    if (isInitialMount || isModalClosing) {
      checkClaudeAuthStatus();
      checkCursorAuthStatus();
      checkCodexAuthStatus();
      checkGeminiAuthStatus();
    }
  }, [activeLoginProvider]);

  const checkClaudeAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/claude/status');
      if (response.ok) {
        const data = await response.json();
        setClaudeAuthStatus(normalizeAuthStatus(data, 'claude'));
        writeCliAvailability('claude', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'claude',
          installHint: data.installHint || null,
        });
      } else {
        setClaudeAuthStatus(buildDefaultAuthState({
          cliCommand: 'claude',
          error: t('onboarding.statusFailed')
        }));
      }
    } catch (error) {
      console.error('Error checking Claude auth status:', error);
      setClaudeAuthStatus(buildDefaultAuthState({
        cliCommand: 'claude',
        error: error.message
      }));
    }
  };

  const checkCursorAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/cursor/status');
      if (response.ok) {
        const data = await response.json();
        setCursorAuthStatus(normalizeAuthStatus(data, 'agent'));
        writeCliAvailability('cursor', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'agent',
          installHint: data.installHint || null,
        });
      } else {
        setCursorAuthStatus(buildDefaultAuthState({
          cliCommand: 'agent',
          error: t('onboarding.statusFailed')
        }));
      }
    } catch (error) {
      console.error('Error checking Cursor auth status:', error);
      setCursorAuthStatus(buildDefaultAuthState({
        cliCommand: 'agent',
        error: error.message
      }));
    }
  };

  const checkCodexAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/codex/status');
      if (response.ok) {
        const data = await response.json();
        setCodexAuthStatus(normalizeAuthStatus(data, 'codex'));
        writeCliAvailability('codex', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'codex',
          installHint: data.installHint || null,
        });
      } else {
        setCodexAuthStatus(buildDefaultAuthState({
          cliCommand: 'codex',
          error: t('onboarding.statusFailed')
        }));
      }
    } catch (error) {
      console.error('Error checking Codex auth status:', error);
      setCodexAuthStatus(buildDefaultAuthState({
        cliCommand: 'codex',
        error: error.message
      }));
    }
  };

  const checkGeminiAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/gemini/status');
      if (response.ok) {
        const data = await response.json();
        setGeminiAuthStatus(normalizeAuthStatus(data, 'gemini'));
        writeCliAvailability('gemini', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'gemini',
          installHint: data.installHint || null,
        });
      } else {
        setGeminiAuthStatus(buildDefaultAuthState({
          cliCommand: 'gemini',
          error: t('onboarding.statusFailed')
        }));
      }
    } catch (error) {
      console.error('Error checking Gemini auth status:', error);
      setGeminiAuthStatus(buildDefaultAuthState({
        cliCommand: 'gemini',
        error: error.message
      }));
    }
  };

  const refreshProviderStatus = async (provider) => {
    if (provider === 'claude') {
      await checkClaudeAuthStatus();
      return;
    }

    if (provider === 'cursor') {
      await checkCursorAuthStatus();
      return;
    }

    if (provider === 'codex') {
      await checkCodexAuthStatus();
      return;
    }

    if (provider === 'gemini') {
      await checkGeminiAuthStatus();
    }
  };

  const handleClaudeLogin = () => setActiveLoginProvider('claude');
  const handleCursorLogin = () => setActiveLoginProvider('cursor');
  const handleCodexLogin = () => setActiveLoginProvider('codex');
  const handleGeminiLogin = () => setActiveLoginProvider('gemini');

  const openExternal = (url) => {
    if (!url) {
      return;
    }

    desktopOpenExternal(url);
  };

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      if (activeLoginProvider === 'claude') {
        checkClaudeAuthStatus();
      } else if (activeLoginProvider === 'cursor') {
        checkCursorAuthStatus();
      } else if (activeLoginProvider === 'codex') {
        checkCodexAuthStatus();
      } else if (activeLoginProvider === 'gemini') {
        checkGeminiAuthStatus();
      }
    }
  };

  const handleNextStep = async () => {
    setError('');

    if (currentStep === 0) {
      setTelemetryEnabled(telemetryConsent);
      setCurrentStep(currentStep + 1);
      return;
    }

    setCurrentStep(currentStep + 1);
  };

  const handlePrevStep = () => {
    setError('');
    setCurrentStep(currentStep - 1);
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      const response = await authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('onboarding.completeFailed'));
      }

      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    {
      title: t('onboarding.preferences'),
      description: t('onboarding.preferencesStep'),
      icon: FileText,
      required: false
    },
    ...(isDesktop ? [{
      title: t('onboarding.systemCheck'),
      description: t('onboarding.systemStep'),
      icon: Monitor,
      required: false
    }] : []),
    {
      title: t('onboarding.agentsStep'),
      description: t('onboarding.agentsStepDescription'),
      icon: LogIn,
      required: false
    }
  ];

  const providerCards = [
    {
      id: 'claude',
      name: 'Claude Code',
      description: t('onboarding.claudeDescription'),
      logo: <ClaudeLogo size={20} />,
      status: claudeAuthStatus,
      onAction: handleClaudeLogin,
      accent: { connected: 'bg-muted border-border', icon: 'bg-muted', button: 'bg-primary text-primary-foreground hover:bg-primary/90' }
    },
    {
      id: 'cursor',
      name: 'Cursor CLI',
      description: t('onboarding.cursorDescription'),
      logo: <CursorLogo size={20} />,
      status: cursorAuthStatus,
      onAction: handleCursorLogin,
      accent: { connected: 'bg-muted border-border', icon: 'bg-muted', button: 'bg-primary text-primary-foreground hover:bg-primary/90' }
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      description: t('onboarding.codexDescription'),
      logo: <CodexLogo size={20} />,
      status: codexAuthStatus,
      onAction: handleCodexLogin,
      accent: { connected: 'bg-muted border-border', icon: 'bg-muted', button: 'bg-primary text-primary-foreground hover:bg-primary/90' }
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      description: t('onboarding.geminiDescription'),
      logo: <GeminiLogo className="w-6 h-6" />,
      status: geminiAuthStatus,
      onAction: handleGeminiLogin,
      accent: { connected: 'bg-muted border-border', icon: 'bg-muted', button: 'bg-primary text-primary-foreground hover:bg-primary/90' }
    }
  ];

  const getProviderStatusText = (status) => {
    if (status.loading) {
      return t('onboarding.checking');
    }

    if (status.cliAvailable === false) {
      return status.installHint || t('onboarding.cliMissing');
    }

    if (status.authenticated) {
      return status.email || t('onboarding.connected');
    }

    return t('onboarding.cliReady');
  };

  const getProviderAction = (status) => {
    if (status.loading) {
      return null;
    }

    if (status.cliAvailable === false) {
      return {
        label: t('onboarding.install'),
        icon: Wrench,
      };
    }

    if (status.authenticated) {
      return {
        label: t('onboarding.relogin'),
        icon: LogIn,
      };
    }

    return {
      label: t('onboarding.login'),
      icon: LogIn,
    };
  };

  const depsStepIndex = isDesktop ? 2 : 1;
  const systemCheckStepIndex = isDesktop ? 1 : -1;

  const renderSystemCheckStep = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <Monitor className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">{t('onboarding.systemCheck')}</h2>
        <p className="text-muted-foreground">{t('onboarding.systemDescription')}</p>
      </div>

      {appInfo && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-sm leading-6 text-muted-foreground">
          <span className="font-medium text-foreground">Dr. Claw Desktop</span> v{appInfo.version} &middot; {appInfo.platform}/{appInfo.arch} &middot; Electron {appInfo.electronVersion}
        </div>
      )}

      {systemDepsLoading ? (
        <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>{t('onboarding.checkingDependencies')}</span>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {systemDeps.map((dep) => (
              <div
                key={dep.name}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                  dep.available
                    ? 'border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-950/20'
                    : 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  {dep.available ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  )}
                  <span className="font-medium text-foreground capitalize">{dep.name}</span>
                </div>
                <span className="text-sm text-muted-foreground font-mono">
                  {dep.available ? dep.version : 'Not found'}
                </span>
              </div>
            ))}
          </div>

          {systemDeps.length > 0 && (
            <div className="flex justify-center">
              <button
                onClick={runSystemCheck}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <RefreshCw className="w-4 h-4" />{t('onboarding.recheck')}</button>
            </div>
          )}

          {systemDeps.some(d => !d.available && ['node', 'npm', 'git'].includes(d.name)) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">{t('onboarding.missingTools')}</div>
          )}

          {!systemDeps.some(d => !d.available && ['node', 'npm', 'git'].includes(d.name)) && systemDeps.length > 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-200">{t('onboarding.toolsReady')}</div>
          )}
        </>
      )}
    </div>
  );

  const renderStepContent = () => {
    if (currentStep === 0) {
      return (
        <div className="space-y-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold text-foreground mb-2">
              {t('onboarding.welcome', { app: isDesktop ? 'Dr. Claw Desktop' : 'Dr. Claw' })}
            </h2>
            <p className="text-muted-foreground">{t('onboarding.preferencesDescription')}</p>
          </div>


          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <label className="flex items-start gap-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={telemetryConsent}
                onChange={(e) => setTelemetryConsentState(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500"
                disabled={isSubmitting}
              />
              <span>{t('onboarding.telemetry')}</span>
            </label>
          </div>
        </div>
      );
    }

    if (currentStep === systemCheckStepIndex) {
      return renderSystemCheckStep();
    }

    if (currentStep === depsStepIndex) {
      return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-semibold text-foreground mb-2">{t('onboarding.connectAgents')}</h2>
              <p className="text-muted-foreground">{t('onboarding.agentsDescription')}</p>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200">{t('onboarding.optionalSetup')}</div>

            <div className="grid gap-3 md:grid-cols-2">
              {providerCards.map((provider) => {
                const action = getProviderAction(provider.status);
                const ActionIcon = action?.icon;
                const isMissing = provider.status.cliAvailable === false;

                return (
                  <div
                    key={provider.id}
                    className={`border rounded-lg p-4 transition-colors ${
                      provider.status.authenticated
                        ? provider.accent.connected
                        : isMissing
                          ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                          : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${provider.accent.icon}`}>
                          {provider.logo}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground flex items-center gap-2">
                            {provider.name}
                            {provider.status.authenticated && <Check className="w-4 h-4 text-green-500" />}
                          </div>
                          <div className="text-xs text-muted-foreground">{provider.description}</div>
                        </div>
                      </div>

                      {provider.status.loading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : provider.status.authenticated ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">{t('onboarding.connected')}</span>
                      ) : isMissing ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{t('onboarding.installRequired')}</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{t('onboarding.ready')}</span>
                      )}
                    </div>

                    <div className="mt-4 text-sm text-muted-foreground min-h-[40px]">
                      {getProviderStatusText(provider.status)}
                    </div>

                    {isMissing && provider.status.installCommands?.[0]?.label && (
                      <div className="mt-3 rounded-md bg-black/5 px-3 py-2 font-mono text-xs text-foreground dark:bg-white/5">
                        {provider.status.installCommands[0].label}
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {action && (
                        <button
                          onClick={provider.onAction}
                          className={`${provider.accent.button} text-sm font-medium py-2 px-4 rounded-lg transition-colors inline-flex items-center gap-2`}
                        >
                          {ActionIcon && <ActionIcon className="w-4 h-4" />}
                          {action.label}
                        </button>
                      )}

                      {(provider.status.downloadUrl || provider.status.docsUrl) && (
                        <button
                          onClick={() => openExternal(provider.status.downloadUrl || provider.status.docsUrl)}
                          className="border border-border bg-background text-foreground text-sm font-medium py-2 px-4 rounded-lg transition-colors hover:bg-accent inline-flex items-center gap-2"
                        >
                          <ExternalLink className="w-4 h-4" />{t('onboarding.guide')}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="text-center text-sm text-muted-foreground pt-2">
              <p>{t('onboarding.configureLater')}</p>
            </div>
          </div>
        );
    }

    return null;
  };

  const isStepValid = () => {
    return true;
  };

  return (
    <>
      <div className="min-h-dvh bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          {/* Progress Steps */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {steps.map((step, index) => (
                <React.Fragment key={index}>
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors duration-200 ${
                      index < currentStep ? 'bg-green-500 border-green-500 text-white' :
                      index === currentStep ? 'bg-blue-600 border-blue-600 text-white' :
                      'bg-background border-border text-muted-foreground'
                    }`}>
                      {index < currentStep ? (
                        <Check className="w-6 h-6" />
                      ) : typeof step.icon === 'function' ? (
                        <step.icon />
                      ) : (
                        <step.icon className="w-6 h-6" />
                      )}
                    </div>
                    <div className="mt-2 text-center">
                      <p className={`text-sm font-medium ${
                        index === currentStep ? 'text-foreground' : 'text-muted-foreground'
                      }`}>
                        {step.title}
                      </p>
                      {step.required && (
                        <span className="text-xs text-red-500">{t('onboarding.required')}</span>
                      )}
                    </div>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 transition-colors duration-200 ${
                      index < currentStep ? 'bg-green-500' : 'bg-border'
                    }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-background rounded-lg border border-border p-4 sm:p-6">
            {renderStepContent()}

            {/* Error Message */}
            {error && (
              <div role="alert" className="mt-6 p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
              <button
                onClick={handlePrevStep}
                disabled={currentStep === 0 || isSubmitting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                <ChevronLeft className="w-4 h-4" />{t('onboarding.previous')}</button>

              <div className="flex items-center gap-3">
                {currentStep < steps.length - 1 ? (
                  <button
                    onClick={handleNextStep}
                    disabled={!isStepValid() || isSubmitting}
                    className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-medium rounded-lg transition-colors duration-200"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />{t('onboarding.saving')}</>
                    ) : (
                      <>{t('onboarding.next')}<ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleFinish}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-medium rounded-lg transition-colors duration-200"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />{t('onboarding.completing')}</>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />{t('onboarding.complete')}</>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeLoginProvider && (
        <LoginModal
          isOpen={!!activeLoginProvider}
          onClose={() => setActiveLoginProvider(null)}
          provider={activeLoginProvider}
          project={selectedProject}
          onComplete={handleLoginComplete}
          isOnboarding={true}
          cliAvailable={
            activeLoginProvider === 'claude' ? claudeAuthStatus.cliAvailable !== false :
            activeLoginProvider === 'gemini' ? geminiAuthStatus.cliAvailable !== false :
            activeLoginProvider === 'cursor' ? cursorAuthStatus.cliAvailable !== false :
            activeLoginProvider === 'codex' ? codexAuthStatus.cliAvailable !== false :
            true
          }
          installHint={
            activeLoginProvider === 'claude' ? claudeAuthStatus.installHint :
            activeLoginProvider === 'gemini' ? geminiAuthStatus.installHint :
            activeLoginProvider === 'cursor' ? cursorAuthStatus.installHint :
            activeLoginProvider === 'codex' ? codexAuthStatus.installHint :
            null
          }
          installable={
            activeLoginProvider === 'claude' ? claudeAuthStatus.installable === true :
            activeLoginProvider === 'gemini' ? geminiAuthStatus.installable === true :
            activeLoginProvider === 'cursor' ? cursorAuthStatus.installable === true :
            activeLoginProvider === 'codex' ? codexAuthStatus.installable === true :
            false
          }
          installerAvailable={
            activeLoginProvider === 'claude' ? claudeAuthStatus.installerAvailable !== false :
            activeLoginProvider === 'gemini' ? geminiAuthStatus.installerAvailable !== false :
            activeLoginProvider === 'cursor' ? cursorAuthStatus.installerAvailable !== false :
            activeLoginProvider === 'codex' ? codexAuthStatus.installerAvailable !== false :
            true
          }
          installerHint={
            activeLoginProvider === 'claude' ? claudeAuthStatus.installerHint :
            activeLoginProvider === 'gemini' ? geminiAuthStatus.installerHint :
            activeLoginProvider === 'cursor' ? cursorAuthStatus.installerHint :
            activeLoginProvider === 'codex' ? codexAuthStatus.installerHint :
            null
          }
          docsUrl={
            activeLoginProvider === 'claude' ? claudeAuthStatus.docsUrl :
            activeLoginProvider === 'gemini' ? geminiAuthStatus.docsUrl :
            activeLoginProvider === 'cursor' ? cursorAuthStatus.docsUrl :
            activeLoginProvider === 'codex' ? codexAuthStatus.docsUrl :
            null
          }
          downloadUrl={
            activeLoginProvider === 'claude' ? claudeAuthStatus.downloadUrl :
            activeLoginProvider === 'gemini' ? geminiAuthStatus.downloadUrl :
            activeLoginProvider === 'cursor' ? cursorAuthStatus.downloadUrl :
            activeLoginProvider === 'codex' ? codexAuthStatus.downloadUrl :
            null
          }
          onStatusRefresh={() => refreshProviderStatus(activeLoginProvider)}
        />
      )}
    </>
  );
};

export default Onboarding;
