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

const Onboarding = ({ onComplete }) => {
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
          error: 'Failed to check authentication status'
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
          error: 'Failed to check authentication status'
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
          error: 'Failed to check authentication status'
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
          error: 'Failed to check authentication status'
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
        throw new Error(data.error || 'Failed to complete onboarding');
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
      title: 'Preferences',
      description: 'Configure onboarding preferences',
      icon: FileText,
      required: false
    },
    ...(isDesktop ? [{
      title: 'System Check',
      description: 'Verify system tools and dependencies',
      icon: Monitor,
      required: false
    }] : []),
    {
      title: 'Dependencies & Login',
      description: 'Install missing CLIs and connect your AI coding assistants',
      icon: LogIn,
      required: false
    }
  ];

  const providerCards = [
    {
      id: 'claude',
      name: 'Claude Code',
      description: 'Anthropic CLI assistant',
      logo: <ClaudeLogo size={20} />,
      status: claudeAuthStatus,
      onAction: handleClaudeLogin,
      accent: {
        connected: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
        icon: 'bg-blue-100 dark:bg-blue-900/30',
        button: 'bg-blue-600 hover:bg-blue-700'
      }
    },
    {
      id: 'cursor',
      name: 'Cursor CLI',
      description: 'Cursor agent command line',
      logo: <CursorLogo size={20} />,
      status: cursorAuthStatus,
      onAction: handleCursorLogin,
      accent: {
        connected: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
        icon: 'bg-purple-100 dark:bg-purple-900/30',
        button: 'bg-purple-600 hover:bg-purple-700'
      }
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      description: 'OpenAI coding CLI',
      logo: <CodexLogo size={20} />,
      status: codexAuthStatus,
      onAction: handleCodexLogin,
      accent: {
        connected: 'bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800',
        icon: 'bg-slate-100 dark:bg-slate-900/30',
        button: 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200'
      }
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      description: 'Google Gemini terminal assistant',
      logo: <GeminiLogo className="w-6 h-6" />,
      status: geminiAuthStatus,
      onAction: handleGeminiLogin,
      accent: {
        connected: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
        icon: 'bg-emerald-100 dark:bg-emerald-900/30',
        button: 'bg-emerald-600 hover:bg-emerald-700'
      }
    }
  ];

  const getProviderStatusText = (status) => {
    if (status.loading) {
      return 'Checking...';
    }

    if (status.cliAvailable === false) {
      return status.installHint || 'CLI is not installed yet';
    }

    if (status.authenticated) {
      return status.email || 'Connected';
    }

    return 'CLI is ready. Login is optional.';
  };

  const getProviderAction = (status) => {
    if (status.loading) {
      return null;
    }

    if (status.cliAvailable === false) {
      return {
        label: 'Install',
        icon: Wrench,
      };
    }

    if (status.authenticated) {
      return {
        label: 'Re-login',
        icon: LogIn,
      };
    }

    return {
      label: 'Login',
      icon: LogIn,
    };
  };

  const depsStepIndex = isDesktop ? 2 : 1;
  const systemCheckStepIndex = isDesktop ? 1 : -1;

  const renderSystemCheckStep = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-cyan-100 dark:bg-cyan-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <Monitor className="w-8 h-8 text-cyan-600 dark:text-cyan-400" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">System Check</h2>
        <p className="text-muted-foreground">
          Verifying your development environment has the required tools.
        </p>
      </div>

      {appInfo && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Dr. Claw Desktop</span> v{appInfo.version} &middot; {appInfo.platform}/{appInfo.arch} &middot; Electron {appInfo.electronVersion}
        </div>
      )}

      {systemDepsLoading ? (
        <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Checking system dependencies...</span>
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
                <RefreshCw className="w-4 h-4" />
                Re-check
              </button>
            </div>
          )}

          {systemDeps.some(d => !d.available && ['node', 'npm', 'git'].includes(d.name)) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              Some core tools (Node.js, npm, or Git) are missing. Dr. Claw will still work, but some features may be limited. Install them via your package manager and click Re-check.
            </div>
          )}

          {!systemDeps.some(d => !d.available && ['node', 'npm', 'git'].includes(d.name)) && systemDeps.length > 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-200">
              Core system tools are available. You can set up AI agent CLIs in the next step.
            </div>
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
            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Welcome to Dr. Claw{isDesktop ? ' Desktop' : ''}
            </h2>
            <p className="text-muted-foreground">
              Configure your data usage preference before continuing.
            </p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            Internal beta agreement is temporarily disabled. Users can continue onboarding without accepting it.
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
              <span>
                Allow my usage data to improve Dr. Claw models and features (recommended). You can still continue without this and change it anytime in Settings.
              </span>
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
              <h2 className="text-2xl font-bold text-foreground mb-2">Install Dependencies and Connect Agents</h2>
              <p className="text-muted-foreground">
                After finishing the basic agreement step, you can immediately see which local CLIs are missing and install or log into them here.
              </p>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200">
              You can skip this step, but installing here will reduce the user's setup cost the first time they enter Dr. Claw.
            </div>

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
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          Connected
                        </span>
                      ) : isMissing ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          Install required
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          Ready
                        </span>
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
                          className={`${provider.accent.button} text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors inline-flex items-center gap-2`}
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
                          <ExternalLink className="w-4 h-4" />
                          Guide
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="text-center text-sm text-muted-foreground pt-2">
              <p>You can configure these later in Settings.</p>
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
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
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
                        <span className="text-xs text-red-500">Required</span>
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
          <div className="bg-card rounded-lg shadow-lg border border-border p-8">
            {renderStepContent()}

            {/* Error Message */}
            {error && (
              <div className="mt-6 p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
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
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>

              <div className="flex items-center gap-3">
                {currentStep < steps.length - 1 ? (
                  <button
                    onClick={handleNextStep}
                    disabled={!isStepValid() || isSubmitting}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleFinish}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Completing...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Complete Setup
                      </>
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
