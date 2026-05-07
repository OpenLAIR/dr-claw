import { useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api } from '../../utils/api';
import type { ComputeNode, NodeFormData } from './types';
import { defaultFormData } from './types';

function formFromNode(node: ComputeNode): NodeFormData {
  return {
    name: node.name || '',
    host: node.host || '',
    user: node.user || '',
    port: String(node.port || 22),
    authType: node.keyPath ? 'key' : node.hasPassword ? 'password' : 'agent',
    key: '',
    password: '',
    workDir: node.workDir || '~',
    type: (node.type as 'direct' | 'slurm') || 'direct',
    slurmPartition: node.slurm?.defaultPartition || '',
    slurmTime: node.slurm?.defaultTime || '00:30:00',
    slurmGpus: String(node.slurm?.defaultGpus ?? 1),
    slurmAccount: node.slurm?.defaultAccount || '',
  };
}

export default function NodeForm({
  node,
  onSave,
  onCancel,
}: {
  node?: ComputeNode;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!node;
  const [form, setForm] = useState<NodeFormData>(node ? formFromNode(node) : { ...defaultFormData });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof NodeFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (!form.host.trim()) { setError('Host is required'); return; }
    if (!form.user.trim()) { setError('Username is required'); return; }
    const port = parseInt(form.port);
    if (form.port && (isNaN(port) || port < 1 || port > 65535)) {
      setError('Port must be between 1 and 65535');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim() || form.host.trim(),
        host: form.host.trim(),
        user: form.user.trim(),
        port: parseInt(form.port) || 22,
        authType: form.authType,
        key: form.authType === 'key' ? form.key : undefined,
        password: form.authType === 'password' ? form.password : undefined,
        workDir: form.workDir.trim() || '~',
        type: form.type,
        slurm: form.type === 'slurm' ? {
          defaultPartition: form.slurmPartition || undefined,
          defaultTime: form.slurmTime || '00:30:00',
          defaultGpus: parseInt(form.slurmGpus) || 1,
          defaultAccount: form.slurmAccount || undefined,
        } : undefined,
      };

      const resp = isEdit
        ? await api.compute.updateNode(node!.id, payload)
        : await api.compute.addNode(payload);
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Request failed');
      onSave();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save node');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{isEdit ? 'Edit Node' : 'Add Remote Node'}</h3>
        <Button variant="ghost" size="sm" className="rounded-xl" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Name (optional)</label>
          <Input
            placeholder="My GPU Server"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="rounded-xl h-9"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Host *</label>
          <Input
            placeholder="192.168.1.100 or hostname"
            value={form.host}
            onChange={(e) => update('host', e.target.value)}
            className="rounded-xl h-9"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Username *</label>
          <Input
            placeholder="root"
            value={form.user}
            onChange={(e) => update('user', e.target.value)}
            className="rounded-xl h-9"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Port</label>
          <Input
            placeholder="22"
            value={form.port}
            onChange={(e) => update('port', e.target.value)}
            className="rounded-xl h-9"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Work Directory</label>
          <Input
            placeholder="~"
            value={form.workDir}
            onChange={(e) => update('workDir', e.target.value)}
            className="rounded-xl h-9"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Node Type</label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={form.type === 'direct' ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-xl flex-1 h-9"
              onClick={() => update('type', 'direct')}
            >
              Direct GPU
            </Button>
            <Button
              type="button"
              variant={form.type === 'slurm' ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-xl flex-1 h-9"
              onClick={() => update('type', 'slurm')}
            >
              Slurm HPC
            </Button>
          </div>
        </div>
      </div>

      {/* Auth section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Authentication</label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={form.authType === 'agent' ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-xl h-7 text-xs"
              onClick={() => update('authType', 'agent')}
            >
              SSH Agent
            </Button>
            <Button
              type="button"
              variant={form.authType === 'key' ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-xl h-7 text-xs"
              onClick={() => update('authType', 'key')}
            >
              SSH Key
            </Button>
            <Button
              type="button"
              variant={form.authType === 'password' ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-xl h-7 text-xs"
              onClick={() => update('authType', 'password')}
            >
              Password
            </Button>
          </div>
        </div>
        {form.authType === 'agent' ? (
          <p className="text-xs text-muted-foreground">Uses system SSH agent (1Password, ssh-agent, etc.) — no key or password needed.</p>
        ) : form.authType === 'key' ? (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">SSH Key (path or content)</label>
            <textarea
              className="flex w-full rounded-xl border border-input bg-background px-3 py-2 text-xs font-mono h-20 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="~/.ssh/id_rsa or paste key content (-----BEGIN OPENSSH PRIVATE KEY-----)"
              value={form.key}
              onChange={(e) => update('key', e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Password</label>
            <Input
              type="password"
              placeholder={isEdit ? '(unchanged)' : 'SSH password'}
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              className="rounded-xl h-9"
            />
          </div>
        )}
      </div>

      {/* Slurm defaults */}
      {form.type === 'slurm' && (
        <div className="border-t pt-3 space-y-3">
          <label className="text-xs font-medium text-muted-foreground">Slurm Defaults</label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Partition</label>
              <Input
                placeholder="GPU-small"
                value={form.slurmPartition}
                onChange={(e) => update('slurmPartition', e.target.value)}
                className="rounded-xl h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Account</label>
              <Input
                placeholder="cis240110p"
                value={form.slurmAccount}
                onChange={(e) => update('slurmAccount', e.target.value)}
                className="rounded-xl h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Time Limit</label>
              <Input
                placeholder="00:30:00"
                value={form.slurmTime}
                onChange={(e) => update('slurmTime', e.target.value)}
                className="rounded-xl h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">GPUs</label>
              <Input
                type="number"
                min="0"
                max="8"
                value={form.slurmGpus}
                onChange={(e) => update('slurmGpus', e.target.value)}
                className="rounded-xl h-9"
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="rounded-xl" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="rounded-xl"
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          {isEdit ? 'Update Node' : 'Add Node'}
        </Button>
      </div>
    </div>
  );
}
