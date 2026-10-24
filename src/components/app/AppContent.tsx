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
  const [connectionLost, setConnectionLost] = useState(false);
  useEffect(() => {
    if (isConnected) { setConnectionLost(false); return; }
    const timer = window.setTimeout(() => setConnectionLost(true), 3000);
    return () => window.clearTimeout(timer);
  }, [isConnected]);
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
    projectsError,
    isLoadingTrashProjects,
    isInputFocused,
    externalMessageUpdate,
    importedProjectAnalysisPrompt,
    newSessionMode,
    sessionNavigationSource,
    resetSessionNavigationSource,
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
    handleNewSession,
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

  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const trigger = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex="0"]') ?? []).filter(el => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // Native child dialogs own their keyboard handling while open.
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); trigger?.focus(); };
  }, [isMobile, sidebarOpen, setSidebarOpen]);

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
  const sidebarContainerRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef(sidebarWidth);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let width = sidebarWidth;
    const step = event.shiftKey ? 40 : 10;
    if (event.key === 'ArrowLeft') width -= step;
    else if (event.key === 'ArrowRight') width += step;
    else if (event.key === 'Home') width = SIDEBAR_MIN;
    else if (event.key === 'End') width = SIDEBAR_MAX;
    else return;
    event.preventDefault();
    width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));
    pendingWidthRef.current = width;
    setSidebarWidth(width);
    localStorage.setItem(STORAGE_KEY, String(width));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  };

  useEffect(() => () => {
    resizeCleanupRef.current?.();
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeCleanupRef.current?.();
    e.currentTarget.focus();
    isResizing.current = true;
    sidebarContainerRef.current?.style.setProperty('transition', 'none');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      pendingWidthRef.current = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX));
      if (resizeFrameRef.current !== null) return;

      resizeFrameRef.current = requestAnimationFrame(() => {
        if (sidebarContainerRef.current) {
          sidebarContainerRef.current.style.width = `${pendingWidthRef.current}px`;
        }
        resizeFrameRef.current = null;
      });
    };

    const cleanupResize = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onMouseUp);
      resizeCleanupRef.current = null;
    };

    const onMouseUp = () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      const finalWidth = pendingWidthRef.current;
      sidebarContainerRef.current?.style.setProperty('width', `${finalWidth}px`);
      setSidebarWidth(finalWidth);
      localStorage.setItem(STORAGE_KEY, String(finalWidth));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      sidebarContainerRef.current?.style.removeProperty('transition');
      cleanupResize();
    };

    resizeCleanupRef.current = cleanupResize;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onMouseUp);
  }, []);

  return (
    <div className="fixed inset-0 flex bg-background">
      {!isMobile ? (
        <div
          ref={sidebarContainerRef}
          className="h-full flex-shrink-0 relative transition-[width] duration-150 ease-out"
          style={{ width: desktopSidebarWidth }}
        >
          <div className="h-full border-r border-border/50">
            <Sidebar {...sidebarSharedProps} />
          </div>
          {sidebarVisible && (
            <div
              role="separator"
              tabIndex={0}
              aria-label={t('workbench.resizeSidebar')}
              aria-orientation="vertical"
              aria-valuemin={SIDEBAR_MIN}
              aria-valuemax={SIDEBAR_MAX}
              aria-valuenow={sidebarWidth}
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 z-10 electron-no-drag"
              onMouseDown={handleResizeStart}
              onKeyDown={handleResizeKeyDown}
            />
          )}
        </div>
      ) : (
        <div
          ref={drawerRef}
          role={sidebarOpen ? 'dialog' : undefined}
          aria-modal={sidebarOpen ? true : undefined}
          aria-label={t('workbench.projects')}
          className={`fixed inset-0 z-[70] flex transition-[opacity,visibility] duration-150 ease-out ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
            }`}
        >
          <button
            className="fixed inset-0 bg-black/40 transition-opacity duration-150 ease-out"
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
            <Sidebar {...sidebarSharedProps} onCloseMobile={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div {...(isMobile && sidebarOpen ? { inert: '' } : {})} className={`flex-1 flex flex-col min-w-0 ${isMobile ? 'pb-mobile-nav' : ''}`}>
        {connectionLost && <div role="status" className="shrink-0 border-b border-border bg-muted px-4 py-2 text-sm text-foreground">{t('workbench.disconnected')}</div>}
        <div className="min-h-0 flex-1">
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
          projectsError={projectsError}
          onRetryProjects={fetchProjects}
          isTrashLoading={isLoadingTrashProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionActive={markSessionAsActive}
          onSessionInactive={markSessionAsInactive}
          onSessionProcessing={markSessionAsProcessing}
          onSessionNotProcessing={markSessionAsNotProcessing}
          processingSessions={processingSessions}
          onReplaceTemporarySession={replaceTemporarySession}
          onNavigateToSession={(targetSessionId: string, targetProvider?, targetProjectName?, options?) =>
            handleNavigateToSession(targetSessionId, targetProvider, targetProjectName, options)}
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
          sessionNavigationSource={sessionNavigationSource}
          onResetNavigationSource={resetSessionNavigationSource}
          onNewSession={handleNewSession}
        />
        </div>
      </div>

      {isMobile && !sidebarOpen && (
        <MobileNav
            selectedProject={selectedProject}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isInputFocused={isInputFocused}
        />
      )}

    </div>
  );
}
