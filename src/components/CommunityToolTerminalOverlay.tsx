import { useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Minimize2, Maximize2, Terminal, X } from 'lucide-react';
import StandaloneShell from './StandaloneShell';

const AnyStandaloneShell = StandaloneShell as any;

export interface CommunityToolTerminalConfig {
  toolId: string;
  toolName: string;
  installDir: string;
  setupDir: string;
  initialCommand?: string;
}

export default function CommunityToolTerminalOverlay({
  config,
  onClose,
}: {
  config: CommunityToolTerminalConfig;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const [minimized, setMinimized] = useState(false);
  const [shellId] = useState(() => Date.now().toString(36));

  const parts: string[] = [];
  if (config.setupDir) parts.push(`source "${config.setupDir}/.venv/bin/activate"`);
  parts.push(`cd "${config.setupDir || config.installDir}"`);
  parts.push(config.initialCommand || 'exec bash');
  const fullCommand = parts.join(' && ');

  if (minimized) {
    return ReactDOM.createPortal(
      <div className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 shadow-lg cursor-pointer select-none">
        <Terminal className="w-4 h-4 text-emerald-400" />
        <span className="text-xs text-gray-200">{config.toolName}</span>
        <span className="text-[10px] text-emerald-400">{t('communityToolsPanel.terminalRunning')}</span>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="p-0.5 rounded hover:bg-gray-700 transition-colors"
          title={t('communityToolsPanel.terminalMaximize')}
        >
          <Maximize2 className="w-3.5 h-3.5 text-gray-400" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-700 transition-colors"
        >
          <X className="w-3.5 h-3.5 text-gray-400" />
        </button>
      </div>,
      document.body,
    );
  }

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
      <div className="w-[90vw] max-w-6xl h-[80vh] flex flex-col rounded-xl overflow-hidden bg-gray-900 shadow-2xl pointer-events-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-gray-100">
              {t('communityToolsPanel.terminalTitle')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMinimized(true)}
              className="p-1 rounded hover:bg-gray-700 transition-colors"
              title={t('communityToolsPanel.terminalMinimize')}
            >
              <Minimize2 className="w-4 h-4 text-gray-400" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-700 transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Terminal */}
        <div className="flex-1 min-h-0">
          <AnyStandaloneShell
            project={{
              name: `community-tool-${config.toolId}`,
              displayName: config.toolName,
              fullPath: config.setupDir || config.installDir,
            }}
            command={fullCommand}
            isPlainShell={true}
            shellInstanceId={shellId}
            autoConnect={true}
            minimal={true}
          />
        </div>

        {/* Hint bar */}
        <div className="px-4 py-2 bg-gray-800 border-t border-gray-700">
          <p className="text-[11px] text-gray-400">
            {t('communityToolsPanel.terminalHint')}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
