import React, { useEffect, useRef } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import SkillsDashboard from '../../SkillsDashboard';
import AutoResearchHub from '../../AutoResearchHub';
import ComputeResourcesDashboard from '../../compute-dashboard/ComputeResourcesDashboard';
import ErrorBoundary from '../../ErrorBoundary';
import SurveyPage from '../../survey/view/SurveyPage';
import ProjectDashboard from '../../project-dashboard/view/ProjectDashboard';
import TrashDashboard from '../../project-dashboard/view/TrashDashboard';
import NewsDashboard from '../../news-dashboard/view/NewsDashboard';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import EditorSidebar from './subcomponents/EditorSidebar';
import type { MainContentProps } from '../types/types';

import ChatTabBar from '../../chat/view/ChatTabBar';
import { useChatTabs } from '../../../hooks/useChatTabs';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../hooks/useEditorSidebar';
import type { Project } from '../../../types/app';
import type { Reference } from '../../references/types';
import { queueSkillCommandDraft } from '../../../utils/skillCommandDraft';
import { resolveChatTabSyncAction } from './chatTabSync';

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
  sessionNavigationSource,
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
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const shouldShowTasksTab = false;

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  const chatTabs = useChatTabs(selectedProject, onNavigateToSession);

  // Track previous selectedSession ID to detect user-initiated navigation
  // (sidebar click, project switch) vs system-initiated changes (session-created).
  // Only sync tabs on user navigation — system changes must NOT create/update tabs.
  const prevSessionRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prevId = prevSessionRef.current;
    const currId = selectedSession?.id ?? null;
    prevSessionRef.current = currId;

    if (prevId === undefined) return;

    const action = resolveChatTabSyncAction({
      activeAppTab: activeTab,
      hasSelectedProject: Boolean(selectedProject),
      nextSessionId: currId,
      activeChatTabSessionId: chatTabs.activeTab?.sessionId,
      tabCount: chatTabs.tabs.length,
      navigationSource: sessionNavigationSource,
    });

    if (action === 'open-new-tab') {
      chatTabs.openNewTab();
      return;
    }

    if (action === 'update-active-tab-session' && currId && selectedProject) {
      chatTabs.updateActiveTabSession(selectedSession!, selectedProject);
      return;
    }

    if (action === 'open-tab' && currId && selectedProject) {
      chatTabs.openTab(selectedSession!, selectedProject);
    }
  }, [selectedSession?.id, selectedProject?.name, activeTab, sessionNavigationSource]);

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
          <AutoResearchHub />
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
          <NewsDashboard />
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
          <ComputeResourcesDashboard />
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
        <div className={`flex flex-col min-h-0 overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
          <div className={`h-full flex flex-col ${activeTab === 'chat' ? '' : 'hidden'}`}>
            <ChatTabBar
              tabs={chatTabs.tabs}
              processingSessions={processingSessions}
              onSwitchTab={chatTabs.switchTab}
              onCloseTab={chatTabs.closeTab}
              onNewTab={chatTabs.openNewTab}
            />
            <ErrorBoundary showDetails>
              <ChatInterface
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                ws={ws}
                sendMessage={sendMessage}
                latestMessage={latestMessage}
                onFileOpen={handleFileOpen}
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
            </ErrorBoundary>
          </div>

          {activeTab === 'survey' && (
            <div className="h-full overflow-hidden">
              <SurveyPage
                selectedProject={selectedProject}
                onChatFromReference={onChatFromReference ? (ref: Reference) => onChatFromReference(selectedProject, ref) : undefined}
              />
            </div>
          )}

          <div className={`h-full overflow-hidden ${activeTab === 'preview' ? 'block' : 'hidden'}`} />
        </div>

        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
          selectedProject={selectedProject}
          onStartWorkspaceQa={onStartWorkspaceQa}
          fillSpace={false}
        />
      </div>
    </div>
  );
}

export default React.memo(MainContent);
