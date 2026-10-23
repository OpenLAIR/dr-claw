import { useState, useEffect, useCallback, useId } from 'react';
import { Layers, RefreshCw, Play, Upload, X, Clock, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api } from '../../utils/api';
import type { ComputeNode } from './types';

type SlurmJob = {
  jobId: string;
  name: string;
  state: string;
  elapsed: string;
};

type SlurmPartition = {
  name: string;
  gres?: string;
};

type ActionResult = {
  success: boolean;
  output?: string;
  error?: string;
  message?: string;
};

function ResultBlock({ result }: { result: ActionResult | null }) {
  const { t } = useTranslation('common');
  if (!result) return null;
  const ok = result.success;
  return (
    <div role={ok ? 'status' : 'alert'}
      className={`mt-2 p-2.5 rounded-lg text-xs border ${
        ok
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
          : 'bg-destructive/10 border-destructive/20 text-destructive'
      }`}
    >
      <div className="flex items-start gap-1.5">
        {ok ? (
          <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        )}
        <pre className="whitespace-pre-wrap break-all font-mono flex-1 max-h-40 overflow-y-auto">
          {result.output || result.error || result.message || t(ok ? 'slurm.done' : 'messages.operationFailed')}
        </pre>
      </div>
    </div>
  );
}

function stateColor(state: string): string {
  if (state === 'RUNNING') return 'text-emerald-600 dark:text-emerald-400';
  if (state === 'PENDING') return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export default function SlurmPanel({
  node,
  projectPath,
}: {
  node: ComputeNode;
  projectPath?: string;
}) {
  const { t } = useTranslation('common');
  const formId = useId();
  const [loadErrors, setLoadErrors] = useState({ info: false, queue: false });
  const s = node.slurm || {};
  const [partitions, setPartitions] = useState<SlurmPartition[]>([]);
  const [jobs, setJobs] = useState<SlurmJob[]>([]);
  const [loading, setLoading] = useState({ info: false, queue: false, salloc: false, sbatch: false, cancel: '' });
  const [slurmForm, setSlurmForm] = useState({
    partition: s.defaultPartition || '',
    time: s.defaultTime || '00:30:00',
    gpus: String(s.defaultGpus ?? 1),
    account: s.defaultAccount || '',
    command: '',
    script: `#!/bin/bash
#SBATCH --job-name=dr-claw-job
#SBATCH --partition=${s.defaultPartition || 'GPU-small'}
#SBATCH --time=${s.defaultTime || '00:30:00'}
#SBATCH --gres=gpu:${s.defaultGpus ?? 1}
${s.defaultAccount ? `#SBATCH -A ${s.defaultAccount}` : '# #SBATCH -A your-account'}
#SBATCH --output=dr-claw-job-%j.out
#SBATCH --error=dr-claw-job-%j.err

# Your commands below
cd ${node.workDir || '~'}
echo "Job started on $(hostname)"
# python train.py --epochs 100
`,
  });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [showScript, setShowScript] = useState(false);

  const fetchSinfo = useCallback(async () => {
    setLoading((l) => ({ ...l, info: true }));
    try {
      const res = await api.compute.slurmInfo(node.id);
      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.partitions)) throw new Error('slurm');
      setPartitions(data.partitions);
      setLoadErrors(previous => ({ ...previous, info: false }));
    } catch (err) {
      console.error('sinfo error:', err);
      setLoadErrors(previous => ({ ...previous, info: true }));
    } finally {
      setLoading((l) => ({ ...l, info: false }));
    }
  }, [node.id]);

  const fetchQueue = useCallback(async () => {
    setLoading((l) => ({ ...l, queue: true }));
    try {
      const res = await api.compute.slurmQueue(node.id);
      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.jobs)) throw new Error('slurm');
      setJobs(data.jobs);
      setLoadErrors(previous => ({ ...previous, queue: false }));
    } catch (err) {
      console.error('squeue error:', err);
      setLoadErrors(previous => ({ ...previous, queue: true }));
    } finally {
      setLoading((l) => ({ ...l, queue: false }));
    }
  }, [node.id]);

  useEffect(() => {
    void fetchSinfo();
    void fetchQueue();
  }, [fetchSinfo, fetchQueue]);

  // Auto-refresh queue every 30s
  useEffect(() => {
    const timer = setInterval(() => void fetchQueue(), 30000);
    return () => clearInterval(timer);
  }, [fetchQueue]);

  const handleSalloc = async () => {
    const gpus = slurmForm.gpus === '' ? 1 : Number(slurmForm.gpus);
    if (!Number.isInteger(gpus) || gpus < 0 || gpus > 8) { setResult({ success: false, error: t('computeForm.gpusInvalid') }); return; }
    setLoading((l) => ({ ...l, salloc: true }));
    setResult(null);
    try {
      const res = await api.compute.slurmSalloc(node.id, {
        partition: slurmForm.partition || undefined,
        time: slurmForm.time,
        gpus,
        account: slurmForm.account || undefined,
        command: slurmForm.command || undefined,
      });
      const data = await res.json();
      setResult({ ...data, success: res.ok && data.success === true });
      void fetchQueue();
    } catch (err: unknown) {
      setResult({ success: false, error: err instanceof Error ? err.message : t('messages.operationFailed') });
    } finally {
      setLoading((l) => ({ ...l, salloc: false }));
    }
  };

  const handleSbatch = async () => {
    if (!slurmForm.script.trim()) return;
    setLoading((l) => ({ ...l, sbatch: true }));
    setResult(null);
    try {
      const scriptContent = slurmForm.script.trim();
      const res = await api.compute.slurmSbatch(node.id, {
        rawScript: scriptContent,
        script: scriptContent,
      });
      const data = await res.json();
      setResult({ ...data, success: res.ok && data.success === true });
      void fetchQueue();
    } catch (err: unknown) {
      setResult({ success: false, error: err instanceof Error ? err.message : t('messages.operationFailed') });
    } finally {
      setLoading((l) => ({ ...l, sbatch: false }));
    }
  };

  const handleCancel = async (jobId: string) => {
    setLoading((l) => ({ ...l, cancel: jobId }));
    try {
      const response = await api.compute.slurmCancel(node.id, jobId);
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.error || t('messages.operationFailed'));
      setResult({ success: true, message: t('slurm.cancelled', { id: jobId }) });
      void fetchQueue();
    } catch (err) {
      console.error('scancel error:', err);
      setResult({ success: false, error: err instanceof Error ? err.message : t('messages.operationFailed') });
    } finally {
      setLoading((l) => ({ ...l, cancel: '' }));
    }
  };

  // Suppress unused variable warning — projectPath reserved for future use in script template
  void projectPath;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <Layers className="w-4 h-4" /> {t('slurm.title')}
        </h4>
        <Button variant="ghost" size="sm" className="rounded-md" aria-label={t('slurm.refresh')} onClick={() => { void fetchQueue(); void fetchSinfo(); }} disabled={loading.queue || loading.info}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading.queue ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {(loadErrors.info || loadErrors.queue) && <p role="alert" className="text-sm text-destructive">{t('slurm.loadFailed')}</p>}
      {/* Resource selector */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor={`${formId}-partition`} className="text-sm text-muted-foreground">{t('computeForm.partition')}</label>
          <select
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring h-9"
            id={`${formId}-partition`}
            value={slurmForm.partition}
            onChange={(e) => setSlurmForm({ ...slurmForm, partition: e.target.value })}
          >
            <option value="">{t('slurm.default')}</option>
            {partitions.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.gres || 'CPU'})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${formId}-account`} className="text-sm text-muted-foreground">{t('computeForm.account')}</label>
          <Input
            className="rounded-md h-9"
            id={`${formId}-account`}
            value={slurmForm.account}
            onChange={(e) => setSlurmForm({ ...slurmForm, account: e.target.value })}
            placeholder={t('computeForm.account')}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${formId}-time`} className="text-sm text-muted-foreground">{t('computeForm.time')}</label>
          <Input
            className="rounded-md h-9"
            id={`${formId}-time`}
            value={slurmForm.time}
            onChange={(e) => setSlurmForm({ ...slurmForm, time: e.target.value })}
            placeholder="00:30:00"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${formId}-gpus`} className="text-sm text-muted-foreground">{t('computeForm.gpus')}</label>
          <Input
            className="rounded-md h-9"
            type="number"
            min="0"
            max="8"
            id={`${formId}-gpus`}
            value={slurmForm.gpus}
            onChange={(e) => setSlurmForm({ ...slurmForm, gpus: e.target.value })}
          />
        </div>
      </div>

      {/* salloc */}
      <div className="space-y-1">
        <label htmlFor={`${formId}-command`} className="text-sm text-muted-foreground">{t('slurm.command')}</label>
        <div className="flex gap-2">
          <Input
            className="rounded-md h-9"
            placeholder={t('slurm.commandPlaceholder')}
            id={`${formId}-command`}
            value={slurmForm.command}
            onChange={(e) => setSlurmForm({ ...slurmForm, command: e.target.value })}
          />
          <Button size="sm" className="rounded-md" aria-label={t('slurm.allocate')} onClick={() => void handleSalloc()} disabled={loading.salloc}>
            {loading.salloc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* sbatch */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={`${formId}-script`} className="text-sm text-muted-foreground">{t('slurm.script')}</label>
          <button
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            aria-expanded={showScript} onClick={() => setShowScript(!showScript)}
          >
            {t(showScript ? 'slurm.hide' : 'slurm.editScript')}
          </button>
        </div>
        {showScript && (
          <>
            <p className="text-xs text-muted-foreground mb-1.5">
              {t('slurm.scriptHelp')}
            </p>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono h-52 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              id={`${formId}-script`} value={slurmForm.script}
              onChange={(e) => setSlurmForm({ ...slurmForm, script: e.target.value })}
            />
            <Button
              size="sm"
              className="mt-1 w-full rounded-md"
              onClick={() => void handleSbatch()}
              disabled={loading.sbatch || !slurmForm.script.trim()}
            >
              {loading.sbatch ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5 mr-1.5" />
              )}
              {t('slurm.submit')}
            </Button>
          </>
        )}
      </div>

      <ResultBlock result={result} />

      {/* Job queue */}
      {jobs.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{t('slurm.jobs', { count: jobs.length })}</label>
          {jobs.map((job) => (
            <div
              key={job.jobId}
              className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border bg-muted/30 text-xs"
            >
              <div className="min-w-0 break-all">
                <span className="font-medium tabular-nums">{job.jobId}</span>
                <span className="text-muted-foreground mx-1.5">{job.name}</span>
                <span className={`font-medium ${stateColor(job.state)}`}>{job.state}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {job.elapsed}
                </span>
                <button
                  aria-label={t('slurm.cancelJob', { id: job.jobId })} onClick={() => void handleCancel(job.jobId)}
                  disabled={loading.cancel === job.jobId}
                  className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  {loading.cancel === job.jobId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <X className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading.info && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> {t('slurm.loading')}
        </div>
      )}
    </div>
  );
}
