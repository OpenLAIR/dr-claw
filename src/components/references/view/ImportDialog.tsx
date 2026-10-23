import WorkbenchDialog from '../../ui/WorkbenchDialog';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { useReferenceImport } from '../hooks/useReferenceImport';
import ZoteroBrowser from './ZoteroBrowser';
import type { ZoteroStatus } from '../types';

interface ImportDialogProps {
  zoteroStatus: ZoteroStatus | null;
  projectName?: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function ImportDialog({ zoteroStatus, projectName, onClose, onComplete }: ImportDialogProps) {
  const { t } = useTranslation('references');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { syncing, importing, syncResult, importResult, error, syncZotero, importBibtex } = useReferenceImport(projectName, onComplete);

  const handleFileSelect = async (file: File) => {
    setLocalError(null);
    if (!file.name.endsWith('.bib') && !file.name.endsWith('.bibtex')) {
      setLocalError(t('import.invalidFileType'));
      return;
    }
    try {
      await importBibtex(file);
    } catch {
      // error is set in state
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  return (
    <WorkbenchDialog title={t('import.title')} onClose={onClose}>

        {showBrowser ? (
          <ZoteroBrowser
            projectName={projectName}
            onClose={() => setShowBrowser(false)}
            onImportComplete={() => {
              setShowBrowser(false);
              onComplete();
            }}
          />
        ) : (
          <>

            <p className="mt-1 text-sm text-muted-foreground">{t('import.description')}</p>

            {/* Zotero Sync */}
            <div className="mt-6 rounded-lg border border-border/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{t('import.zoteroSync')}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {zoteroStatus === null
                      ? t('import.zoteroChecking')
                      : zoteroStatus.connected
                        ? t('import.zoteroConnected')
                        : zoteroStatus.localApiDisabled
                          ? t('import.zoteroApiDisabled')
                          : t('import.zoteroNotRunning')}
                  </p>
                </div>
                <div className="flex gap-2">
                  {zoteroStatus?.connected && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowBrowser(true)}
                    >
                      {t('browser.browseAndSelect')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => { syncZotero().catch(() => {}); }}
                    disabled={!zoteroStatus?.connected || syncing}
                  >
                    {syncing ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    )}
                    {t('import.syncButton')}
                  </Button>
                </div>
              </div>
              {syncResult && (
                <div className="mt-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle className="h-4 w-4" />
                  {t('import.syncSuccess', { count: syncResult.synced })}
                </div>
              )}
            </div>

            {/* BibTeX Import */}
            <div className="mt-4 rounded-lg border border-border/50 p-4">
              <h3 className="text-sm font-medium text-foreground">{t('import.bibtexImport')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('import.bibtexDescription')}</p>

              <div
                className={`mt-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                  dragOver
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border/60 hover:border-border'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <Upload className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="mt-2 text-sm text-muted-foreground">{t('import.dropBibtex')}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  {importing ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t('import.browseFile')}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".bib,.bibtex"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
              </div>
              {importResult && (
                <div className="mt-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle className="h-4 w-4" />
                  {t('import.importSuccess', { count: importResult.imported })}
                </div>
              )}
            </div>

            {(error || localError) && (
              <div role="alert" className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {localError || error}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                {t('actions.close')}
              </Button>
            </div>
          </>
        )}
    </WorkbenchDialog>
  );
}
