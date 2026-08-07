// ResearchFlow — Execution Environment (Workspace) panel (Phase 5).
// Project-level Windows/WSL workspace representation (SPEC §19 / §17 UX):
// typed metadata (workspace_type / windows_path / wsl_distro / wsl_path),
// Validate, Open in WSL Terminal / Open Files. All commands go through the
// controlled backend adapters — no shell strings, no renderer Node access.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, HardDrive, Monitor, Terminal, X } from 'lucide-react';
import { api } from '../../utils/api';

export default function WorkspacePanel({ projectId, onClose }) {
  const { t } = useTranslation('researchflow');
  const [workspace, setWorkspace] = useState(null);
  const [validating, setValidating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [validation, setValidation] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.rf.getWorkspace(projectId);
      const data = await res.json();
      if (data.success) setWorkspace(data.data);
    } catch (e) {
      setError(e.message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdate = async (event) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const form = new FormData(event.currentTarget);
      const res = await api.rf.updateWorkspace(projectId, {
        workspaceType: form.get('workspaceType'),
        windowsPath: form.get('windowsPath') || undefined,
        wslDistro: form.get('wslDistro') || undefined,
        wslPath: form.get('wslPath') || undefined,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Update failed');
      setWorkspace(data.data.workspace ?? data.data);
      setMessage(t('workspace.saved'));
      setValidation(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setError(null);
    setValidation(null);
    try {
      const res = await api.rf.validateWorkspace(projectId);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Validation failed');
      setValidation(data.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setValidating(false);
    }
  };

  const handleOpenTerminal = async () => {
    setOpening(true);
    setError(null);
    try {
      const res = await api.rf.openWorkspaceTerminal(projectId);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to open terminal');
      setMessage(t('workspace.terminalOpened'));
    } catch (e) {
      setError(e.message);
    } finally {
      setOpening(false);
    }
  };

  const type = workspace?.workspaceType || 'none';

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <HardDrive className="h-4 w-4" />
          {t('workspace.executionEnvironment')}
        </h3>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {message && (
        <div className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={(event) => void handleUpdate(event)} className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{t('workspace.typeLabel')}</span>
          <select
            name="workspaceType"
            defaultValue={type}
            className="rounded-md border border-border bg-background px-2 py-1.5"
          >
            <option value="none">{t('workspace.typeNone')}</option>
            <option value="windows">{t('workspace.typeWindows')}</option>
            <option value="wsl">{t('workspace.typeWsl')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{t('workspace.wslDistro')}</span>
          <input
            name="wslDistro"
            defaultValue={workspace?.wslDistro ?? ''}
            placeholder="Ubuntu-22.04"
            className="rounded-md border border-border bg-background px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-muted-foreground">{t('workspace.windowsPath')}</span>
          <input
            name="windowsPath"
            defaultValue={workspace?.windowsPath ?? ''}
            placeholder="D:\Research\ProjectA"
            className="rounded-md border border-border bg-background px-2 py-1.5 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-muted-foreground">{t('workspace.wslPath')}</span>
          <input
            name="wslPath"
            defaultValue={workspace?.wslPath ?? ''}
            placeholder="/home/user/projects/project-a"
            className="rounded-md border border-border bg-background px-2 py-1.5 font-mono"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground"
        >
          {t('common.save')}
        </button>
      </form>

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {type === 'wsl' ? <Terminal className="h-3.5 w-3.5" /> : type === 'windows' ? <Monitor className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}
          {t(`workspace.statusType_${type}`)}
        </span>
        {workspace?.path && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={workspace.path}>
            {workspace.path}
          </span>
        )}
      </div>

      {validation && (
        <div
          className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
            validation.ok
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400'
          }`}
        >
          {validation.ok ? t('workspace.validated') : (validation.errors || []).join('; ')}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={type === 'none' || validating}
          onClick={() => void handleValidate()}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {t('workspace.validate')}
        </button>
        <button
          type="button"
          disabled={type === 'none' || opening}
          onClick={() => void handleOpenTerminal()}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
        >
          <Terminal className="h-3.5 w-3.5" />
          {t('workspace.openTerminal')}
        </button>
      </div>
    </div>
  );
}
