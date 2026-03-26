import React, { useEffect } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import FileTree from '../../FileTree';
import GitPanel from '../../GitPanel';
import ResearchLab from '../../ResearchLab';
import SkillsDashboard from '../../SkillsDashboard';
import ComputePanel from '../../ComputePanel';
import ErrorBoundary from '../../ErrorBoundary';
import SurveyPage from '../../survey/view/SurveyPage';
import ProjectDashboard from '../../project-dashboard/view/ProjectDashboard';
import TrashDashboard from '../../project-dashboard/view/TrashDashboard';
import NewsDashboard from '../../news-dashboard/view/NewsDashboard';
import CommunityToolsPanel from '../../CommunityToolsPanel';
import ResearchRunViewer from '../../ResearchRunViewer';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import EditorSidebar from './subcomponents/EditorSidebar';
import ShellWorkspace from './subcomponents/ShellWorkspace';
import type { MainContentProps } from '../types/types';

import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../hooks/useEditorSidebar';
import type { Project } from '../../../types/app';

const AnyGitPanel = GitPanel as any;

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
  newSessionMode,
  onNewSessionModeChange,
  onOpenCommunityToolTerminal,
  selectedResearchTool,
  selectedResearchRun,
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

  useEffect(() => {
    if (selectedProject && selectedProject !== currentProject) {
      setCurrentProject?.(selectedProject);
    }
  }, [selectedProject, currentProject, setCurrentProject]);

  useEffect(() => {
    if (activeTab === 'tasks') {
      setActiveTab('researchlab');
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
            onProjectAction={(project, tab, sessionId, sessionProvider) => {
              onProjectSelect(project);
              setActiveTab(tab);
              if (sessionId && tab === 'chat') {
                onNavigateToSession(sessionId, sessionProvider, project.name);
              }
            }}
          />
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
          <SkillsDashboard />
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

  const isGlobalTab = activeTab === 'community-tools' || activeTab === 'research-run' || activeTab === 'news';

  if (!selectedProject && !isGlobalTab) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="h-full flex flex-col">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={isGlobalTab ? null : selectedProject ?? null}
        selectedSession={isGlobalTab ? null : selectedSession ?? null}
        shouldShowTasksTab={shouldShowTasksTab}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Global tabs — CSS-toggled to preserve sibling component state */}
        <div className={`flex-1 min-h-0 overflow-hidden ${activeTab === 'community-tools' ? '' : 'hidden'}`}>
          <CommunityToolsPanel onOpenTerminal={onOpenCommunityToolTerminal} />
        </div>
        <div className={`flex-1 min-h-0 overflow-hidden ${activeTab === 'research-run' && selectedResearchTool && selectedResearchRun ? '' : 'hidden'}`}>
          {selectedResearchTool && selectedResearchRun && (
            <ResearchRunViewer
              toolId={selectedResearchTool}
              runPath={selectedResearchRun}
              onOpenTerminal={onOpenCommunityToolTerminal}
            />
          )}
        </div>
        <div className={`flex-1 min-h-0 overflow-hidden ${activeTab === 'news' ? '' : 'hidden'}`}>
          <NewsDashboard />
        </div>

        {/* Project-specific tabs — only rendered when a project is selected */}
        {selectedProject && (
          <>
            <div className={`flex flex-col min-h-0 overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1 ${isGlobalTab ? 'hidden' : ''}`}>
              <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
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
                    onShowAllTasks={() => setActiveTab('researchlab')}
                    pendingAutoIntake={pendingAutoIntake}
                    clearPendingAutoIntake={clearPendingAutoIntake}
                    importedProjectAnalysisPrompt={importedProjectAnalysisPrompt}
                    clearImportedProjectAnalysisPrompt={clearImportedProjectAnalysisPrompt}
                    onOpenShellForSession={() => setActiveTab('shell')}
                    newSessionMode={newSessionMode}
                    onNewSessionModeChange={onNewSessionModeChange}
                  />
                </ErrorBoundary>
              </div>

              {activeTab === 'files' && (
                <div className="h-full overflow-hidden">
                  <FileTree
                    selectedProject={selectedProject}
                    onFileOpen={handleFileOpen}
                    onStartWorkspaceQa={onStartWorkspaceQa}
                  />
                </div>
              )}

              {activeTab === 'shell' && (
                <div className="h-full w-full overflow-hidden">
                  <ShellWorkspace project={selectedProject} session={selectedSession} />
                </div>
              )}

              {activeTab === 'git' && (
                <div className="h-full overflow-hidden">
                  <AnyGitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
                </div>
              )}

              {activeTab === 'survey' && (
                <div className="h-full overflow-hidden">
                  <SurveyPage selectedProject={selectedProject} />
                </div>
              )}

              {activeTab === 'researchlab' && (
                <div className="h-full overflow-hidden">
                  <ResearchLab
                    selectedProject={selectedProject}
                    onNavigateToChat={() => setActiveTab('chat')}
                  />
                </div>
              )}

              {activeTab === 'compute' && (
                <div className="h-full overflow-hidden">
                  <ComputePanel selectedProject={selectedProject} />
                </div>
              )}

              <div className={`h-full overflow-hidden ${activeTab === 'preview' ? 'block' : 'hidden'}`} />
            </div>

            {!isGlobalTab && (
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
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default React.memo(MainContent);
