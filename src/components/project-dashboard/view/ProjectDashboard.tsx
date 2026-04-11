import {
  Activity,
  ArrowRight,
  FolderOpen,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import { Button } from '../../ui/button';
import { formatTimeAgo } from '../../../utils/dateUtils';
import type { AppTab, Project, ProjectSession } from '../../../types/app';
import { CLAUDE_MODELS, CODEX_MODELS, GEMINI_MODELS, OPENROUTER_MODELS } from '../../../../shared/modelConstants';

type AutoResearchProvider = 'claude' | 'codex' | 'gemini' | 'openrouter';

type ProjectDashboardProps = {
  projects: Project[];
  onProjectAction: (
    project: Project,
    tab: AppTab,
    sessionId?: string | null,
  ) => void;
};

type TaskmasterMetadata = {
  taskCount?: number;
  completed?: number;
  completionPercentage?: number;
  lastModified?: string;
};

type TokenUsageTotals = {
  todayTokens: number;
  weekTokens: number;
};

type ProjectTokenUsageSummary = {
  generatedAt?: string;
  workspace: TokenUsageTotals;
  projects: Record<string, TokenUsageTotals>;
};

type AutoResearchRun = {
  id: string;
  status: string;
  provider?: AutoResearchProvider;
  sessionId?: string | null;
  currentTaskId?: string | null;
  completedTasks?: number;
  totalTasks?: number;
  error?: string | null;
  metadata?: {
    autoResearchModel?: string | null;
  } | null;
};

type AutoResearchStatus = {
  provider?: AutoResearchProvider;
  eligibility?: {
    eligible: boolean;
    reasons: string[];
  };
  profile?: {
    notificationEmail?: string | null;
  };
  mail?: {
    senderEmail?: string | null;
  };
  pipeline?: {
    hasResearchBrief?: boolean;
    hasTasksFile?: boolean;
    actionableTaskCount?: number;
    completedTaskCount?: number;
    totalTaskCount?: number;
    nextTask?: {
      id?: string | number;
      title?: string;
    } | null;
  };
  activeRun?: AutoResearchRun | null;
  latestRun?: AutoResearchRun | null;
};

type AutoResearchConfig = {
  provider: AutoResearchProvider;
  model: string;
};

function getDefaultModelForProvider(provider: AutoResearchProvider): string {
  if (provider === 'codex') {
    return CODEX_MODELS.DEFAULT || 'gpt-5.4';
  }
  if (provider === 'gemini') {
    return GEMINI_MODELS.DEFAULT || 'gemini-2.5-flash';
  }
  if (provider === 'openrouter') {
    return OPENROUTER_MODELS.DEFAULT || 'anthropic/claude-sonnet-4';
  }
  return CLAUDE_MODELS.DEFAULT || 'sonnet';
}

function getDefaultConfig(provider: AutoResearchProvider = 'claude'): AutoResearchConfig {
  return {
    provider,
    model: getDefaultModelForProvider(provider),
  };
}

function getModelOptions(provider: AutoResearchProvider) {
  return AUTO_RESEARCH_MODELS_BY_PROVIDER[provider] ?? [];
}

function isModelValidForProvider(provider: AutoResearchProvider, model?: string | null) {
  if (!model) {
    return false;
  }
  if (provider === 'openrouter' && model.includes('/')) return true;
  return getModelOptions(provider).some((option) => option.value === model);
}

function getModelFromStatus(status?: AutoResearchStatus, provider: AutoResearchProvider = 'claude') {
  const candidateModel =
    status?.activeRun?.metadata?.autoResearchModel || status?.latestRun?.metadata?.autoResearchModel || '';
  return isModelValidForProvider(provider, candidateModel)
    ? candidateModel
    : getDefaultModelForProvider(provider);
}

function resolveAutoResearchConfig(currentConfig: AutoResearchConfig | undefined, status?: AutoResearchStatus): AutoResearchConfig {
  const provider = currentConfig?.provider ?? status?.provider ?? 'claude';
  const statusModel = getModelFromStatus(status, provider);
  const model = isModelValidForProvider(provider, currentConfig?.model)
    ? currentConfig?.model ?? statusModel
    : statusModel;

  return {
    provider,
    model,
  };
}

const AUTO_RESEARCH_PROVIDER_OPTIONS: Array<{ value: AutoResearchProvider; label: string }> = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
];

const AUTO_RESEARCH_MODELS_BY_PROVIDER: Record<AutoResearchProvider, { value: string; label: string }[]> = {
  claude: CLAUDE_MODELS.OPTIONS,
  codex: CODEX_MODELS.OPTIONS,
  gemini: GEMINI_MODELS.OPTIONS,
  openrouter: OPENROUTER_MODELS.OPTIONS,
};

const PROJECT_TONES = [
  {
    shell: 'from-sky-100/95 via-cyan-50/90 to-white dark:from-sky-950/35 dark:via-cyan-950/20 dark:to-slate-950/80',
    orb: 'bg-sky-300/35 dark:bg-sky-500/20',
    border: 'hover:border-sky-300/60 dark:hover:border-sky-700/60',
    progress: 'from-sky-500 via-cyan-500 to-emerald-500',
    badge: 'border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-200',
  },
  {
    shell: 'from-emerald-100/95 via-teal-50/90 to-white dark:from-emerald-950/35 dark:via-teal-950/20 dark:to-slate-950/80',
    orb: 'bg-emerald-300/35 dark:bg-emerald-500/20',
    border: 'hover:border-emerald-300/60 dark:hover:border-emerald-700/60',
    progress: 'from-emerald-500 via-teal-500 to-cyan-500',
    badge: 'border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200',
  },
  {
    shell: 'from-amber-100/95 via-orange-50/90 to-white dark:from-amber-950/35 dark:via-orange-950/20 dark:to-slate-950/80',
    orb: 'bg-amber-300/35 dark:bg-amber-500/20',
    border: 'hover:border-amber-300/60 dark:hover:border-amber-700/60',
    progress: 'from-amber-500 via-orange-500 to-rose-500',
    badge: 'border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200',
  },
  {
    shell: 'from-indigo-100/95 via-violet-50/90 to-white dark:from-indigo-950/35 dark:via-violet-950/20 dark:to-slate-950/80',
    orb: 'bg-indigo-300/35 dark:bg-indigo-500/20',
    border: 'hover:border-indigo-300/60 dark:hover:border-indigo-700/60',
    progress: 'from-indigo-500 via-violet-500 to-fuchsia-500',
    badge: 'border-indigo-200/80 bg-indigo-50 text-indigo-700 dark:border-indigo-800/60 dark:bg-indigo-950/40 dark:text-indigo-200',
  },
] as const;

function getProjectSessions(project: Project): ProjectSession[] {
  return [
    ...(project.sessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.geminiSessions ?? []),
    ...(project.openrouterSessions ?? []),
    ...(project.localSessions ?? []),
    ...(project.nanoSessions ?? []),
  ];
}

function getLastActivity(project: Project) {
  const sessionDates = getProjectSessions(project)
    .map((session) => session.updated_at || session.lastActivity || session.created_at || session.createdAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  if (sessionDates.length > 0) {
    return sessionDates[0].toISOString();
  }

  return project.createdAt ?? null;
}


function getTaskmasterMetadata(project: Project): TaskmasterMetadata | null {
  const metadata = project.taskmaster?.metadata;

  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return metadata as TaskmasterMetadata;
}

function getProgress(project: Project) {
  const metadata = getTaskmasterMetadata(project);

  if (typeof metadata?.completionPercentage === 'number') {
    return Math.max(0, Math.min(100, metadata.completionPercentage));
  }

  return null;
}

function formatTokenCount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }

  return value.toLocaleString();
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/45">
      <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      {detail ? <div className="mt-2 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function MetricPill({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <div className="text-[7px] uppercase tracking-[0.1em] text-muted-foreground whitespace-nowrap">{label}</div>
      <div className="text-[11px] font-semibold text-foreground">{value}</div>
    </div>
  );
}

export default function ProjectDashboard({
  projects,
  onProjectAction,
}: ProjectDashboardProps) {
  const { t } = useTranslation('common');
  const now = new Date();
  const [tokenUsageSummary, setTokenUsageSummary] = useState<ProjectTokenUsageSummary | null>(null);
  const totals = useMemo(() => {
    const projectCount = projects.length;
    const projectsWithProgress = projects.filter((project) => getProgress(project) !== null);
    const trackedProjects = projectsWithProgress.length;
    const averageProgress = trackedProjects > 0
      ? Math.round(
          projectsWithProgress.reduce((sum, project) => sum + (getProgress(project) ?? 0), 0) / trackedProjects,
        )
      : null;
    const totalSessions = projects.reduce((sum, project) => sum + getProjectSessions(project).length, 0);

    const mostRecentlyActiveProject = [...projects]
      .map((project) => ({
        project,
        lastActivity: getLastActivity(project),
      }))
      .filter((entry): entry is { project: Project; lastActivity: string } => Boolean(entry.lastActivity))
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())[0] ?? null;

    return {
      projectCount,
      trackedProjects,
      averageProgress,
      totalSessions,
      mostRecentlyActiveProject,
    };
  }, [projects]);

  const projectUsageRefreshKey = useMemo(
    () => projects
      .map((project) => `${project.name}:${project.fullPath}:${getLastActivity(project) ?? ''}:${getProjectSessions(project).length}`)
      .sort()
      .join('|'),
    [projects],
  );

  useEffect(() => {
    let cancelled = false;

    if (projects.length === 0) {
      setTokenUsageSummary(null);
      return () => {
        cancelled = true;
      };
    }

    const fetchProjectTokenUsageSummary = async () => {
      try {
        const response = await api.projectTokenUsageSummary(projects);
        if (!response.ok) {
          throw new Error(`Failed to fetch token usage summary: ${response.status}`);
        }

        const data = await response.json() as ProjectTokenUsageSummary;
        if (!cancelled) {
          setTokenUsageSummary(data);
        }
      } catch (error) {
        console.error('Error fetching project token usage summary:', error);
        if (!cancelled) {
          setTokenUsageSummary(null);
        }
      }
    };

    void fetchProjectTokenUsageSummary();

    return () => {
      cancelled = true;
    };
  }, [projectUsageRefreshKey]);

  if (projects.length === 0) {
    return (
      <div className="h-full overflow-auto bg-background">
        <div className="mx-auto flex h-full w-full max-w-[1600px] items-center p-4 sm:p-6">
          <div className="relative w-full overflow-hidden rounded-[32px] border border-border/60 bg-card/70 p-8 text-center shadow-sm backdrop-blur sm:p-12">
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-sky-500/10 via-cyan-400/10 to-emerald-400/10" />
            <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FolderOpen className="h-7 w-7" />
            </div>
            <h2 className="relative mt-5 text-3xl font-semibold tracking-tight text-foreground">
              {t('projectDashboard.emptyTitle')}
            </h2>
            <p className="relative mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              {t('projectDashboard.emptyDescription')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6">
        <section className="relative overflow-hidden rounded-[32px] border border-border/60 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.14),transparent_34%),linear-gradient(135deg,rgba(250,251,252,0.97),rgba(246,250,252,0.93))] p-6 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_34%),linear-gradient(135deg,rgba(6,10,20,0.96),rgba(15,23,42,0.90))] sm:p-7">
          <div className="absolute -right-12 -top-10 h-36 w-36 rounded-full bg-sky-100/40 blur-3xl dark:bg-sky-500/12" />
          <div className="absolute bottom-0 right-20 h-24 w-24 rounded-full bg-emerald-100/30 blur-2xl dark:bg-emerald-500/8" />

          <div className="relative grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.85fr)]">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200/70 bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-sky-700 shadow-sm dark:border-sky-800/60 dark:bg-slate-950/60 dark:text-sky-200">
                <Sparkles className="h-3.5 w-3.5" />
                {t('projectDashboard.overviewBadge')}
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {t('projectDashboard.title')}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                {t('projectDashboard.subtitle')}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <StatCard
                  label={t('projectDashboard.summary.projects')}
                  value={totals.projectCount}
                />
                <StatCard
                  label={t('projectDashboard.summary.sessions')}
                  value={totals.totalSessions}
                />
                <StatCard
                  label={t('projectDashboard.summary.tracked')}
                  value={totals.trackedProjects}
                  detail={t('projectDashboard.summary.trackedProjects', { count: totals.trackedProjects })}
                />
                <StatCard
                  label={t('projectDashboard.summary.progress')}
                  value={totals.averageProgress === null ? t('projectDashboard.notTrackedShort') : `${totals.averageProgress}%`}
                />
                <StatCard
                  label={t('projectDashboard.summary.todayTokens')}
                  value={formatTokenCount(tokenUsageSummary?.workspace?.todayTokens)}
                />
                <StatCard
                  label={t('projectDashboard.summary.weekTokens')}
                  value={formatTokenCount(tokenUsageSummary?.workspace?.weekTokens)}
                />
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[28px] border border-border/60 bg-card/78 p-5 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Activity className="h-4 w-4 text-primary" />
                  {t('projectDashboard.activityTitle')}
                </div>
                {totals.mostRecentlyActiveProject ? (
                  <div className="mt-4 rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm">
                    <div className="text-lg font-semibold text-foreground">
                      {totals.mostRecentlyActiveProject.project.displayName}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t('projectDashboard.lastActivity', {
                        time: formatTimeAgo(totals.mostRecentlyActiveProject.lastActivity, now, t),
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-border/60 bg-background/50 px-4 py-5 text-sm text-muted-foreground">
                    {t('projectDashboard.noRecentActivity')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {t('projectDashboard.projectsSectionTitle')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('projectDashboard.projectsSectionSubtitle')}
            </p>
          </div>
          <div className="hidden rounded-full border border-border/60 bg-background/70 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur sm:block">
            {t('projectDashboard.summary.projects')}: {totals.projectCount}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {projects.map((project, index) => {
            const sessions = getProjectSessions(project);
            const metadata = getTaskmasterMetadata(project);
            const progress = getProgress(project);
            const lastActivity = getLastActivity(project);
            const projectTokenUsage = tokenUsageSummary?.projects?.[project.name];
            const tone = PROJECT_TONES[index % PROJECT_TONES.length];

            return (
              <article
                key={project.name}
                className={`relative overflow-hidden rounded-2xl border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.90),rgba(248,250,252,0.82))] p-4 shadow-sm transition-all duration-200 ${tone.border} hover:-translate-y-0.5 hover:shadow-md dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.82))]`}
              >
                <div className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-r ${tone.shell}`} />
                <div className={`absolute right-4 top-4 h-12 w-12 rounded-full blur-2xl ${tone.orb}`} />

                <div className="relative flex flex-col gap-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
                          {project.displayName}
                        </h2>
                        {progress !== null ? (
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tone.badge}`}>
                            {t('projectDashboard.progressBadge', { progress })}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-border/60 bg-background/75 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            {t('projectDashboard.notTrackedShort')}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground/60">
                        {project.fullPath}
                      </p>
                    </div>

                    <Button
                      variant="default"
                      size="sm"
                      className="self-start rounded-full"
                      onClick={() => onProjectAction(project, 'chat')}
                    >
                      <FolderOpen className="h-4 w-4" />
                      {t('projectDashboard.openProject')}
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0 rounded border border-border/30 bg-background/40 px-1.5 py-0.5 text-[10px]">
                    <MetricPill label={t('projectDashboard.metrics.sessions')} value={sessions.length} />
                    <MetricPill label={t('projectDashboard.metrics.tasks')} value={metadata?.taskCount ?? '0'} />
                    <MetricPill label={t('projectDashboard.metrics.completed')} value={metadata?.completed ?? '0'} />
                    <MetricPill
                      label={t('projectDashboard.metrics.todayTokens')}
                      value={formatTokenCount(projectTokenUsage?.todayTokens)}
                    />
                    <MetricPill
                      label={t('projectDashboard.metrics.weekTokens')}
                      value={formatTokenCount(projectTokenUsage?.weekTokens)}
                    />
                  </div>

                  <div className="rounded-lg border border-border/50 bg-background/70 px-2.5 py-2 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                        <Activity className="h-3 w-3 text-primary" />
                        {t('projectDashboard.progressTitle')}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {progress === null
                          ? t('projectDashboard.notTracked')
                          : t('projectDashboard.progressValue', { progress })}
                      </div>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/80">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${tone.progress} transition-[width] duration-300`}
                        style={{ width: `${progress ?? 6}%` }}
                      />
                    </div>
                  </div>

                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
