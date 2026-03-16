import React, { useState, useEffect, useCallback } from 'react';
import { Server, Terminal, Upload, Save, Play, RefreshCw, Globe, CheckCircle, XCircle, Loader2, Download, Plus, Trash2, Edit3, X, Cpu, Clock, Layers } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '../utils/api';
import Shell from './Shell';

// ─── Sub-components ───

const StatusDot = ({ status }) => {
  const colors = { connected: 'bg-green-500', configured: 'bg-yellow-500', none: 'bg-gray-400' };
  const labels = { connected: 'Connected', configured: 'Configured', none: 'Not configured' };
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${colors[status] || colors.none}`} />
      <span className="text-xs text-gray-500 dark:text-gray-400">{labels[status] || labels.none}</span>
    </div>
  );
};

const ResultBlock = ({ result }) => {
  if (!result) return null;
  const ok = result.success;
  return (
    <div className={`mt-2 p-2.5 rounded text-xs border ${
      ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
         : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
    }`}>
      <div className="flex items-start gap-1.5">
        {ok ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
        <pre className="whitespace-pre-wrap break-all font-mono flex-1 max-h-40 overflow-y-auto">
          {result.output || result.error || result.message || 'Done'}
        </pre>
      </div>
    </div>
  );
};

const Label = ({ children }) => (
  <label className="text-sm font-medium leading-none block mb-1.5 text-gray-700 dark:text-gray-300">{children}</label>
);

// ─── Node Card ───

const NodeCard = ({ node, isActive, onSelect, onEdit, onDelete }) => (
  <div
    onClick={() => onSelect(node.id)}
    className={`relative cursor-pointer rounded-lg border p-3 transition-all min-w-[160px] ${
      isActive
        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
    }`}
  >
    <div className="flex items-center gap-2 mb-1">
      <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{node.name}</span>
    </div>
    <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
      {node.type === 'slurm' ? 'Slurm HPC' : 'Direct GPU'}
    </div>
    <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{node.user}@{node.host}{node.port && node.port !== 22 ? `:${node.port}` : ''}</div>
    <div className="flex gap-1 mt-2">
      <button onClick={(e) => { e.stopPropagation(); onEdit(node); }}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
        <Edit3 className="w-3.5 h-3.5" />
      </button>
      <button onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
);

// ─── Add/Edit Node Dialog ───

const NodeFormDialog = ({ node, onSave, onClose }) => {
  const isEdit = !!node;
  const [form, setForm] = useState({
    name: node?.name || '',
    host: node?.host || '',
    port: node?.port || 22,
    user: node?.user || '',
    workDir: node?.workDir || '~',
    authType: node?.keyPath ? 'key' : (node?.hasPassword ? 'password' : 'password'),
    key: '',
    password: '',
    type: node?.type || 'direct',
    slurmPartition: node?.slurm?.defaultPartition || '',
    slurmTime: node?.slurm?.defaultTime || '00:30:00',
    slurmGpus: node?.slurm?.defaultGpus ?? 1,
    slurmAccount: node?.slurm?.defaultAccount || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const portNum = parseInt(form.port) || 22;
      if (portNum < 1 || portNum > 65535) {
        setError('Port must be between 1 and 65535');
        setSaving(false);
        return;
      }
      const payload = {
        name: form.name.trim() || form.host.trim(),
        host: form.host.trim(),
        port: portNum,
        user: form.user.trim(),
        workDir: form.workDir.trim() || '~',
        authType: form.authType,
        key: form.authType === 'key' ? form.key : undefined,
        password: form.authType === 'password' ? form.password : undefined,
        type: form.type,
        slurm: form.type === 'slurm' ? {
          defaultPartition: form.slurmPartition || undefined,
          defaultTime: form.slurmTime || '00:30:00',
          defaultGpus: parseInt(form.slurmGpus) || 1,
          defaultAccount: form.slurmAccount || undefined,
        } : undefined,
      };

      let res;
      if (isEdit) {
        res = await api.compute.updateNode(node.id, payload);
      } else {
        res = await api.compute.addNode(payload);
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{isEdit ? 'Edit Node' : 'Add Compute Node'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input placeholder="My GPU Server" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            </div>
            <div>
              <Label>Type</Label>
              <div className="flex bg-gray-100 dark:bg-gray-700 p-0.5 rounded-md">
                <button type="button" className={`flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors ${form.type === 'direct' ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`}
                  onClick={() => setForm({...form, type: 'direct'})}>Direct GPU</button>
                <button type="button" className={`flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors ${form.type === 'slurm' ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`}
                  onClick={() => setForm({...form, type: 'slurm'})}>Slurm HPC</button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_80px_1fr] gap-3">
            <div><Label>Host</Label><Input placeholder="bridges2.psc.edu" value={form.host} onChange={e => setForm({...form, host: e.target.value})} required /></div>
            <div><Label>Port</Label><Input type="number" min="1" max="65535" placeholder="22" className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" value={form.port} onChange={e => setForm({...form, port: e.target.value})} /></div>
            <div><Label>Username</Label><Input placeholder="root" value={form.user} onChange={e => setForm({...form, user: e.target.value})} required /></div>
          </div>
          <div><Label>Work Directory</Label><Input placeholder="/ocean/projects/..." value={form.workDir} onChange={e => setForm({...form, workDir: e.target.value})} /></div>
          <div>
            <Label>Authentication</Label>
            <div className="flex bg-gray-100 dark:bg-gray-700 p-0.5 rounded-md mb-2">
              <button type="button" className={`flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors ${form.authType === 'password' ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`}
                onClick={() => setForm({...form, authType: 'password'})}>Password</button>
              <button type="button" className={`flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors ${form.authType === 'key' ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`}
                onClick={() => setForm({...form, authType: 'key'})}>SSH Key</button>
            </div>
            {form.authType === 'password' ? (
              <Input type="password" placeholder={isEdit ? '(unchanged)' : 'Password'} value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
            ) : (
              <textarea className="flex w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 px-3 py-2 text-xs font-mono h-20 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={form.key} onChange={e => setForm({...form, key: e.target.value})} />
            )}
          </div>
          {form.type === 'slurm' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-3">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><Layers className="w-4 h-4" /> Slurm Defaults</div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Partition</Label><Input placeholder="GPU-small" value={form.slurmPartition} onChange={e => setForm({...form, slurmPartition: e.target.value})} /></div>
                <div><Label>Account</Label><Input placeholder="cis240110p" value={form.slurmAccount} onChange={e => setForm({...form, slurmAccount: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Time Limit</Label><Input placeholder="00:30:00" value={form.slurmTime} onChange={e => setForm({...form, slurmTime: e.target.value})} /></div>
                <div><Label>GPUs</Label><Input type="number" min="0" max="8" value={form.slurmGpus} onChange={e => setForm({...form, slurmGpus: e.target.value})} /></div>
              </div>
            </div>
          )}
          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
          <Button type="submit" className="w-full" disabled={saving || !form.host || !form.user}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {saving ? 'Saving...' : (isEdit ? 'Update Node' : 'Add Node')}
          </Button>
        </form>
      </div>
    </div>
  );
};

// ─── Slurm Panel ───

const SlurmPanel = ({ node, selectedProject }) => {
  const [partitions, setPartitions] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState({ info: false, queue: false, salloc: false, sbatch: false, cancel: '' });
  const s = node.slurm || {};
  const [slurmForm, setSlurmForm] = useState({
    partition: s.defaultPartition || '',
    time: s.defaultTime || '00:30:00',
    gpus: s.defaultGpus ?? 1,
    account: s.defaultAccount || '',
    command: '',
    script: `#!/bin/bash
#SBATCH --job-name=vibelab-job
#SBATCH --partition=${s.defaultPartition || 'GPU-small'}
#SBATCH --time=${s.defaultTime || '00:30:00'}
#SBATCH --gres=gpu:${s.defaultGpus ?? 1}
${s.defaultAccount ? `#SBATCH -A ${s.defaultAccount}` : '# #SBATCH -A your-account'}
#SBATCH --output=vibelab-job-%j.out
#SBATCH --error=vibelab-job-%j.err

# Your commands below
cd ${node.workDir || '~'}
echo "Job started on $(hostname)"
# python train.py --epochs 100
`,
  });
  const [result, setResult] = useState(null);
  const [showScript, setShowScript] = useState(false);

  const fetchSinfo = useCallback(async () => {
    setLoading(l => ({ ...l, info: true }));
    try {
      const res = await api.compute.slurmInfo(node.id);
      const data = await res.json();
      if (data.success) setPartitions(data.partitions || []);
    } catch (err) { console.error('sinfo error:', err); }
    finally { setLoading(l => ({ ...l, info: false })); }
  }, [node.id]);

  const fetchQueue = useCallback(async () => {
    setLoading(l => ({ ...l, queue: true }));
    try {
      const res = await api.compute.slurmQueue(node.id);
      const data = await res.json();
      if (data.success) setJobs(data.jobs || []);
    } catch (err) { console.error('squeue error:', err); }
    finally { setLoading(l => ({ ...l, queue: false })); }
  }, [node.id]);

  useEffect(() => { fetchSinfo(); fetchQueue(); }, [fetchSinfo, fetchQueue]);

  // Auto-refresh queue every 30s
  useEffect(() => {
    const timer = setInterval(fetchQueue, 30000);
    return () => clearInterval(timer);
  }, [fetchQueue]);

  const handleSalloc = async () => {
    setLoading(l => ({ ...l, salloc: true }));
    setResult(null);
    try {
      const res = await api.compute.slurmSalloc(node.id, {
        partition: slurmForm.partition || undefined,
        time: slurmForm.time,
        gpus: parseInt(slurmForm.gpus) || 1,
        account: slurmForm.account || undefined,
        command: slurmForm.command || undefined,
      });
      const data = await res.json();
      setResult(data);
      fetchQueue();
    } catch (err) { setResult({ success: false, error: err.message }); }
    finally { setLoading(l => ({ ...l, salloc: false })); }
  };

  const handleSbatch = async () => {
    if (!slurmForm.script.trim()) return;
    setLoading(l => ({ ...l, sbatch: true }));
    setResult(null);
    try {
      const scriptContent = slurmForm.script.trim();
      const res = await api.compute.slurmSbatch(node.id, {
        rawScript: scriptContent,
        script: scriptContent,
      });
      const data = await res.json();
      setResult(data);
      fetchQueue();
    } catch (err) { setResult({ success: false, error: err.message }); }
    finally { setLoading(l => ({ ...l, sbatch: false })); }
  };

  const handleCancel = async (jobId) => {
    setLoading(l => ({ ...l, cancel: jobId }));
    try {
      await api.compute.slurmCancel(node.id, jobId);
      fetchQueue();
    } catch (err) { console.error('scancel error:', err); }
    finally { setLoading(l => ({ ...l, cancel: '' })); }
  };

  const stateColor = (state) => {
    if (state === 'RUNNING') return 'text-green-600 dark:text-green-400';
    if (state === 'PENDING') return 'text-yellow-600 dark:text-yellow-400';
    return 'text-gray-500';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5"><Layers className="w-4 h-4" /> Slurm Jobs</h4>
        <Button variant="ghost" size="sm" onClick={fetchQueue} disabled={loading.queue}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading.queue ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Resource selector */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Partition</Label>
          <select className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={slurmForm.partition} onChange={e => setSlurmForm({...slurmForm, partition: e.target.value})}>
            <option value="">Default</option>
            {partitions.map(p => <option key={p.name} value={p.name}>{p.name} ({p.gres || 'CPU'})</option>)}
          </select>
        </div>
        <div>
          <Label>Account</Label>
          <Input className="text-sm h-8" value={slurmForm.account} onChange={e => setSlurmForm({...slurmForm, account: e.target.value})} placeholder="account" />
        </div>
        <div>
          <Label>Time</Label>
          <Input className="text-sm h-8" value={slurmForm.time} onChange={e => setSlurmForm({...slurmForm, time: e.target.value})} placeholder="00:30:00" />
        </div>
        <div>
          <Label>GPUs</Label>
          <Input className="text-sm h-8" type="number" min="0" max="8" value={slurmForm.gpus} onChange={e => setSlurmForm({...slurmForm, gpus: e.target.value})} />
        </div>
      </div>

      {/* salloc */}
      <div>
        <Label>Interactive Command (salloc)</Label>
        <div className="flex gap-2">
          <Input className="text-sm h-8" placeholder="python train.py (optional)" value={slurmForm.command} onChange={e => setSlurmForm({...slurmForm, command: e.target.value})} />
          <Button size="sm" onClick={handleSalloc} disabled={loading.salloc}>
            {loading.salloc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* sbatch */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>Batch Script (sbatch)</Label>
          <button className="text-xs text-blue-600 dark:text-blue-400 hover:underline" onClick={() => setShowScript(!showScript)}>
            {showScript ? 'Hide' : 'Edit & submit script'}
          </button>
        </div>
        {showScript && (
          <>
            <p className="text-xs text-gray-400 mb-1.5">Edit the full sbatch script below, including #SBATCH directives:</p>
            <textarea className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 px-3 py-2 text-xs font-mono h-52 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={slurmForm.script} onChange={e => setSlurmForm({...slurmForm, script: e.target.value})} />
            <Button size="sm" className="mt-1 w-full" onClick={handleSbatch} disabled={loading.sbatch || !slurmForm.script.trim()}>
              {loading.sbatch ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
              Submit Job
            </Button>
          </>
        )}
      </div>

      <ResultBlock result={result} />

      {/* Job queue */}
      {jobs.length > 0 && (
        <div>
          <Label>Active Jobs ({jobs.length})</Label>
          <div className="space-y-1.5">
            {jobs.map(job => (
              <div key={job.jobId} className="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-xs">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">{job.jobId}</span>
                  <span className="text-gray-500 mx-1.5">{job.name}</span>
                  <span className={`font-medium ${stateColor(job.state)}`}>{job.state}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{job.elapsed}</span>
                  <button onClick={() => handleCancel(job.jobId)} disabled={loading.cancel === job.jobId}
                    className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500">
                    {loading.cancel === job.jobId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading.info && <div className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading partition info...</div>}
    </div>
  );
};

// ─── Main Component ───

const ComputePanel = ({ selectedProject }) => {
  const [nodes, setNodes] = useState([]);
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editNode, setEditNode] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [customCmd, setCustomCmd] = useState('');
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalKey, setTerminalKey] = useState(0);

  const loadNodes = useCallback(async () => {
    try {
      const res = await api.compute.getNodes();
      if (res.ok) {
        const data = await res.json();
        setNodes(data.nodes || []);
        setActiveNodeId(data.activeNodeId);
      }
    } catch (err) {
      console.error('Failed to load compute nodes:', err);
    }
  }, []);

  useEffect(() => { loadNodes(); }, [loadNodes]);

  const activeNode = nodes.find(n => n.id === activeNodeId);

  const handleSelectNode = async (nodeId) => {
    try {
      await api.compute.setActive(nodeId);
      setActiveNodeId(nodeId);
      setTestResult(null);
      setSyncResult(null);
      setRunResult(null);
      // Reconnect terminal if open
      if (showTerminal) {
        setTerminalKey(prev => prev + 1);
      }
    } catch (err) { console.error('Error setting active node:', err); }
  };

  const handleDeleteNode = async (nodeId) => {
    if (!window.confirm('Delete this compute node?')) return;
    try {
      await api.compute.deleteNode(nodeId);
      loadNodes();
      if (showTerminal && nodeId === activeNodeId) {
        setShowTerminal(false);
      }
    } catch (err) { console.error('Error deleting node:', err); }
  };

  const handleTest = async () => {
    if (!activeNode) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.compute.testNode(activeNode.id);
      const data = await res.json();
      setTestResult(data);
    } catch (err) { setTestResult({ success: false, error: err.message }); }
    finally { setIsTesting(false); }
  };

  const handleSync = async (direction = 'up') => {
    if (!activeNode) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const cwd = selectedProject?.fullPath || selectedProject?.path;
      if (!cwd) throw new Error('No project selected');
      const res = await api.compute.syncNode(activeNode.id, direction, cwd);
      const data = await res.json();
      setSyncResult(data);
    } catch (err) { setSyncResult({ success: false, error: err.message }); }
    finally { setIsSyncing(false); }
  };

  const handleRun = async () => {
    if (!activeNode || !customCmd.trim()) return;
    setIsRunning(true);
    setRunResult(null);
    try {
      const cwd = selectedProject?.fullPath || selectedProject?.path;
      const res = await api.compute.runOnNode(activeNode.id, customCmd.trim(), cwd, true);
      const data = await res.json();
      setRunResult(data);
    } catch (err) { setRunResult({ success: false, error: err.message }); }
    finally { setIsRunning(false); }
  };

  const handleFormSave = () => {
    setShowForm(false);
    setEditNode(null);
    loadNodes();
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto w-full space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Server className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Compute Nodes</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">{nodes.length} node{nodes.length !== 1 ? 's' : ''} configured</p>
            </div>
          </div>
          <Button size="sm" onClick={() => { setEditNode(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Node
          </Button>
        </div>

        {/* Node Cards */}
        {nodes.length > 0 ? (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {nodes.map(node => (
              <NodeCard
                key={node.id}
                node={node}
                isActive={node.id === activeNodeId}
                onSelect={handleSelectNode}
                onEdit={(n) => { setEditNode(n); setShowForm(true); }}
                onDelete={handleDeleteNode}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <Server className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No compute nodes configured</p>
            <p className="text-xs mt-1">Click "Add Node" to get started</p>
          </div>
        )}

        {/* Active Node Details */}
        {activeNode && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Connection / Actions */}
            <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Globe className="w-4 h-4" /> {activeNode.name}
                  <span className="text-xs font-normal text-gray-500">({activeNode.type === 'slurm' ? 'Slurm' : 'Direct'})</span>
                </h3>
              </div>
              <div className="p-4 space-y-3">
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={handleTest} disabled={isTesting}>
                  {isTesting ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </Button>
                <ResultBlock result={testResult} />

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 justify-start" onClick={() => handleSync('up')} disabled={isSyncing}>
                    {isSyncing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
                    Sync Up
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 justify-start" onClick={() => handleSync('down')} disabled={isSyncing}>
                    <Download className="w-3.5 h-3.5 mr-1.5" /> Sync Down
                  </Button>
                </div>
                <ResultBlock result={syncResult} />

                <div>
                  <Label>Run Command</Label>
                  <div className="flex gap-2">
                    <Input className="text-sm h-8" placeholder="nvidia-smi" value={customCmd}
                      onChange={e => setCustomCmd(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRun(); }} />
                    <Button size="sm" onClick={handleRun} disabled={isRunning || !customCmd.trim()}>
                      {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  <ResultBlock result={runResult} />
                </div>

                <Button variant={showTerminal ? 'default' : 'outline'} size="sm" className="w-full justify-start"
                  onClick={() => { if (!showTerminal) setTerminalKey(prev => prev + 1); setShowTerminal(!showTerminal); }}>
                  <Terminal className="w-3.5 h-3.5 mr-2" />
                  {showTerminal ? 'Close SSH Terminal' : 'Open SSH Terminal'}
                </Button>
              </div>
            </div>

            {/* Slurm Panel (only for slurm type) */}
            {activeNode.type === 'slurm' ? (
              <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm">
                <div className="p-4">
                  <SlurmPanel node={activeNode} selectedProject={selectedProject} />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-center p-8">
                <div className="text-center text-gray-400">
                  <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Direct GPU Node</p>
                  <p className="text-xs mt-1">{activeNode.user}@{activeNode.host}{activeNode.port && activeNode.port !== 22 ? `:${activeNode.port}` : ''}</p>
                  {activeNode.workDir && activeNode.workDir !== '~' && (
                    <p className="text-xs mt-0.5 text-gray-500">{activeNode.workDir}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SSH Terminal */}
        {showTerminal && activeNode && (
          <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="p-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                SSH Terminal — {activeNode.user}@{activeNode.host}{activeNode.port && activeNode.port !== 22 ? `:${activeNode.port}` : ''}
              </span>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            </div>
            <div className="h-96">
              <Shell
                key={`${terminalKey}-${activeNodeId}`}
                selectedProject={selectedProject || { path: '/', fullPath: '/' }}
                isPlainShell={true}
                autoConnect={true}
                wsPath={`/compute-shell?nodeId=${activeNodeId}`}
                minimal={true}
              />
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      {showForm && (
        <NodeFormDialog
          node={editNode}
          onSave={handleFormSave}
          onClose={() => { setShowForm(false); setEditNode(null); }}
        />
      )}
    </div>
  );
};

export default ComputePanel;
