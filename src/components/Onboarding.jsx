import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronLeft, Check, LogIn, Loader2, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';
import CodexLogo from './CodexLogo';
import GeminiLogo from './GeminiLogo';
import LoginModal from './LoginModal';
import { authenticatedFetch } from '../utils/api';
import { IS_PLATFORM } from '../constants/config';
import { isTelemetryEnabled, setTelemetryEnabled } from '../utils/telemetry';
import { writeCliAvailability } from '../utils/cliAvailability';

const Onboarding = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [telemetryConsent, setTelemetryConsentState] = useState(() => isTelemetryEnabled());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [activeLoginProvider, setActiveLoginProvider] = useState(null);
  const [selectedProject] = useState({ name: 'default', fullPath: IS_PLATFORM ? '/workspace' : '' });

  const [claudeAuthStatus, setClaudeAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'claude',
    installHint: null,
    loading: true,
    error: null
  });

  const [cursorAuthStatus, setCursorAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'agent',
    installHint: null,
    loading: true,
    error: null
  });

  const [codexAuthStatus, setCodexAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'codex',
    installHint: null,
    loading: true,
    error: null
  });

  const [geminiAuthStatus, setGeminiAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'gemini',
    installHint: null,
    loading: true,
    error: null
  });

  const buildDefaultAuthState = (overrides = {}) => ({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: null,
    installHint: null,
    loading: false,
    error: null,
    ...overrides
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
        setClaudeAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'claude',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null
        });
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
        setCursorAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'agent',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null
        });
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
        setCodexAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'codex',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null
        });
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
        setGeminiAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'gemini',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null
        });
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

  const handleClaudeLogin = () => setActiveLoginProvider('claude');
  const handleCursorLogin = () => setActiveLoginProvider('cursor');
  const handleCodexLogin = () => setActiveLoginProvider('codex');
  const handleGeminiLogin = () => setActiveLoginProvider('gemini');

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
    {
      title: 'Connect Agents',
      description: 'Connect your AI coding assistants',
      icon: LogIn,
      required: false
    }
  ];

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Welcome to Dr. Claw
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

      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Connect Your AI Agents</h2>
              <p className="text-muted-foreground">
                Login to your AI coding assistant. This is optional.
              </p>
            </div>

            {/* Agent Cards Grid */}
            <div className="space-y-3">
              {/* Claude */}
              <div className={`border rounded-lg p-4 transition-colors ${
                claudeAuthStatus.authenticated
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                  : claudeAuthStatus.cliAvailable === false
                    ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                  : 'border-border bg-card'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                      <ClaudeLogo size={20} />
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        Claude Code
                        {claudeAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {claudeAuthStatus.loading ? 'Checking...' :
                         claudeAuthStatus.cliAvailable === false ? 'Install Claude CLI first' :
                         claudeAuthStatus.authenticated ? claudeAuthStatus.email || 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {!claudeAuthStatus.authenticated && !claudeAuthStatus.loading && claudeAuthStatus.cliAvailable !== false && (
                    <button
                      onClick={handleClaudeLogin}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>

              {/* Gemini */}
              <div className={`border rounded-lg p-4 transition-colors ${
                geminiAuthStatus.authenticated
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
                  : geminiAuthStatus.cliAvailable === false
                    ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                  : 'border-border bg-card'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                      <GeminiLogo className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        Gemini CLI
                        {geminiAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {geminiAuthStatus.loading ? 'Checking...' :
                         geminiAuthStatus.cliAvailable === false ? 'Install Gemini CLI first' :
                         geminiAuthStatus.authenticated ? geminiAuthStatus.email || 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {!geminiAuthStatus.authenticated && !geminiAuthStatus.loading && geminiAuthStatus.cliAvailable !== false && (
                    <button
                      onClick={handleGeminiLogin}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>

              {/* Cursor and Codex temporarily hidden — will re-add when content is ready */}
            </div>

            <div className="text-center text-sm text-muted-foreground pt-2">
              <p>You can configure these later in Settings.</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 0:
        return true;
      case 1:
        return true;
      default:
        return false;
    }
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
        />
      )}
    </>
  );
};

export default Onboarding;
