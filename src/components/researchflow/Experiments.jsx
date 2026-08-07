// Experiment Registry (Phase 3) — list + detail with runs. Failed runs are
// first-class: shown with classification/reason, distinct from archiving.
// All aggregation comes from the backend (getExperiment / listExperiments).

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, FlaskConical, Plus, X } from 'lucide-react';
import { api } from '../../utils/api';

const STATUS_COLOR = {
  planned: 'text-muted-foreground',
  ready: 'text-sky-600 dark:text-sky-400',
  running: 'text-amber-600 dark:text-amber-400',
  completed: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400 font-semibold',
  inconclusive: 'text-amber-600 dark:text-amber-400',
  cancelled: 'text-muted-foreground',
};

const RUN_STATUS_COLOR = {
  planned: 'text-muted-foreground',
  running: 'text-amber-600 dark:text-amber-400',
  completed: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400 font-semibold',
  cancelled: 'text-muted-foreground',
};

export default function Experiments({ projectId }) {
  const { t } = useTranslation('researchflow');
  const [experiments, setExperiments] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'main', status: 'planned', priority: 'medium' });
  const [runForm, setRunForm] = useState({ seed: '', status: 'planned' });

  const loadList = useCallback(async () => {
    setError(null);
    try {
      const res = await api.rf.listExperiments(projectId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setExperiments((await res.json()).data);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [projectId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (id) => {
    setError(null);
    try {
      const res = await api.rf.getExperiment(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail((await res.json()).data);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  const runMutation = async (mutator) => {
    setBusy(true);
    setError(null);
    try {
      await mutator();
      await loadList();
      if (selectedId) await loadDetail(selectedId);
    } catch (mutationError) {
      setError(mutationError.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () =>
    runMutation(async () => {
      await api.rf.createExperiment(projectId, form);
      setShowForm(false);
      setForm({ title: '', type: 'main', status: 'planned', priority: 'medium' });
    });

  const handleCreateRun = () =>
    runMutation(async () => {
      await api.rf.createRun(selectedId, runForm);
      setRunForm({ seed: '', status: 'planned' });
    });

  const handleSelect = (id) => {
    setSelectedId(id);
    setDetail(null);
    void loadDetail(id);
  };

  if (error && !experiments) {
    return <div className="p-4 text-sm text-red-500">{error}</div>;
  }
  if (!experiments) {
    return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;
  }

  if (selectedId && detail) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <button
          type="button"
          onClick={() => { setSelectedId(null); setDetail(null); }}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('workspace.backToPortfolio')}
        </button>
        <ExperimentDetail
          experiment={detail}
          t={t}
          busy={busy}
          error={error}
          runForm={runForm}
          setRunForm={setRunForm}
          onCreateRun={handleCreateRun}
          onPatchRun={(runId, body) => runMutation(() => api.rf.updateRun(runId, body))}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">{t('experiments.title')}</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {t('experiments.newExperiment')}
        </button>
      </div>

      {showForm && (
        <div className="mb-3 space-y-2 rounded-lg border border-border bg-card p-3">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={t('experiments.titleCol')}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
          />
          <div className="flex flex-wrap gap-2">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              {['prototype', 'main', 'baseline', 'ablation', 'sensitivity', 'robustness', 'failure_analysis', 'reproduction', 'post_freeze'].map((type) => (
                <option key={type} value={type}>{t(`experiments.types.${type}`)}</option>
              ))}
            </select>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              {['planned', 'ready', 'running', 'completed', 'failed', 'inconclusive', 'cancelled'].map((status) => (
                <option key={status} value={status}>{t(`experiments.statuses.${status}`)}</option>
              ))}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              {['critical', 'high', 'medium', 'low'].map((priority) => (
                <option key={priority} value={priority}>{t(`tasks.priority_${priority}`)}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !form.title.trim()}
              onClick={handleCreate}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {t('experiments.add')}
            </button>
          </div>
        </div>
      )}

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">{error}</div>}

      {experiments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('experiments.noExperiments')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t('experiments.code')}</th>
                <th className="px-3 py-2 font-medium">{t('experiments.titleCol')}</th>
                <th className="px-3 py-2 font-medium">{t('experiments.type')}</th>
                <th className="px-3 py-2 font-medium">{t('experiments.status')}</th>
                <th className="px-3 py-2 font-medium">{t('experiments.priority')}</th>
                <th className="px-3 py-2 font-medium">{t('experiments.runs')}</th>
                <th className="px-3 py-2 font-medium">{t('experiments.failedRuns')}</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((experiment) => (
                <tr
                  key={experiment.id}
                  onClick={() => handleSelect(experiment.id)}
                  className="cursor-pointer border-t border-border hover:bg-accent/40"
                >
                  <td className="px-3 py-2 font-mono text-xs">{experiment.code}</td>
                  <td className="px-3 py-2 font-medium text-foreground">{experiment.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">{t(`experiments.types.${experiment.type}`)}</td>
                  <td className={`px-3 py-2 ${STATUS_COLOR[experiment.status] || ''}`}>
                    {experiment.status === 'failed' ? t('experiments.run.failed') : t(`experiments.statuses.${experiment.status}`)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{t(`tasks.priority_${experiment.priority}`)}</td>
                  <td className="px-3 py-2">
                    {experiment.runSummary ? `${experiment.runSummary.completed}/${experiment.runSummary.total}` : '0'}
                  </td>
                  <td className={`px-3 py-2 ${experiment.runSummary && experiment.runSummary.failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                    {experiment.runSummary ? experiment.runSummary.failed : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExperimentDetail({ experiment, t, busy, error, runForm, setRunForm, onCreateRun, onPatchRun }) {
  return (
    <div className="mt-3 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">{experiment.code}</span>
          <h3 className="text-lg font-bold text-foreground">{experiment.title}</h3>
          <span className={`rounded-full border border-border px-2 py-0.5 text-xs ${STATUS_COLOR[experiment.status] || ''}`}>
            {experiment.status === 'failed' ? t('experiments.run.failed') : t(`experiments.statuses.${experiment.status}`)}
          </span>
          {experiment.status === 'failed' && (
            <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {t('experiments.run.archived') !== t('experiments.run.failed') ? t('experiments.run.failed') : ''}
            </span>
          )}
        </div>
        {experiment.stage && <div className="mt-1 text-xs text-muted-foreground">{t('experiments.stage')}: {experiment.stage.name}</div>}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DetailField label={t('experiments.hypothesis')} value={experiment.hypothesis} />
        <DetailField label={t('experiments.researchQuestion')} value={experiment.researchQuestion} />
        <DetailField label={t('experiments.successCriteria')} value={experiment.successCriteria} />
        <DetailField label={t('experiments.failureCriteria')} value={experiment.failureCriteria} />
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">{error}</div>}

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">{t('experiments.run.title')}</span>
          <div className="flex items-center gap-1.5">
            <input
              value={runForm.seed}
              onChange={(e) => setRunForm({ ...runForm, seed: e.target.value })}
              placeholder={t('experiments.run.seed')}
              className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            />
            <select value={runForm.status} onChange={(e) => setRunForm({ ...runForm, status: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
              {['planned', 'running', 'completed', 'failed', 'cancelled'].map((status) => (
                <option key={status} value={status}>{t(`experiments.run.runStatuses.${status}`)}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={onCreateRun}
              className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Plus className="inline h-3.5 w-3.5" /> {t('experiments.run.newRun')}
            </button>
          </div>
        </div>
        {experiment.runs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">{t('experiments.noExperiments')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('experiments.run.title')}</th>
                  <th className="px-3 py-2 font-medium">{t('experiments.run.seed')}</th>
                  <th className="px-3 py-2 font-medium">{t('experiments.status')}</th>
                  <th className="px-3 py-2 font-medium">{t('experiments.run.commit')}</th>
                  <th className="px-3 py-2 font-medium">{t('experiments.run.config')}</th>
                  <th className="px-3 py-2 font-medium">{t('experiments.run.result')}</th>
                  <th className="px-3 py-2 font-medium">{t('experiments.run.metrics')}</th>
                  <th className="px-3 py-2 font-medium">{t('experiments.run.failureReason')}</th>
                </tr>
              </thead>
              <tbody>
                {experiment.runs.map((run) => (
                  <tr key={run.id} className="border-t border-border">
                    <td className={`px-3 py-2 font-mono ${RUN_STATUS_COLOR[run.status] || ''}`}>{run.runCode}</td>
                    <td className="px-3 py-2 text-muted-foreground">{run.seed || '—'}</td>
                    <td className={`px-3 py-2 ${RUN_STATUS_COLOR[run.status] || ''}`}>
                      {t(`experiments.run.runStatuses.${run.status}`)}
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{run.gitCommit ? run.gitCommit.slice(0, 8) : '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{run.configPath || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{run.resultPath || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {run.metrics && typeof run.metrics === 'object' ? Object.entries(run.metrics).map(([k, v]) => `${k}=${v}`).join(', ') : '—'}
                    </td>
                    <td className="px-3 py-2 text-red-600 dark:text-red-400">
                      {run.failureReason || (run.failureClassification ? t(`experiments.run.classifications.${run.failureClassification}`) : '') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const DetailField = ({ label, value }) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="text-xs font-medium text-muted-foreground">{label}</div>
    <div className="mt-1 text-sm text-foreground">{value || '—'}</div>
  </div>
);
