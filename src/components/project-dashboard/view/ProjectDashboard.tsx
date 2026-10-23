import { ArrowRight, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { formatTimeAgo } from '../../../utils/dateUtils';
import type { AppTab, Project } from '../../../types/app';
import { projectSummary, sortProjects } from '../utils/projectSummary';

import { useResearchStatus } from '../utils/useResearchStatus';
import ResearchStatusLabel from './ResearchStatusLabel';

type Props = {
  projects: Project[];
  processingSessions: Set<string>;
  onProjectAction: (project: Project, tab: AppTab, sessionId?: string | null) => void;
  onCreateProject: () => void;
  error?: boolean;
  onRetry?: () => void;
};

export default function ProjectDashboard({ projects, processingSessions, onProjectAction, onCreateProject, error, onRetry }: Props) {
  const { t } = useTranslation('common');
  const { statuses, retry: retryStatus } = useResearchStatus(projects.map(project => project.name));
  const [query, setQuery] = useState('');
  const [usage, setUsage] = useState<{ todayTokens?: number; weekTokens?: number } | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const rows = useMemo(() => sortProjects(projects, processingSessions, statuses).filter(project =>
    `${project.displayName} ${project.fullPath}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [projects, processingSessions, statuses, query]);
  useEffect(() => {
    if (!showUsage || !projects.length) return;
    let cancelled = false;
    api.projectTokenUsageSummary(projects).then(async response => {
      if (!response.ok) throw new Error('usage');
      const data = await response.json();
      if (!cancelled) setUsage(data.workspace);
    }).catch(() => { if (!cancelled) setUsage(null); });
    return () => { cancelled = true; };
  }, [showUsage, projects]);
  const formatUsage = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

  return (
    <div className="h-full overflow-y-auto bg-background">
      <main className="workbench-page">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('workbench.projects')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('workbench.projectsDescription')}</p>
          </div>
          <Button onClick={onCreateProject}><Plus />{t('workbench.newProject')}</Button>
        </div>
        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label={t('workbench.searchProjects')} placeholder={t('workbench.searchProjects')} value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{t('workbench.projectCount', { count: rows.length })}</span>
        </div>
        <section aria-label={t('workbench.projects')} className="mt-4 border-y border-border">
          {error && <div role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm"><span>{t('workbench.projectsError')}</span><Button variant="outline" onClick={onRetry}>{t('buttons.retry')}</Button></div>}
          {rows.length === 0 && !error ? (
            <div className="py-10">
              <h2 className="text-base font-medium">{t(projects.length ? 'workbench.noMatches' : 'projectDashboard.emptyTitle')}</h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t(projects.length ? 'workbench.adjustSearch' : 'projectDashboard.emptyDescription')}</p>
              {!projects.length && <Button variant="outline" className="mt-4" onClick={onCreateProject}>{t('workbench.newProject')}</Button>}
            </div>
          ) : rows.map(project => {
            const summary = projectSummary(project, processingSessions, statuses[project.name]);
            return (
              <article key={project.name} className="project-row">
                <button onClick={() => onProjectAction(project, 'overview')} className="min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block truncate text-sm font-semibold" title={project.displayName}>{project.displayName}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground" title={project.fullPath}>{project.fullPath}</span>
                </button>
                <div className="min-w-0 text-xs">
                  <ResearchStatusLabel running={summary.running} needsAttention={summary.needsAttention} status={statuses[project.name]} onRetry={retryStatus} />
                  <div className="mt-1 text-muted-foreground">{summary.lastActivity ? formatTimeAgo(new Date(summary.lastActivity).toISOString(), new Date(), t) : t('workbench.noActivity')}</div>
                </div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  <span>{summary.total === null ? t('workbench.noPlan') : t('workbench.taskProgress', { completed: summary.completed ?? '—', total: summary.total })}</span>
                  {summary.progress !== null && <div className="mt-2 h-1 rounded-full bg-muted" role="progressbar" aria-label={t('projectDashboard.progressTitle')} aria-valuenow={summary.progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-blue-600 dark:bg-blue-400" style={{ width: `${summary.progress}%` }} /></div>}
                </div>
                <Button variant="ghost" size="sm" className="justify-self-end" onClick={() => summary.sessions[0] ? onProjectAction(project, 'chat', summary.sessions[0].id) : onProjectAction(project, 'overview')}>
                  {t(summary.sessions.length ? 'workbench.continue' : 'tabs.overview')}<ArrowRight />
                </Button>
              </article>
            );
          })}
        </section>
        <details className="mt-6 text-xs text-muted-foreground" onToggle={e => setShowUsage(e.currentTarget.open)}>
          <summary className="w-fit cursor-pointer rounded py-2 focus-visible:outline focus-visible:outline-2">{t('workbench.usage')}</summary>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2 tabular-nums">
            <span>{t('projectDashboard.summary.todayTokens')}: {formatUsage(usage?.todayTokens)}</span>
            <span>{t('projectDashboard.summary.weekTokens')}: {formatUsage(usage?.weekTokens)}</span>
          </div>
        </details>
      </main>
    </div>
  );
}
