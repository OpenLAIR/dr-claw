import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authenticatedFetch } from '../../../../utils/api';
import type { Project } from '../../../../types/app';

interface RevertAgentChangesButtonProps {
  files: string[];
  project: Project;
}

interface RevertResponse {
  success: boolean;
  reverted?: string[];
  skipped?: string[];
  errors?: Array<{ file: string; reason: string }>;
  error?: string;
}

type RevertState = 'idle' | 'confirming' | 'reverting' | 'done' | 'error';

export default function RevertAgentChangesButton({ files, project }: RevertAgentChangesButtonProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<RevertState>('idle');
  const [result, setResult] = useState<RevertResponse | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const idleButtonRef = useRef<HTMLButtonElement | null>(null);

  // When opening the confirmation, move focus to the destructive action so
  // keyboard users can see it's the focused control; Escape cancels.
  useEffect(() => {
    if (state === 'confirming' && confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }
  }, [state]);

  useEffect(() => {
    if (state !== 'confirming') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setState('idle');
        // restore focus to the original trigger
        requestAnimationFrame(() => idleButtonRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  if (files.length === 0) return null;

  const handleRevert = async () => {
    setState('reverting');
    try {
      const response = await authenticatedFetch('/api/git/revert-agent-changes', {
        method: 'POST',
        body: JSON.stringify({
          project: project.name,
          files,
        }),
      });
      const data: RevertResponse = await response.json();
      if (!response.ok) {
        setResult({ success: false, error: data?.error || `HTTP ${response.status}` });
        setState('error');
        return;
      }
      setResult(data);
      setState(data.success ? 'done' : 'error');
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      setState('error');
    }
  };

  const fileCount = files.length;
  const buttonLabel = t('revertAgent.button', { defaultValue: 'Revert changes' });
  // Explicit about semantics: we restore to HEAD (last commit), which can
  // also undo manual edits to the same files.  The issue asked for
  // preserving edits to *other* files, which we do.
  const confirmLabel = t('revertAgent.confirmLabel', {
    count: fileCount,
    defaultValue: fileCount === 1
      ? 'Restore 1 file to its last committed state? Any manual edits to this file will also be lost.'
      : `Restore ${fileCount} files to their last committed state? Any manual edits to these files will also be lost.`,
  });

  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={buttonLabel}>
      {state === 'idle' && (
        <button
          ref={idleButtonRef}
          type="button"
          onClick={() => setState('confirming')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors"
          aria-label={t('revertAgent.tooltip', {
            count: fileCount,
            defaultValue: `Discard changes the agent made to ${fileCount} file(s)`,
          })}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          <span>{buttonLabel}</span>
          <span className="text-[10px] opacity-70">({fileCount})</span>
        </button>
      )}

      {state === 'confirming' && (
        // Non-modal inline confirmation: role=group keeps the semantics honest
        // (no focus trap, no backdrop), while aria-labelledby points screen
        // readers at the warning text and focus moves to the destructive
        // action so keyboard users see what pressing Enter will do.
        <div
          role="group"
          aria-label={confirmLabel}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200"
        >
          <span>{confirmLabel}</span>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={handleRevert}
            className="px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900 transition-colors"
          >
            {t('revertAgent.confirm', { defaultValue: 'Revert' })}
          </button>
          <button
            type="button"
            onClick={() => setState('idle')}
            className="px-2 py-0.5 rounded text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            {t('revertAgent.cancel', { defaultValue: 'Cancel' })}
          </button>
        </div>
      )}

      {state === 'reverting' && (
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 dark:text-gray-400"
        >
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {t('revertAgent.inProgress', { defaultValue: 'Reverting...' })}
        </span>
      )}

      {state === 'done' && result && (
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {t('revertAgent.done', {
            count: result.reverted?.length ?? 0,
            defaultValue: `Reverted ${result.reverted?.length ?? 0} file(s)`,
          })}
          {(result.skipped?.length ?? 0) > 0 && (
            <span className="opacity-70">
              · {t('revertAgent.skipped', {
                count: result.skipped!.length,
                defaultValue: `${result.skipped!.length} unchanged`,
              })}
            </span>
          )}
        </span>
      )}

      {state === 'error' && result && (
        <span
          role="status"
          aria-live="assertive"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
          title={result.error || result.errors?.map(e => `${e.file}: ${e.reason}`).join('\n')}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />
          </svg>
          {t('revertAgent.error', { defaultValue: 'Revert failed' })}
          {(result.errors?.length ?? 0) > 0 && (
            <span className="opacity-70">({result.errors!.length})</span>
          )}
        </span>
      )}
    </div>
  );
}
