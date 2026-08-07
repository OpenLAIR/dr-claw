// Project Dashboard — the "10-second state" view. Pure presentation: all
// aggregation (progress, next critical action, health) comes from the backend
// GET /api/rf/projects/:id/dashboard. No lifecycle logic lives in React.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarClock, Flag, Target } from 'lucide-react';
import Progress from './Progress';
import HealthBadge from './HealthBadge';

const InfoBlock = ({ icon: Icon, label, value }) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
    <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
  </div>
);

export default function Dashboard({ dashboard }) {
  const { t } = useTranslation('researchflow');
  if (!dashboard) return null;

  const {
    project,
    overallProgress,
    currentStage,
    daysRemaining,
    blockerCount,
    nextCriticalAction,
    health,
    taskSummary,
    gateSummary,
    experimentSummary,
    evidenceSummary,
    manuscriptSummary,
    resultsSummary,
    reviewSummary,
    submissionSummary,
  } = dashboard;

  const deadline = project.deadline
    ? daysRemaining !== null && daysRemaining < 0
      ? t('dashboard.daysOverdue', { days: Math.abs(daysRemaining) })
      : t('dashboard.daysRemaining', { days: daysRemaining })
    : '—';

  return (
    <div className="space-y-4 p-4">
      {/* Above the fold */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">{project.name}</h2>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            {project.targetVenue && (
              <span className="inline-flex items-center gap-1">
                <Target className="h-3.5 w-3.5" />
                {project.targetVenue}
              </span>
            )}
            {project.deadline && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                {deadline}
              </span>
            )}
          </div>
        </div>
        <HealthBadge health={health} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoBlock icon={Flag} label={t('dashboard.overallProgress')} value={`${Math.round(overallProgress * 100)}%`} />
        <InfoBlock
          icon={Target}
          label={t('dashboard.currentStage')}
          value={currentStage ? currentStage.name : t('common.noStage')}
        />
        <InfoBlock
          icon={Target}
          label={t('dashboard.currentStageProgress')}
          value={currentStage ? `${Math.round(currentStage.progress * 100)}%` : '—'}
        />
        <InfoBlock icon={AlertTriangle} label={t('dashboard.blockers')} value={blockerCount} />
      </div>

      {/* Next critical action */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs font-medium text-muted-foreground">{t('dashboard.nextCriticalAction')}</div>
        {nextCriticalAction ? (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{nextCriticalAction.title}</span>
            <span className="text-xs text-muted-foreground">
              {t(`nextAction.reasons.${nextCriticalAction.reasonCode}`, { defaultValue: nextCriticalAction.reasonCode })}
            </span>
          </div>
        ) : (
          <div className="mt-1 text-sm text-muted-foreground">{t('dashboard.noNextAction')}</div>
        )}
      </div>

      {/* Lifecycle status */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('dashboard.gateSummary')}</div>
          <div className="mt-1 text-sm font-semibold">
            {gateSummary.requiredTotal > 0
              ? `${gateSummary.passedRequired}/${gateSummary.requiredTotal}`
              : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('dashboard.tasks')}</div>
          <div className="mt-1 text-sm font-semibold">
            {taskSummary.total > 0 ? t('dashboard.taskSummary', { done: taskSummary.done, total: taskSummary.total }) : '0'}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('dashboard.lifecycleStatus')}</div>
          <div className="mt-2">
            <Progress value={overallProgress} />
          </div>
        </div>
      </div>

      {/* Phase 3: experiments & evidence (real data from the backend summary) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('dashboard.experimentSummary')}</div>
          <div className="mt-1.5 text-sm text-foreground">
            {experimentSummary && experimentSummary.total > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>{t('dashboard.runs')}: <b>{experimentSummary.runs.total}</b></span>
                <span className="text-emerald-600 dark:text-emerald-400">✓ {experimentSummary.runs.completed}</span>
                <span className="text-amber-600 dark:text-amber-400">↻ {experimentSummary.runs.running}</span>
                <span className="text-red-600 dark:text-red-400">✗ {experimentSummary.runs.failed}</span>
              </div>
            ) : (
              <span className="text-muted-foreground">{experimentSummary ? '0' : '—'}</span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('dashboard.evidenceSummary')}</div>
          <div className="mt-1.5 text-sm text-foreground">
            {evidenceSummary && evidenceSummary.coreClaimsTotal > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>{t('dashboard.coreClaims')}: <b>{evidenceSummary.coreClaimsTotal}</b></span>
                <span className={evidenceSummary.coreClaimsMissingEvidence > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                  {t('dashboard.coreClaimsMissing')}: {evidenceSummary.coreClaimsMissingEvidence}
                </span>
                {evidenceSummary.claimsWithContradictoryEvidence > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {t('dashboard.contradictory')}: {evidenceSummary.claimsWithContradictoryEvidence}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground">{evidenceSummary ? '0' : '—'}</span>
            )}
          </div>
        </div>
      </div>

      {/* Phase 4: manuscript / freeze / review / submission summaries */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('nav.manuscript')}</div>
          <div className="mt-1.5 text-sm text-foreground">
            {manuscriptSummary && manuscriptSummary.totalRequiredSections > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>{t('manuscript.completeness.final')}: <b>{manuscriptSummary.sectionsFinal}</b></span>
                <span className={manuscriptSummary.requiredSectionsComplete ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                  {manuscriptSummary.sectionsDraftOrBetter}/{manuscriptSummary.totalRequiredSections}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">{manuscriptSummary ? '0' : '—'}</span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('manuscript.freeze.title')}</div>
          <div className="mt-1.5 text-sm text-foreground">
            {resultsSummary ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className={
                  resultsSummary.freezeState === 'current' ? 'text-emerald-600 dark:text-emerald-400'
                    : resultsSummary.freezeState === 'stale' ? 'text-red-600 dark:text-red-400'
                      : 'text-muted-foreground'
                }>
                  {resultsSummary.hasFreeze
                    ? `#${resultsSummary.freezeNumber} · ${resultsSummary.freezeState === 'stale' ? t('manuscript.freeze.stale') : t('manuscript.freeze.current')}`
                    : t('manuscript.freeze.none')}
                </span>
                {resultsSummary.overrideReason && (
                  <span className="text-red-600 dark:text-red-400">{t('manuscript.freeze.overridden')}</span>
                )}
              </div>
            ) : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('manuscript.review.title')}</div>
          <div className="mt-1.5 text-sm text-foreground">
            {reviewSummary ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {reviewSummary.openCritical > 0 && (
                  <span className="text-red-600 dark:text-red-400">✗ {reviewSummary.openCritical} {t('manuscript.review.severities.critical')}</span>
                )}
                {reviewSummary.openMajor > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">! {reviewSummary.openMajor} {t('manuscript.review.severities.major')}</span>
                )}
                {reviewSummary.openCritical === 0 && reviewSummary.openMajor === 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                )}
              </div>
            ) : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('submission.title')}</div>
          <div className="mt-1.5 text-sm text-foreground">
            {submissionSummary ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{submissionSummary.doneChecks}/{submissionSummary.requiredChecks}</span>
                <span className={
                  submissionSummary.status === 'submitted' ? 'text-sky-600 dark:text-sky-400'
                    : submissionSummary.ready ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                }>
                  {submissionSummary.status === 'submitted' ? t('submission.submitted')
                    : submissionSummary.ready ? t('submission.ready') : t('submission.notReady')}
                </span>
              </div>
            ) : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
