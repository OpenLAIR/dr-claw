import { Suspense, useMemo } from 'react';
import type { ComponentType } from 'react';
import ReactDOM from 'react-dom';
import { Trash2 } from 'lucide-react';
import WorkbenchDialog from '../../../ui/WorkbenchDialog';
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
  deletionPending: 'project' | 'session' | null;
  projectDeleteError: string;
  sessionDeleteError: string;
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
  deletionPending,
  projectDeleteError,
  sessionDeleteError,
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

      {deleteConfirmation && (
        <WorkbenchDialog title={t('deleteConfirmation.deleteProject')} onClose={onCancelDeleteProject} busy={deletionPending === 'project'}>
          <p className="break-words text-sm">
            {t('deleteConfirmation.confirmDelete')}{' '}
            <strong>{deleteConfirmation.project.displayName || deleteConfirmation.project.name}</strong>?
          </p>
          {deleteConfirmation.sessionCount > 0 && (
            <div className="mt-4 space-y-1 border-t border-border pt-4 text-sm">
              <p>{t('deleteConfirmation.sessionCount', { count: deleteConfirmation.sessionCount })}</p>
              <p className="text-muted-foreground">{t('deleteConfirmation.allConversationsDeleted')}</p>
            </div>
          )}
          <p className="mt-3 text-sm text-muted-foreground">{t('deleteConfirmation.cannotUndo')}</p>
          {projectDeleteError && <p role="alert" className="mt-3 text-sm text-destructive">{projectDeleteError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" disabled={!!deletionPending} onClick={onCancelDeleteProject}>{t('actions.cancel')}</Button>
            <Button variant="destructive" disabled={!!deletionPending} onClick={onConfirmDeleteProject}><Trash2 />{t(deletionPending === 'project' ? 'actions.deleting' : 'actions.delete')}</Button>
          </div>
        </WorkbenchDialog>
      )}

      {sessionDeleteConfirmation && (
        <WorkbenchDialog title={t('deleteConfirmation.deleteSession')} onClose={onCancelDeleteSession} busy={deletionPending === 'session'}>
          <p className="break-words text-sm">
            {t('deleteConfirmation.confirmDelete')}{' '}
            <strong>{sessionDeleteConfirmation.sessionTitle || t('sessions.unnamed')}</strong>?
          </p>
          <p className="mt-3 text-sm text-muted-foreground">{t('deleteConfirmation.sessionCannotUndo')}</p>
          {sessionDeleteError && <p role="alert" className="mt-3 text-sm text-destructive">{sessionDeleteError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" disabled={!!deletionPending} onClick={onCancelDeleteSession}>{t('actions.cancel')}</Button>
            <Button variant="destructive" disabled={!!deletionPending} onClick={onConfirmDeleteSession}><Trash2 />{t(deletionPending === 'session' ? 'actions.deleting' : 'actions.delete')}</Button>
          </div>
        </WorkbenchDialog>
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
