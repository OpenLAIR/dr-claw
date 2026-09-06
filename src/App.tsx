import { Suspense } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import LazyLoadBoundary from './components/LazyLoadBoundary';
import lazyWithRetry from './utils/lazyWithRetry';
import i18n from './i18n/config.js';

const AuthenticatedWorkspace = lazyWithRetry(() => import('./components/app/AuthenticatedWorkspace'));

function WorkspaceLoadingFallback() {
  const { t } = useTranslation('common');

  return (
    <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-muted border-t-primary" />
        <span className="text-sm">{t('mainContent.loading')}</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AuthProvider>
          <ProtectedRoute>
            <LazyLoadBoundary mode="page">
              <Suspense fallback={<WorkspaceLoadingFallback />}>
                <AuthenticatedWorkspace />
              </Suspense>
            </LazyLoadBoundary>
          </ProtectedRoute>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
