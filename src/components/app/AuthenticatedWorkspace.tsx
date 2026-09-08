import { Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

import { TaskMasterProvider } from '../../contexts/TaskMasterContext';
import { TasksSettingsProvider } from '../../contexts/TasksSettingsContext';
import { WebSocketProvider } from '../../contexts/WebSocketContext';
import lazyWithRetry from '../../utils/lazyWithRetry';
import AppContent from './AppContent';
import WorkspaceLoadingFallback from './WorkspaceLoadingFallback';

const SurveyDiagramWindow = lazyWithRetry(() => import('../survey/view/SurveyDiagramWindow'));

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
