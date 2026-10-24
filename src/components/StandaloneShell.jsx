import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import Shell from './Shell.jsx';

/**
 * Generic Shell wrapper that can be used in tabs, modals, and other contexts.
 * Provides a flexible API for both standalone and session-based usage.
 *
 * @param {Object} project - Project object with name, fullPath/path, displayName
 * @param {Object} session - Session object (optional, for tab usage)
 * @param {string} command - Initial command to run (optional)
 * @param {boolean} isPlainShell - Use plain shell mode vs Claude CLI (default: auto-detect)
 * @param {boolean} autoConnect - Whether to auto-connect when mounted (default: true)
 * @param {function} onComplete - Callback when process completes (receives exitCode)
 * @param {function} onClose - Callback for close button (optional)
 * @param {string} title - Custom header title (optional)
 * @param {string} className - Additional CSS classes
 * @param {boolean} showHeader - Whether to show custom header (default: true)
 * @param {boolean} compact - Use compact layout (default: false)
 * @param {boolean} minimal - Use minimal mode: no header, no overlays, auto-connect (default: false)
 */
function StandaloneShell({
  project,
  session = null,
  command = null,
  isPlainShell = null,
  shellInstanceId = null,
  autoConnect = true,
  onComplete = null,
  onClose = null,
  title = null,
  className = "",
  showHeader = true,
  compact = false,
  minimal = false
}) {
  const { t } = useTranslation('chat');
  const [isCompleted, setIsCompleted] = useState(false);

  // Default to plain shell (interactive terminal) when no command and no session
  const shouldUsePlainShell = isPlainShell !== null ? isPlainShell : (command !== null || session === null);

  const handleProcessComplete = useCallback((exitCode) => {
    setIsCompleted(true);
    if (onComplete) {
      onComplete(exitCode);
    }
  }, [onComplete]);

  if (!project) {
    return (
      <div className={`h-full flex items-center justify-center ${className}`}>
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">{t('shell.selectProject.title')}</h3>
          <p>{t('shell.selectProject.description')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full w-full flex flex-col ${className}`}>
      {/* Optional custom header */}
      {!minimal && showHeader && title && (
        <div className="flex-shrink-0 bg-background text-foreground border-b border-border px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-medium">{title}</h3>
              {isCompleted && (
                <span className="text-xs text-muted-foreground">{t('shell.status.completed')}</span>
              )}
            </div>
            {onClose && (
              <Button
                type="button" variant="ghost" size="icon"
                onClick={onClose}
                className="min-h-11 min-w-11 text-muted-foreground"
                aria-label={t('shell.workspace.closeShell', { title })}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Shell component wrapper */}
      <div className="flex-1 w-full min-h-0">
        <Shell
          selectedProject={project}
          selectedSession={session}
          initialCommand={command}
          isPlainShell={shouldUsePlainShell}
          shellInstanceId={shellInstanceId}
          onProcessComplete={handleProcessComplete}
          minimal={minimal}
          autoConnect={minimal ? true : autoConnect}
        />
      </div>
    </div>
  );
}

export default StandaloneShell;
