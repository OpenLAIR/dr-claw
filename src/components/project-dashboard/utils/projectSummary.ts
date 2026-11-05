import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import type { ResearchStatus } from './useResearchStatus';

const SESSION_FIELDS = [
  ['sessions', 'claude'], ['cursorSessions', 'cursor'], ['codexSessions', 'codex'],
  ['geminiSessions', 'gemini'], ['openrouterSessions', 'openrouter'],
  ['localSessions', 'local'], ['nanoSessions', 'nano'],
] as const;

export function sessionTime(session: ProjectSession): number {
  const time = Date.parse(session.lastActivity || session.updated_at || session.createdAt || session.created_at || '');
  return Number.isFinite(time) ? time : 0;
}

export function projectSessions(project: Project): ProjectSession[] {
  return SESSION_FIELDS.flatMap(([field, provider]) => (project[field] ?? []).map(session => ({
    ...session, __provider: provider as SessionProvider, __projectName: project.name,
  }))).sort((a, b) => sessionTime(b) - sessionTime(a));
}

export function projectSummary(project: Project, processingSessions: Set<string> = new Set(), research?: ResearchStatus) {
  const sessions = projectSessions(project);
  const metadata = project.taskmaster?.metadata;
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const total = finite(metadata?.taskCount);
  const completed = finite(metadata?.completed);
  const suppliedProgress = finite(metadata?.completionPercentage);
  const progress = suppliedProgress !== null ? Math.min(100, suppliedProgress)
    : total !== null && total > 0 && completed !== null ? Math.min(100, completed / total * 100) : null;
  const activeRun = research?.state === 'ready' ? research.activeRun : null;
  const latestRun = research?.state === 'ready' ? research.latestRun : null;
  const autoRunning = ['queued', 'running', 'cancelling'].includes(activeRun?.status || '');
  const running = autoRunning || sessions.some(session => processingSessions.has(session.id));
  const needsAttention = ['failed', 'error', 'blocked'].includes(project.taskmaster?.status || '') || (!autoRunning && latestRun?.status === 'failed');
  const dates = [Date.parse(latestRun?.finishedAt || latestRun?.startedAt || ''),Date.parse(project.createdAt || ''), Date.parse(String(metadata?.lastModified || '')), ...sessions.map(sessionTime)];
  const lastActivity = Math.max(0, ...dates.filter(Number.isFinite));
  return { sessions, total, completed, progress, running, needsAttention, lastActivity };
}

export function sortProjects(projects: Project[], processingSessions: Set<string>, statuses: Record<string, ResearchStatus> = {}) {
  return [...projects].sort((a, b) => {
    const x = projectSummary(a, processingSessions, statuses[a.name]), y = projectSummary(b, processingSessions, statuses[b.name]);
    return Number(y.needsAttention) - Number(x.needsAttention)
      || Number(y.running) - Number(x.running) || y.lastActivity - x.lastActivity;
  });
}
