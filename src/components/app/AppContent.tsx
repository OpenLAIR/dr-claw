import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import MobileNav from '../MobileNav';

import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useDesktop } from '../../hooks/useDesktop';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useInteractionTelemetry } from '../../hooks/useInteractionTelemetry';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import {
  ensureTelemetryDefaultEnabled,
  isTelemetryEnabled,
  TELEMETRY_SETTINGS_EVENT,
} from '../../utils/telemetry';

export default function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { isDesktop, on: onDesktopEvent } = useDesktop();
  const { ws, sendMessage, latestMessage, isConnected } = useWebSocket();
  const { preferences } = useUiPreferences();
  const { sidebarVisible } = preferences;

  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
  } = useSessionProtection();

  const {
    projects,
    trashProjects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    isLoadingTrashProjects,
    isInputFocused,
    externalMessageUpdate,
    importedProjectAnalysisPrompt,
    newSessionMode,
    setNewSessionMode,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    fetchTrashProjects,
    sidebarSharedProps,
    handleProjectSelect,
    handleNavigateToSession,
    handleStartWorkspaceQa,
    handleChatFromReference,
    pendingAutoIntake,
    handleProjectCreatedWithIntake,
    clearPendingAutoIntake,
    clearImportedProjectAnalysisPrompt,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
  });

  useInteractionTelemetry({
    selectedProjectName: selectedProject?.name || null,
    selectedSessionId: selectedSession?.id || sessionId || null,
    activeTab: activeTab || null,
    routePath: location.pathname || null,
  });

  useEffect(() => {
    ensureTelemetryDefaultEnabled();
  }, []);

  useEffect(() => {
    window.refreshProjects = fetchProjects;

    return () => {
      if (window.refreshProjects === fetchProjects) {
        delete window.refreshProjects;
      }
    };
  }, [fetchProjects]);

  useEffect(() => {
    window.refreshTrashProjects = fetchTrashProjects;

    return () => {
      if (window.refreshTrashProjects === fetchTrashProjects) {
        delete window.refreshTrashProjects;
      }
    };
  }, [fetchTrashProjects]);

  useEffect(() => {
    window.openSettings = openSettings;

    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  useEffect(() => {
    window.handleProjectCreatedWithIntake = handleProjectCreatedWithIntake;

    return () => {
      if (window.handleProjectCreatedWithIntake === handleProjectCreatedWithIntake) {
        delete window.handleProjectCreatedWithIntake;
      }
    };
  }, [handleProjectCreatedWithIntake]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const syncTelemetrySetting = () => {
      sendMessage({
        type: 'telemetry-settings',
        enabled: isTelemetryEnabled(),
      });
    };

    syncTelemetrySetting();
    window.addEventListener(TELEMETRY_SETTINGS_EVENT, syncTelemetrySetting);
    return () => {
      window.removeEventListener(TELEMETRY_SETTINGS_EVENT, syncTelemetrySetting);
    };
  }, [isConnected, sendMessage]);

  useEffect(() => {
    if (!isDesktop || !onDesktopEvent) {
      return;
    }

    const cleanup = onDesktopEvent('app:navigate', (payload: { action: string; path?: string }) => {
      switch (payload.action) {
        case 'openSettings':
          setShowSettings(true);
          break;
        case 'newChat':
          navigate('/');
          break;
        case 'openWorkspace':
          if (payload.path) {
            navigate('/');
          }
          break;
      }
    });

    return cleanup;
  }, [isDesktop, onDesktopEvent, navigate, setShowSettings]);

  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_DEFAULT = 288; // w-72
  const SIDEBAR_COLLAPSED_WIDTH = 48; // matches SidebarCollapsed w-12
  const STORAGE_KEY = 'dr-claw-sidebar-width';
  const LEGACY_STORAGE_KEY = 'vibelab-sidebar-width';

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = saved ? Number(saved) : NaN;
    return Number.isFinite(parsed) && parsed >= SIDEBAR_MIN && parsed <= SIDEBAR_MAX
      ? parsed
      : SIDEBAR_DEFAULT;
  });
  const desktopSidebarWidth = sidebarVisible ? sidebarWidth : SIDEBAR_COLLAPSED_WIDTH;

  const isResizing = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setSidebarWidth((w) => {
        localStorage.setItem(STORAGE_KEY, String(w));
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return w;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div className="fixed inset-0 flex bg-background">
      {!isMobile ? (
        <div
          className="h-full flex-shrink-0 relative transition-[width] duration-150 ease-out"
          style={{ width: desktopSidebarWidth }}
        >
          <div className="h-full border-r border-border/50">
            <Sidebar {...sidebarSharedProps} />
          </div>
          {sidebarVisible && (
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 z-10"
              onMouseDown={handleResizeStart}
            />
          )}
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative w-[85vw] max-w-sm sm:w-80 h-full bg-card border-r border-border/40 transform transition-transform duration-150 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} />
          </div>
        </div>
      )}

      <div className={`flex-1 flex flex-col min-w-0 ${isMobile ? 'pb-mobile-nav' : ''}`}>
        <MainContent
          projects={projects}
          trashProjects={trashProjects}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          latestMessage={latestMessage}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          isTrashLoading={isLoadingTrashProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionActive={markSessionAsActive}
          onSessionInactive={markSessionAsInactive}
          onSessionProcessing={markSessionAsProcessing}
          onSessionNotProcessing={markSessionAsNotProcessing}
          processingSessions={processingSessions}
          onReplaceTemporarySession={replaceTemporarySession}
          onNavigateToSession={(targetSessionId: string, targetProvider?, targetProjectName?) =>
            handleNavigateToSession(targetSessionId, targetProvider, targetProjectName)}
          onShowSettings={() => setShowSettings(true)}
          externalMessageUpdate={externalMessageUpdate}
          pendingAutoIntake={pendingAutoIntake}
          clearPendingAutoIntake={clearPendingAutoIntake}
          importedProjectAnalysisPrompt={importedProjectAnalysisPrompt}
          clearImportedProjectAnalysisPrompt={clearImportedProjectAnalysisPrompt}
          onProjectSelect={handleProjectSelect}
          onStartWorkspaceQa={handleStartWorkspaceQa}
          onChatFromReference={handleChatFromReference}
          newSessionMode={newSessionMode}
          onNewSessionModeChange={setNewSessionMode}
        />
      </div>

      {isMobile && (
        <MobileNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isInputFocused={isInputFocused}
        />
      )}

    </div>
  );
}
