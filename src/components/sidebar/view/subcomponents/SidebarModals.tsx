import { Suspense, useMemo } from 'react';
import type { ComponentType } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';
import LazyLoadBoundary, { LazyModalLoadingFallback } from '../../../LazyLoadBoundary';
import VersionUpgradeModal from '../../../modals/VersionUpgradeModal';
import lazyWithRetry from '../../../../utils/lazyWithRetry';
import type { Project } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import type { InstallMode } from '../../../../hooks/useVersionCheck';
import { normalizeProjectForSettings } from '../../utils/utils';
import type { DeleteProjectConfirmation, SessionDeleteConfirmation, SettingsProject } from '../../types/types';

type SidebarModalsProps = {
  projects: Project[];
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  deleteConfirmation: DeleteProjectConfirmation | null;
  onCancelDeleteProject: () => void;
  onConfirmDeleteProject: () => void;
  sessionDeleteConfirmation: SessionDeleteConfirmation | null;
  onCancelDeleteSession: () => void;
  onConfirmDeleteSession: () => void;
  showVersionModal: boolean;
  onCloseVersionModal: () => void;
  onLaterVersionModal: () => void;
  releaseInfo: ReleaseInfo | null;
  currentVersion: string;
  latestVersion: string | null;
  installMode: InstallMode;
  t: TFunction;
};

type TypedSettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects: SettingsProject[];
  initialTab: string;
};

const Settings = lazyWithRetry(() => import('../../../Settings')) as ComponentType<TypedSettingsProps>;

export default function SidebarModals({
  projects,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  deleteConfirmation,
  onCancelDeleteProject,
  onConfirmDeleteProject,
  sessionDeleteConfirmation,
  onCancelDeleteSession,
  onConfirmDeleteSession,
  showVersionModal,
  onCloseVersionModal,
  onLaterVersionModal,
  releaseInfo,
  currentVersion,
  latestVersion,
  installMode,
  t,
}: SidebarModalsProps) {
  const settingsProjects = useMemo(
    () => projects.map(normalizeProjectForSettings),
    [projects],
  );

  return (
    <>
      {showSettings &&
        ReactDOM.createPortal(
          <LazyLoadBoundary mode="modal" resetKey="settings" onClose={onCloseSettings}>
            <Suspense fallback={<LazyModalLoadingFallback onClose={onCloseSettings} />}>
              <Settings
                isOpen={showSettings}
                onClose={onCloseSettings}
                projects={settingsProjects}
                initialTab={settingsInitialTab}
              />
            </Suspense>
          </LazyLoadBoundary>,
          document.body,
        )}

      {deleteConfirmation &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {t('deleteConfirmation.deleteProject')}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-1">
                      {t('deleteConfirmation.confirmDelete')}{' '}
                      <span className="font-medium text-foreground">
                        {deleteConfirmation.project.displayName || deleteConfirmation.project.name}
                      </span>
                      ?
                    </p>
                    {deleteConfirmation.sessionCount > 0 && (
                      <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                          {t('deleteConfirmation.sessionCount', { count: deleteConfirmation.sessionCount })}
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          {t('deleteConfirmation.allConversationsDeleted')}
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-3">
                      {t('deleteConfirmation.cannotUndo')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 p-4 bg-muted/30 border-t border-border">
                <Button variant="outline" className="flex-1" onClick={onCancelDeleteProject}>
                  {t('actions.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  onClick={onConfirmDeleteProject}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('actions.delete')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {sessionDeleteConfirmation &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {t('deleteConfirmation.deleteSession')}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-1">
                      {t('deleteConfirmation.confirmDelete')}{' '}
                      <span className="font-medium text-foreground">
                        {sessionDeleteConfirmation.sessionTitle || t('sessions.unnamed')}
                      </span>
                      ?
                    </p>
                    <p className="text-xs text-muted-foreground mt-3">
                      {t('deleteConfirmation.cannotUndo')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 p-4 bg-muted/30 border-t border-border">
                <Button variant="outline" className="flex-1" onClick={onCancelDeleteSession}>
                  {t('actions.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  onClick={onConfirmDeleteSession}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('actions.delete')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Stays mounted while closed: it owns the in-flight update output, and
          unmounting it would both drop that output and let a reopened instance
          start a second concurrent update. It is small enough not to lazy-load. */}
      <VersionUpgradeModal
        isOpen={showVersionModal}
        onClose={onCloseVersionModal}
        onLater={onLaterVersionModal}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
      />
    </>
  );
}
