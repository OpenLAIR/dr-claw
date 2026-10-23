import { AlertTriangle, ArchiveRestore, FolderX, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import type { TrashProject } from '../../../types/app';
import { Button } from '../../ui/button';
import { formatTimeAgo } from '../../../utils/dateUtils';

type TrashDashboardProps = {
  projects: TrashProject[];
  onRefresh: () => Promise<void> | void;
  isLoading?: boolean;
};

type DeleteMode = 'logical' | 'physical';

export default function TrashDashboard({ projects, onRefresh, isLoading = false }: TrashDashboardProps) {
  const { t } = useTranslation(['common', 'sidebar']);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrashProject | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const handleRestore = async (project: TrashProject) => {
    setErrorMessage(null);
    setLoadingKey(`restore:${project.name}`);
    try {
      const response = await api.restoreProject(project.name);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || t('sidebar:messages.deleteProjectFailed'));
      }
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('sidebar:messages.deleteProjectError'));
    } finally {
      setLoadingKey(null);
    }
  };

  const handleDelete = async (project: TrashProject, mode: DeleteMode) => {
    setErrorMessage(null);
    setLoadingKey(`${mode}:${project.name}`);
    try {
      const response = await api.deleteTrashedProject(project.name, mode);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || t('sidebar:messages.deleteProjectFailed'));
      }
      setDeleteTarget(null);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('sidebar:messages.deleteProjectError'));
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="workbench-page">
        <header className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">{t('common:tabs.trash')}</h1><p className="mt-2 text-sm text-muted-foreground">{t('common:projectDashboard.trashSubtitle')}</p></header>
        {errorMessage && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {errorMessage}
          </div>
        )}
        {isLoading ? (
          <div className="py-12 text-center">
            <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
            <p className="mt-6 text-sm text-muted-foreground">{t('common:status.loading')}</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="border-t border-border py-12 text-center">
            <div className="mx-auto flex h-8 w-8 items-center justify-center text-muted-foreground">
              <Trash2 className="h-7 w-7" />
            </div>
            <h2 className="mt-6 text-base font-semibold text-foreground">{t('common:projectDashboard.trashEmptyTitle')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              {t('common:projectDashboard.trashEmptyDescription')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {projects.map((project) => {
              const restoreKey = `restore:${project.name}`;
              const logicalKey = `logical:${project.name}`;
              const physicalKey = `physical:${project.name}`;

              return (
                <div
                  key={project.name}
                  className="py-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('common:projectDashboard.trashBadge')}
                      </div>
                      <h3 className="mt-2 break-words text-base font-semibold text-foreground">{project.displayName}</h3>
                      <p className="mt-1 break-all text-sm text-muted-foreground">{project.originalPath || project.fullPath}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="py-1">
                          {t('common:projectDashboard.trashDeletedAt', {
                            time: formatTimeAgo(project.trashedAt, currentTime, t),
                          })}
                        </span>
                        <span className="py-1">
                          {t('common:projectDashboard.trashSessions', { count: project.sessionCount ?? 0 })}
                        </span>
                        {!project.filesExist && (
                          <span className="rounded-full border border-amber-300/60 bg-amber-50 px-3 py-1 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                            {t('common:projectDashboard.trashFilesMissing')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button
                        variant="outline"
                        onClick={() => handleRestore(project)}
                        disabled={loadingKey !== null || !project.canRestore}
                      >
                        <ArchiveRestore className="mr-2 h-4 w-4" />
                        {loadingKey === restoreKey
                          ? t('common:status.loading')
                          : t('common:projectDashboard.restoreProject')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setDeleteTarget(project)}
                        disabled={loadingKey !== null}
                      >
                        <FolderX className="mr-2 h-4 w-4" />
                        {t('common:projectDashboard.deleteFromTrash')}
                      </Button>
                    </div>
                  </div>

                  {deleteTarget?.name === project.name && (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50/80 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-foreground">
                            {t('common:projectDashboard.trashDeleteTitle')}
                          </h4>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t('common:projectDashboard.trashDeleteDescription')}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setDeleteTarget(null)}
                              disabled={loadingKey !== null}
                            >
                              {t('sidebar:actions.cancel')}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => handleDelete(project, 'logical')}
                              disabled={loadingKey !== null}
                            >
                              {loadingKey === logicalKey
                                ? t('common:status.loading')
                                : t('common:projectDashboard.logicalDelete')}
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() => handleDelete(project, 'physical')}
                              disabled={loadingKey !== null}
                            >
                              {loadingKey === physicalKey
                                ? t('common:status.loading')
                                : t('common:projectDashboard.physicalDelete')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
