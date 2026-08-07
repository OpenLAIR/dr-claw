// ResearchFlow Portfolio — full-page overview of all ResearchFlow projects.
// Every card consumes the backend-aggregated list (current stage, overall
// progress, blockers, next critical action, health) — the same domain results
// the Dashboard uses.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarClock, Plus, Target } from 'lucide-react';
import Progress from './Progress';
import HealthBadge from './HealthBadge';
import DataBackupPanel from './DataBackupPanel';

export default function Portfolio({ projects, onCreate, onOpenProject, onRefresh, creating, setCreating, error }) {
  const { t } = useTranslation('researchflow');
  const [name, setName] = useState('');

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
    setName('');
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{t('portfolio.title')}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            {t('common.retry')}
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            {t('portfolio.create')}
          </button>
        </div>
      </div>

      {creating && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card p-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('portfolio.newProjectName')}
            className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            autoFocus
          />
          <button
            type="button"
            disabled={!name.trim()}
            onClick={handleCreate}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {t('portfolio.createModalConfirm')}
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            {t('portfolio.createModalCancel')}
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {t('portfolio.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onOpenProject(project.id)}
              className="group rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-foreground">{project.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {project.currentStage?.name ?? t('common.noStage')}
                  </div>
                </div>
                <HealthBadge health={project.health} />
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('portfolio.overallProgress')}</span>
                  <span>{Math.round(project.overallProgress * 100)}%</span>
                </div>
                <Progress value={project.overallProgress} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {project.targetVenue && (
                  <span className="inline-flex items-center gap-1">
                    <Target className="h-3 w-3" />
                    {project.targetVenue}
                  </span>
                )}
                {project.deadline && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" />
                    {project.daysRemaining !== null && project.daysRemaining < 0
                      ? t('dashboard.daysOverdue', { days: Math.abs(project.daysRemaining) })
                      : t('portfolio.daysRemaining', { days: project.daysRemaining })}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  {t('portfolio.blockers')}: {project.blockerCount}
                </span>
              </div>

              <div className="mt-3 border-t border-border pt-2 text-xs">
                <span className="text-muted-foreground">{t('portfolio.nextCriticalAction')}: </span>
                {project.nextCriticalAction ? (
                  <span className="font-medium text-foreground">{project.nextCriticalAction.title}</span>
                ) : (
                  <span className="text-muted-foreground">{t('portfolio.noNextAction')}</span>
                )}
              </div>

              <div className="mt-2 flex items-center justify-end text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                {t('workspace.tabs_dashboard')}
                <ArrowRight className="ml-1 h-3 w-3" />
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        <DataBackupPanel />
      </div>
    </div>
  );
}
