import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { TaskMasterProvider } from '../../contexts/TaskMasterContext';
import { TasksSettingsProvider } from '../../contexts/TasksSettingsContext';
import { WebSocketProvider } from '../../contexts/WebSocketContext';

const AppContent = lazy(() => import('./AppContent'));
const SurveyDiagramWindow = lazy(() => import('../survey/view/SurveyDiagramWindow'));

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

export default function AuthenticatedWorkspace() {
  return (
    <WebSocketProvider>
      <TasksSettingsProvider>
        <TaskMasterProvider>
          <Suspense fallback={<WorkspaceLoadingFallback />}>
            <Router basename={window.__ROUTER_BASENAME__ || ''}>
              <Routes>
                <Route path="/" element={<AppContent />} />
                <Route path="/session/:sessionId" element={<AppContent />} />
                <Route path="/survey/diagram" element={<SurveyDiagramWindow />} />
              </Routes>
            </Router>
          </Suspense>
        </TaskMasterProvider>
      </TasksSettingsProvider>
    </WebSocketProvider>
  );
}
