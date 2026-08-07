// ResearchFlow project workspace — sub-navigation: Dashboard | Roadmap | Tasks
// | Experiments | Evidence | Literature. Manuscript/Submission stay disabled
// until Phase 4.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, HardDrive } from 'lucide-react';
import { api } from '../../utils/api';
import Dashboard from './Dashboard';
import Roadmap from './Roadmap';
import Tasks from './Tasks';
import Experiments from './Experiments';
import EvidenceView from './EvidenceView';
import Literature from './Literature';
import Manuscript from './Manuscript';
import Submission from './Submission';
import WorkspacePanel from './WorkspacePanel';

const TAB_KEYS = ['dashboard', 'roadmap', 'tasks', 'experiments', 'evidence', 'literature', 'manuscript', 'submission'];
const FUTURE_TABS = [];

export default function ProjectWorkspace({ projectId, onBack }) {
  const { t } = useTranslation('researchflow');
  const [tab, setTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const dashRes = await api.rf.getDashboard(projectId);
      if (!dashRes.ok) throw new Error(`HTTP ${dashRes.status}`);
      setDashboard((await dashRes.json()).data);
      const tasksRes = await api.rf.listTasks(projectId);
      if (!tasksRes.ok) throw new Error(`HTTP ${tasksRes.status}`);
      setTasks((await tasksRes.json()).data);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = async (mutator) => {
    setBusy(true);
    try {
      await mutator();
      await load();
    } catch (mutationError) {
      setError(mutationError.message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleGate = (gate) =>
    runMutation(() => api.rf.patchGate(gate.id, { isPassed: !gate.isPassed }));

  const handleCompleteStage = (stage) => runMutation(() => api.rf.completeStage(stage.id));

  const handleCreateTask = (body) => runMutation(() => api.rf.createTask(projectId, body));

  const handleUpdateTask = (taskId, body) => runMutation(() => api.rf.updateTask(taskId, body));

  // Phase 5: download the project export zip (portable ResearchFlow metadata).
  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await api.rf.exportProject(projectId);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      const fileName = match ? match[1] : `${dashboard?.project?.name || 'project'}-researchflow-export.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setExporting(false);
    }
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">{t('dashboard.loadingError')}</p>
          <p className="mt-1 text-xs text-red-500">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!dashboard || !tasks) {
    return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;
  }

  const stages = dashboard.stages;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('workspace.backToPortfolio')}
        </button>
        <span className="max-w-[240px] truncate text-sm font-semibold text-foreground">
          {dashboard.project.name}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowWorkspace((value) => !value)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            <HardDrive className="h-3.5 w-3.5" />
            {t('workspace.executionEnvironment')}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {t('workspace.exportProject')}
          </button>
        </div>
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                tab === key ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              {t(`workspace.tabs_${key}`)}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {FUTURE_TABS.map((key) => (
            <button
              key={key}
              type="button"
              disabled
              title={t('workspace.tab_coming_soon')}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground/40"
            >
              {t(`workspace.tabs_${key}`)}
            </button>
          ))}
        </div>
      </div>

      {showWorkspace && (
        <div className="border-b border-border px-3 py-2">
          <WorkspacePanel projectId={projectId} onClose={() => setShowWorkspace(false)} />
        </div>
      )}

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'dashboard' && <Dashboard dashboard={dashboard} />}
        {tab === 'roadmap' && (
          <Roadmap
            stages={stages}
            tasks={tasks.tasks}
            onToggleGate={handleToggleGate}
            onCompleteStage={handleCompleteStage}
            busy={busy}
          />
        )}
        {tab === 'tasks' && (
          <Tasks
            tasks={tasks.tasks}
            stages={stages}
            projectId={projectId}
            onCreate={handleCreateTask}
            onUpdate={handleUpdateTask}
            busy={busy}
          />
        )}
        {tab === 'experiments' && <Experiments projectId={projectId} />}
        {tab === 'evidence' && <EvidenceView projectId={projectId} />}
        {tab === 'literature' && <Literature projectId={projectId} />}
        {tab === 'manuscript' && <Manuscript projectId={projectId} />}
        {tab === 'submission' && <Submission projectId={projectId} />}
      </div>
    </div>
  );
}
