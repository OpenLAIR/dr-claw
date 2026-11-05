import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import LoginForm from './LoginForm';
import Onboarding from './Onboarding';

const LoadingScreen = () => {
 const { t } = useTranslation('common');
 return (
  <div className="min-h-screen bg-background flex items-center justify-center p-4">
    <div className="text-center">
      <div className="flex justify-center mb-4">
        <div className="w-16 h-16 rounded-lg overflow-hidden bg-background">
          <img
            src="/dr-claw.png"
            alt="Dr. Claw"
            className="w-full h-full object-cover"
            loading="eager"
          />
        </div>
      </div>
      <h1 className="text-2xl font-semibold text-foreground mb-2">Dr. Claw</h1>
      <p role="status" className="text-muted-foreground mt-2">{t('status.loading')}</p>
    </div>
  </div>
);
};

const ProtectedRoute = ({ children }) => {
  const { isLoading, needsSetup, user, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (needsSetup) {
    // Fresh install: default to the register form, but keep the login toggle
    // reachable (e.g. the account was just created in another tab/device).
    return <LoginForm initialMode="register" isFirstRun />;
  }

  if (!user) {
    return <LoginForm />;
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return children;
};

export default ProtectedRoute;
