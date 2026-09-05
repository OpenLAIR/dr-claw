import React, { lazy, Suspense, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LazyLoadBoundary from '../../LazyLoadBoundary';

import ChatTabBar from '../../chat/view/ChatTabBar';
import { useChatTabs } from '../../../hooks/useChatTabs';
import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import type { MainContentProps } from '../types/types';
import { resolveChatTabSyncAction } from './chatTabSync';

import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import type { Project } from '../../../types/app';
import type { Reference } from '../../references/types';
import { queueSkillCommandDraft } from '../../../utils/skillCommandDraft';

const ChatInterface = lazy(() => import('../../chat/view/ChatInterface'));
const SkillsDashboard = lazy(() => import('../../SkillsDashboard'));
const AutoResearchHub = lazy(() => import('../../AutoResearchHub'));
const ComputeResourcesDashboard = lazy(() => import('../../compute-dashboard/ComputeResourcesDashboard'));
const SurveyPage = lazy(() => import('../../survey/view/SurveyPage'));
const ProjectDashboard = lazy(() => import('../../project-dashboard/view/ProjectDashboard'));
const TrashDashboard = lazy(() => import('../../project-dashboard/view/TrashDashboard'));
const NewsDashboard = lazy(() => import('../../news-dashboard/view/NewsDashboard'));

function ContentLoadingFallback() {
  const { t } = useTranslation('common');

  return (
    <div className="flex h-full min-h-48 items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <span>{t('mainContent.loading')}</span>
      </div>
    </div>
  );
}

function LazyContent({ children, resetKey }: { children: React.ReactNode; resetKey: string }) {
  return (
    <LazyLoadBoundary resetKey={resetKey}>
      <Suspense fallback={<ContentLoadingFallback />}>{children}</Suspense>
    </LazyLoadBoundary>
  );
}

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

function MainContent({
  projects,
  trashProjects,
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  latestMessage,
  isMobile,
  onMenuClick,
  isLoading,
  isTrashLoading,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  externalMessageUpdate,
  pendingAutoIntake,
  clearPendingAutoIntake,
  importedProjectAnalysisPrompt,
  clearImportedProjectAnalysisPrompt,
  onProjectSelect,
  onStartWorkspaceQa,
  onChatFromReference,
  newSessionMode,
  onNewSessionModeChange,
  sessionNavigationSource,
  onResetNavigationSource,
  onNewSession,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const shouldShowTasksTab = false;

  const handleActivateBlankTab = useCallback(() => {
    if (selectedProject && onNewSession) {
      onNewSession(selectedProject, newSessionMode);
    }
  }, [selectedProject, onNewSession, newSessionMode]);

  const chatTabs = useChatTabs(
    selectedProject,
    onNavigateToSession,
    handleActivateBlankTab,
  );

  const {
    activeTab: chatActiveTab,
    tabs: chatTabList,
    openNewTab,
    openTab,
    updateActiveTabSession,
    switchTab,
    closeTab,
  } = chatTabs;
  const chatActiveTabSessionId = chatActiveTab?.sessionId;
  const chatTabCount = chatTabList.length;

  // Sync selectedSession changes into tab state using navigation source to
  // distinguish user sidebar clicks from system session-created events. Runs
  // on first render too so a pre-selected session (e.g. from URL) gets a tab.
  useEffect(() => {
    const currId = selectedSession?.id ?? null;

    const action = resolveChatTabSyncAction({
      activeAppTab: activeTab,
      hasSelectedProject: Boolean(selectedProject),
      nextSessionId: currId,
      activeChatTabSessionId: chatActiveTabSessionId,
      tabCount: chatTabCount,
      navigationSource: sessionNavigationSource,
    });

    if (action === 'open-new-tab') {
      openNewTab();
    } else if (action === 'update-active-tab-session' && currId && selectedProject) {
      updateActiveTabSession(selectedSession!, selectedProject);
    } else if (action === 'open-tab' && currId && selectedProject) {
      openTab(selectedSession!, selectedProject);
    }

    if (action !== 'noop') {
      onResetNavigationSource();
    }
  }, [
    selectedSession,
    selectedProject,
    activeTab,
    sessionNavigationSource,
    chatActiveTabSessionId,
    chatTabCount,
    openNewTab,
    openTab,
    updateActiveTabSession,
    onResetNavigationSource,
  ]);

  // When the active tab has no session (new chat via [+]), pass null to ChatInterface
  const effectiveSession = chatActiveTabSessionId === null
    ? null
    : selectedSession;

  useEffect(() => {
    if (selectedProject && selectedProject !== currentProject) {
      setCurrentProject?.(selectedProject);
    }
  }, [selectedProject, currentProject, setCurrentProject]);

  // Migration shim: redirect legacy tab values from before PR #130 merged
  // Research Lab and Files into the sidebar. Safe to remove after 2026-07-01.
  useEffect(() => {
    if (activeTab === 'tasks' || activeTab === 'researchlab' || activeTab === 'files' || activeTab === 'shell' || activeTab === 'git') {
      setActiveTab('chat');
    }
  }, [activeTab, setActiveTab]);

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (activeTab === 'dashboard') {
    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <LazyContent resetKey="dashboard">
            <ProjectDashboard
              projects={projects}
              onProjectAction={(project, tab, sessionId) => {
                onProjectSelect(project);
                setActiveTab(tab);
                if (sessionId && tab === 'chat') {
                  onNavigateToSession(sessionId, undefined, project.name);
                }
              }}
            />
          </LazyContent>
        </div>
      </div>
    );
  }

  if (activeTab === 'autoresearch') {
    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />
        <div className="flex-1 min-h-0 overflow-hidden">
          <LazyContent resetKey="auto-research"><AutoResearchHub /></LazyContent>
        </div>
      </div>
    );
  }

  if (activeTab === 'skills') {
    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <LazyContent resetKey="skills">
            <SkillsDashboard
              onSendToChat={(command: string) => {
                queueSkillCommandDraft(command);
                // Select the most recent project if available, then switch to chat
                const recentProject = projects?.[0];
                if (recentProject) {
                  onProjectSelect(recentProject);
                }
                setActiveTab('chat');
              }}
            />
          </LazyContent>
        </div>
      </div>
    );
  }

  if (activeTab === 'trash') {
    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <LazyContent resetKey="trash">
            <TrashDashboard
              projects={trashProjects}
              isLoading={Boolean(isTrashLoading)}
              onRefresh={async () => {
                await Promise.all([
                  window.refreshProjects?.(),
                  window.refreshTrashProjects?.(),
                ]);
              }}
            />
          </LazyContent>
        </div>
      </div>
    );
  }

  if (activeTab === 'news') {
    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <LazyContent resetKey="news"><NewsDashboard /></LazyContent>
        </div>
      </div>
    );
  }

  if (activeTab === 'compute') {
    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <LazyContent resetKey="compute"><ComputeResourcesDashboard /></LazyContent>
        </div>
      </div>
    );
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="h-full flex flex-col">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        shouldShowTasksTab={shouldShowTasksTab}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <div className={`h-full flex flex-col ${activeTab === 'chat' ? '' : 'hidden'}`}>
            <ChatTabBar
              tabs={chatTabList}
              processingSessions={processingSessions}
              onSwitchTab={switchTab}
              onCloseTab={closeTab}
              onNewTab={() => {
                if (selectedProject && onNewSession) {
                  onNewSession(selectedProject);
                }
                openNewTab();
              }}
            />
            <LazyContent resetKey="chat">
              <ChatInterface
                selectedProject={selectedProject}
                selectedSession={effectiveSession}
                ws={ws}
                sendMessage={sendMessage}
                latestMessage={latestMessage}
                onInputFocusChange={onInputFocusChange}
                onSessionActive={onSessionActive}
                onSessionInactive={onSessionInactive}
                onSessionProcessing={onSessionProcessing}
                onSessionNotProcessing={onSessionNotProcessing}
                processingSessions={processingSessions}
                onReplaceTemporarySession={onReplaceTemporarySession}
                onNavigateToSession={onNavigateToSession}
                onShowSettings={onShowSettings}
                autoExpandTools={autoExpandTools}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                autoScrollToBottom={autoScrollToBottom}
                sendByCtrlEnter={sendByCtrlEnter}
                externalMessageUpdate={externalMessageUpdate}
                onStartWorkspaceQa={onStartWorkspaceQa}
                pendingAutoIntake={pendingAutoIntake}
                clearPendingAutoIntake={clearPendingAutoIntake}
                importedProjectAnalysisPrompt={importedProjectAnalysisPrompt}
                clearImportedProjectAnalysisPrompt={clearImportedProjectAnalysisPrompt}
                newSessionMode={newSessionMode}
                onNewSessionModeChange={onNewSessionModeChange}
              />
            </LazyContent>
          </div>

          {activeTab === 'survey' && (
            <div className="h-full overflow-hidden">
              <LazyContent resetKey="survey">
                <SurveyPage
                  selectedProject={selectedProject}
                  onChatFromReference={onChatFromReference ? (ref: Reference) => onChatFromReference(selectedProject, ref) : undefined}
                />
              </LazyContent>
            </div>
          )}

          <div className={`h-full overflow-hidden ${activeTab === 'preview' ? 'block' : 'hidden'}`} />
        </div>
      </div>
    </div>
  );
}

export default React.memo(MainContent);
