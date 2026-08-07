// ResearchFlow — Data & Backup panel (Phase 5).
// Global data-safety UI: diagnostics (app version, DB path, data dir) +
// Create Backup + backup list + Restore Backup. Backups are consistent SQLite
// snapshots; restore is staged and applied on the next app start (the UI
// communicates the restart requirement).
//
// This panel lives on the Portfolio page so data safety is visible without
// entering any project. All data flows through the /api/rf/* backend — the
// same logic the desktop shell uses.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Database, Download, HardDrive, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '../../utils/api';

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DataBackupPanel() {
  const { t } = useTranslation('researchflow');
  const [info, setInfo] = useState(null);
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [restoreFile, setRestoreFile] = useState('');

  const load = useCallback(async () => {
    try {
      const [infoRes, backupsRes] = await Promise.all([api.rf.getAppInfo(), api.rf.getBackups()]);
      const infoData = await infoRes.json();
      const backupsData = await backupsRes.json();
      if (infoData.success) setInfo(infoData.data);
      if (backupsData.success) setBackups(backupsData.data);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateBackup = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.rf.createBackup();
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Backup failed');
      setMessage(t('data.backupCreated', { file: data.data.file }));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.rf.restoreBackup(restoreFile);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Restore failed');
      setMessage(t('data.restoreStaged', { file: data.data.preRestoreBackup.file }));
      setRestoreFile('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRestoring(false);
    }
  };

  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Database className="h-4 w-4" />
          {t('data.title')}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            <RefreshCw className="h-3 w-3" />
            {t('common.retry')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreateBackup()}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" />
            {t('data.createBackup')}
          </button>
        </div>
      </div>

      {message && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {info && (
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5" />
            <span>{t('data.appVersion')}:</span>
            <span className="font-medium text-foreground">{info.appVersion}</span>
            {info.platform && <span className="text-muted-foreground">({info.platform})</span>}
          </div>
          <div>{t('data.schemaVersion')}: {info.schemaVersion ?? '—'}</div>
          <div className="truncate sm:col-span-2" title={info.databasePath}>
            <span>{t('data.databasePath')}:</span>{' '}
            <span className="font-mono text-foreground">{info.databasePath || t('data.inMemory')}</span>
          </div>
          {info.dataDir && (
            <div className="truncate sm:col-span-2" title={info.dataDir}>
              <span>{t('data.dataDir')}:</span>{' '}
              <span className="font-mono text-foreground">{info.dataDir}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('data.backupsList')}</span>
          <span className="text-muted-foreground">{backups.length}</span>
        </div>
        {backups.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t('data.noBackups')}</div>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {backups.slice(0, 8).map((backup) => (
              <div key={backup.file} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono text-muted-foreground" title={backup.path}>
                  {backup.file}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(backup.size)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={restoreFile}
            onChange={(event) => setRestoreFile(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">{t('data.restoreSelect')}</option>
            {backups.map((backup) => (
              <option key={backup.file} value={backup.file} disabled={!backup.valid}>
                {backup.file}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!restoreFile || restoring}
            onClick={() => void handleRestore()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('data.restoreBackup')}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('data.restoreNote')}
          {isElectron && (
            <button
              type="button"
              onClick={() => window.electronAPI?.openPath(info?.dataDir)}
              className="ml-1 inline-flex items-center gap-1 text-primary hover:underline"
            >
              <Download className="h-3 w-3" />
              {t('data.openDataFolder')}
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
