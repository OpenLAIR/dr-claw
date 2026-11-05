import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    authType: node.keyPath ? 'key' : node.hasPassword ? 'password' : 'key',
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
  const { t } = useTranslation('common');
  const formId = useId();
  const isEdit = !!node;
  const [form, setForm] = useState<NodeFormData>(node ? formFromNode(node) : { ...defaultFormData });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof NodeFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (submitting) return;
    if (!form.host.trim()) { setError(t('computeForm.hostRequired')); return; }
    if (!form.user.trim()) { setError(t('computeForm.userRequired')); return; }
    const port = form.port ? Number(form.port) : 22;
    if (form.port && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError(t('computeForm.portInvalid'));
      return;
    }
    const gpus = form.slurmGpus === '' ? 1 : Number(form.slurmGpus);
    if (form.type === 'slurm' && (!Number.isInteger(gpus) || gpus < 0 || gpus > 8)) { setError(t('computeForm.gpusInvalid')); return; }
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim() || form.host.trim(),
        host: form.host.trim(),
        user: form.user.trim(),
        port,
        authType: form.authType,
        key: form.authType === 'key' ? form.key : undefined,
        password: form.authType === 'password' ? form.password : undefined,
        workDir: form.workDir.trim() || '~',
        type: form.type,
        slurm: form.type === 'slurm' ? {
          defaultPartition: form.slurmPartition || undefined,
          defaultTime: form.slurmTime || '00:30:00',
          defaultGpus: gpus,
          defaultAccount: form.slurmAccount || undefined,
        } : undefined,
      };

      const resp = isEdit
        ? await api.compute.updateNode(node!.id, payload)
        : await api.compute.addNode(payload);
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || t('messages.operationFailed'));
      onSave();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('computeForm.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-y border-border py-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t(isEdit ? 'computeForm.editTitle' : 'computeForm.addTitle')}</h3>
        <Button variant="ghost" size="sm" className="rounded-md" onClick={onCancel} disabled={submitting} aria-label={t('buttons.cancel')}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor={`${formId}-name`} className="text-sm text-muted-foreground">{t('computeForm.name')}</label>
          <Input
            placeholder={t('computeForm.namePlaceholder')}
            id={`${formId}-name`}
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="rounded-md h-9"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${formId}-host`} className="text-sm text-muted-foreground">{t('computeForm.host')}</label>
          <Input
            placeholder={t('computeForm.hostPlaceholder')}
            id={`${formId}-host`}
            value={form.host}
            onChange={(e) => update('host', e.target.value)}
            className="rounded-md h-9"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${formId}-user`} className="text-sm text-muted-foreground">{t('computeForm.user')}</label>
          <Input
            placeholder="root"
            id={`${formId}-user`}
            value={form.user}
            onChange={(e) => update('user', e.target.value)}
            className="rounded-md h-9"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${formId}-port`} className="text-sm text-muted-foreground">{t('computeForm.port')}</label>
          <Input
            placeholder="22"
            id={`${formId}-port`}
            value={form.port}
            onChange={(e) => update('port', e.target.value)}
            className="rounded-md h-9"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${formId}-workDir`} className="text-sm text-muted-foreground">{t('computeForm.workDir')}</label>
          <Input
            placeholder="~"
            id={`${formId}-workDir`}
            value={form.workDir}
            onChange={(e) => update('workDir', e.target.value)}
            className="rounded-md h-9"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t('computeForm.nodeType')}</label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={form.type === 'direct' ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-md flex-1 h-9"
              aria-pressed={form.type === 'direct'} onClick={() => update('type', 'direct')}
            >
              {t('computeForm.direct')}
            </Button>
            <Button
              type="button"
              variant={form.type === 'slurm' ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-md flex-1 h-9"
              aria-pressed={form.type === 'slurm'} onClick={() => update('type', 'slurm')}
            >
              Slurm HPC
            </Button>
          </div>
        </div>
      </div>

      {/* Auth section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">{t('computeForm.authentication')}</label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={form.authType === 'key' ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-md h-7 text-xs"
              aria-pressed={form.authType === 'key'} onClick={() => update('authType', 'key')}
            >
              {t('computeForm.sshKey')}
            </Button>
            <Button
              type="button"
              variant={form.authType === 'password' ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-md h-7 text-xs"
              aria-pressed={form.authType === 'password'} onClick={() => update('authType', 'password')}
            >
              {t('computeForm.password')}
            </Button>
          </div>
        </div>
        {form.authType === 'key' ? (
          <div className="space-y-1">
            <label htmlFor={`${formId}-key`} className="text-sm text-muted-foreground">{t('computeForm.key')}</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono h-20 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('computeForm.keyPlaceholder')}
              id={`${formId}-key`}
            value={form.key}
              onChange={(e) => update('key', e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label htmlFor={`${formId}-password`} className="text-sm text-muted-foreground">{t('computeForm.password')}</label>
            <Input
              type="password"
              placeholder={t(isEdit ? 'computeForm.unchanged' : 'computeForm.passwordPlaceholder')}
              id={`${formId}-password`}
            value={form.password}
              onChange={(e) => update('password', e.target.value)}
              className="rounded-md h-9"
            />
          </div>
        )}
      </div>

      {/* Slurm defaults */}
      {form.type === 'slurm' && (
        <div className="border-t pt-3 space-y-3">
          <label className="text-xs font-medium text-muted-foreground">{t('computeForm.slurmDefaults')}</label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${formId}-slurmPartition`} className="text-sm text-muted-foreground">{t('computeForm.partition')}</label>
              <Input
                placeholder="GPU-small"
                id={`${formId}-slurmPartition`}
            value={form.slurmPartition}
                onChange={(e) => update('slurmPartition', e.target.value)}
                className="rounded-md h-9"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${formId}-slurmAccount`} className="text-sm text-muted-foreground">{t('computeForm.account')}</label>
              <Input
                placeholder="cis240110p"
                id={`${formId}-slurmAccount`}
            value={form.slurmAccount}
                onChange={(e) => update('slurmAccount', e.target.value)}
                className="rounded-md h-9"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${formId}-slurmTime`} className="text-sm text-muted-foreground">{t('computeForm.time')}</label>
              <Input
                placeholder="00:30:00"
                id={`${formId}-slurmTime`}
            value={form.slurmTime}
                onChange={(e) => update('slurmTime', e.target.value)}
                className="rounded-md h-9"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${formId}-slurmGpus`} className="text-sm text-muted-foreground">{t('computeForm.gpus')}</label>
              <Input
                type="number"
                min="0"
                max="8"
                id={`${formId}-slurmGpus`}
            value={form.slurmGpus}
                onChange={(e) => update('slurmGpus', e.target.value)}
                className="rounded-md h-9"
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="rounded-md" onClick={onCancel} disabled={submitting} aria-label={t('buttons.cancel')}>
          {t('buttons.cancel')}
        </Button>
        <Button
          size="sm"
          className="rounded-md"
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          {t(isEdit ? 'computeForm.update' : 'computeForm.add')}
        </Button>
      </div>
    </div>
  );
}
