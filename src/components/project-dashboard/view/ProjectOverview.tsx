import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, FileText, MessageSquare, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Project, ProjectSession } from '../../../types/app';
import { Button } from '../../ui/button';
import WorkbenchDialog from '../../ui/WorkbenchDialog';
import { projectSummary } from '../utils/projectSummary';
import { loadOverview, type OverviewData, type OutputFile } from '../utils/overviewData';
import { formatTimeAgo } from '../../../utils/dateUtils';
import { stripInternalContextPrefix } from '../../../utils/sessionFormatting';

import { useResearchStatus } from '../utils/useResearchStatus';
import ResearchStatusLabel from './ResearchStatusLabel';

const ResearchLab = lazy(() => import('../../ResearchLab'));
const CodeEditor = lazy(() => import('../../CodeEditor'));
const FilePreview = lazy(() => import('../../chat/view/subcomponents/ChatContextFilePreview'));
type Props = { project: Project; processingSessions: Set<string>; onContinue: (session?: ProjectSession) => void; onNewSession: () => void; onPrepareTask: (prompt: string, stage?: string) => void };

export default function ProjectOverview({ project, processingSessions, onContinue, onNewSession, onPrepareTask }: Props) {
  const { t } = useTranslation('common');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [file, setFile] = useState<OutputFile | null>(null);
  const [editingFile, setEditingFile] = useState<OutputFile | null>(null);
  const fileTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setFile(null); setEditingFile(null); setShowDetails(false); setLoading(true);
    loadOverview(project).then(result => { if (!cancelled) { setData(result); setLoading(false); } });
    return () => { cancelled = true; };
  }, [project.name, project.fullPath, refresh]);
  const { statuses, retry: retryStatus } = useResearchStatus([project.name], refresh);
  const summary = projectSummary(project, processingSessions, statuses[project.name]);
  const tasks = data?.tasks ?? [];
  const done = tasks.filter(task => task.status === 'done').length;
  const current = tasks.find(task => task.status === 'in-progress') ?? tasks.find(task => task.status === 'pending');
  const stage = typeof current?.stage === 'string' ? current.stage : '';
  const stageKey = stage === 'research' ? 'survey' : stage === 'presentation' ? 'promotion' : stage;
  const latest = summary.sessions[0];
  const closeFile = () => { setFile(null); setEditingFile(null); requestAnimationFrame(() => fileTrigger.current?.focus()); };
  const sectionError = (key: string) => data?.errors.includes(key) ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t('workbench.loadError')} <button className="underline" onClick={() => setRefresh(n => n + 1)}>{t('buttons.retry')}</button></p> : null;
  return (
    <div className="h-full overflow-y-auto bg-background">
      <main className="workbench-page">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div className="min-w-0 w-full sm:flex-1">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground">{project.displayName}</h1>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={project.fullPath}>{project.fullPath}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="icon" aria-label={t('buttons.refresh')} disabled={loading} onClick={() => setRefresh(n => n + 1)}><RefreshCw className={loading ? 'animate-spin' : ''} /></Button>
            <Button onClick={() => latest ? onContinue(latest) : onNewSession()}>{t(latest ? 'workbench.continueResearch' : 'workbench.startResearch')}<ArrowRight /></Button>
          </div>
        </header>
        <section className="mt-6 border-y border-border py-5" aria-busy={loading}>
          <h2 className="text-base font-medium">{t('workbench.researchGoal')}</h2>
          {sectionError('brief')}
          <p className="mt-2 max-w-3xl whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{loading ? t('mainContent.loading') : data?.goal || t('workbench.noGoal')}</p>
        </section>
        {/* 2 equal columns + 24px gap fill the available canvas; below 1024px stack. */}
        <div className="grid gap-6 py-6 lg:grid-cols-2">
          <section className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-medium">{t('workbench.currentWork')}</h2>
              <ResearchStatusLabel running={summary.running} needsAttention={summary.needsAttention} status={statuses[project.name]} onRetry={retryStatus} />
            </div>
            <div className="mt-4">{sectionError('tasks')}</div>
            {loading ? <p role="status" className="text-sm text-muted-foreground">{t('mainContent.loading')}</p> : !data?.errors.includes('tasks') && <>
              <p className="text-sm tabular-nums text-muted-foreground">{tasks.length ? t('workbench.taskProgress', { completed: done, total: tasks.length }) : t('workbench.noPlan')}</p>
              {tasks.length > 0 && <div className="my-3 h-1 rounded-full bg-muted" role="progressbar" aria-label={t('projectDashboard.progressTitle')} aria-valuenow={Math.round(done / tasks.length * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-blue-600 dark:bg-blue-400" style={{ width: `${done / tasks.length * 100}%` }} /></div>}
              {current && <div className="mt-4">
                {stage && <p className="mb-1 text-xs text-muted-foreground">{t(`workbench.stages.${stageKey}`, { defaultValue: stage })}</p>}
                <p className="break-words text-sm font-medium">{current.title || String(current.id)}</p>
                {current.description && <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{current.description}</p>}
              </div>}
            </>}
            <Button variant="outline" className="mt-4" onClick={() => setShowDetails(value => !value)} aria-expanded={showDetails} aria-controls="research-details">{t('workbench.researchDetails')}</Button>
          </section>
          <section className="min-w-0">
            <div className="flex items-center justify-between gap-3"><h2 className="text-base font-medium">{t('workbench.recentSessions')}</h2><Button variant="ghost" size="sm" onClick={onNewSession}>{t('mainContent.newSession')}</Button></div>
            <div className="mt-2 divide-y divide-border">
              {summary.sessions.slice(0, 4).map(session => <button key={`${session.__provider}:${session.id}`} onClick={() => onContinue(session)} className="flex w-full items-center gap-3 rounded py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm">{stripInternalContextPrefix(session.title || session.summary || session.name || t('mainContent.newSession'))}</span><span className="mt-1 block text-xs text-muted-foreground">{session.__provider}</span></span><ArrowRight className="h-4 w-4 shrink-0" />
              </button>)}
              {!summary.sessions.length && <p className="py-3 text-sm text-muted-foreground">{t('workbench.noSessions')}</p>}
            </div>
          </section>
        </div>
        <section className="border-t border-border py-5">
          <div className="flex items-center justify-between gap-3"><h2 className="text-base font-medium">{t('workbench.outputs')}</h2><span className="text-xs tabular-nums text-muted-foreground">{data?.files.length ?? '—'}</span></div>
          {sectionError('files')}
          <div className="mt-2 divide-y divide-border">
            {data?.files.slice(0, 6).map(output => <button key={output.path} onClick={event => { fileTrigger.current = event.currentTarget; setFile(output); }} className="flex w-full items-center gap-3 rounded py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm" title={output.relativePath}>{output.relativePath}</span>{output.modified && <span className="text-xs text-muted-foreground">{formatTimeAgo(new Date(output.modified).toISOString(), new Date(), t)}</span>}<ArrowRight className="h-4 w-4 shrink-0" />
            </button>)}
            {!loading && !data?.errors.includes('files') && !data?.files.length && <p className="py-3 text-sm text-muted-foreground">{t('workbench.noOutputs')}</p>}
          </div>
          {(data?.files.length ?? 0) > 6 && <Button variant="ghost" className="mt-2" onClick={() => setShowDetails(true)}>{t('workbench.researchDetails')}</Button>}
        </section>
        {showDetails && <section id="research-details" className="min-h-96 border-t border-border"><Suspense fallback={<p role="status">{t('mainContent.loading')}</p>}><ResearchLab selectedProject={project} onNavigateToChat={() => onContinue(latest)} onFileOpen={undefined} onStartTask={(prompt: string, task: { title?: string; stage?: string }) => onPrepareTask(prompt || t('workbench.taskDraft', { title: task?.title || '' }), task?.stage)} /></Suspense></section>}
        {file && <WorkbenchDialog title={file.name} size="wide" onClose={closeFile}><Suspense fallback={<p role="status">{t('mainContent.loading')}</p>}><FilePreview embedded projectName={project.name} file={{ name: file.name, relativePath: file.relativePath, absolutePath: file.path }} onOpenInEditor={() => { setEditingFile(file); setFile(null); }} /></Suspense></WorkbenchDialog>}
        {editingFile && <Suspense fallback={<p role="status">{t('mainContent.loading')}</p>}><CodeEditor file={{ name: editingFile.name, path: editingFile.path, projectName: project.name }} projectPath={project.fullPath} selectedProject={project} onClose={closeFile} /></Suspense>}
      </main>
    </div>
  );
}
