import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Server,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plug,
  Unplug,
  Trash2,
  Edit3,
  Play,
  Terminal,
  RefreshCw,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api } from '../../utils/api';
import { ResourceCards } from './ResourceCards';
import NodeForm from './NodeForm';
import SlurmPanel from './SlurmPanel';
import type { NodeWithMonitor } from './types';
import Shell from '../Shell';

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

export default function NodeCard({
  data,
  isConnected,
  onConnect,
  onDisconnect,
  onDelete,
  onNodeUpdated,
  onSetActive,
}: {
  data: NodeWithMonitor;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
  onNodeUpdated: () => void;
  onSetActive: () => void;
}) {
  const { t } = useTranslation('common');
  const commandId = useId();
  const { node, monitor, loading, isActive } = data;
  const hasData = monitor?.success && (monitor.gpus.length > 0 || monitor.cpu);

  // UI state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalKey, setTerminalKey] = useState(0);

  // Action state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ActionResult | null>(null);
  const [runCmd, setRunCmd] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<ActionResult | null>(null);
  const [isSettingActive, setIsSettingActive] = useState(false);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.compute.testNode(node.id);
      const d = await res.json();
      setTestResult({ ...d, success: res.ok && d.success === true });
    } catch (err: unknown) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : t('messages.operationFailed') });
    } finally {
      setIsTesting(false);
    }
  };

  const handleRun = async () => {
    if (!runCmd.trim()) return;
    setIsRunning(true);
    setRunResult(null);
    try {
      const res = await api.compute.runOnNode(node.id, runCmd.trim(), node.workDir || undefined, true);
      const d = await res.json();
      setRunResult({ ...d, success: res.ok && d.success === true });
    } catch (err: unknown) {
      setRunResult({ success: false, error: err instanceof Error ? err.message : t('messages.operationFailed') });
    } finally {
      setIsRunning(false);
    }
  };

  const handleSetActive = async () => {
    setIsSettingActive(true);
    try {
      await onSetActive();
    } finally {
      setIsSettingActive(false);
    }
  };

  // Edit form
  if (showEdit) {
    return (
      <NodeForm
        node={node}
        onSave={() => { setShowEdit(false); onNodeUpdated(); }}
        onCancel={() => setShowEdit(false)}
      />
    );
  }

  return (
    <div className="rounded-md border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-base font-semibold">{node.name}</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {node.user}@{node.host}
            {node.port && node.port !== 22 ? `:${node.port}` : ''}
          </span>
          {isActive && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">
              {t('computeUI.active')}
            </span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {node.type === 'slurm' ? 'Slurm HPC' : t('computeForm.direct')}
          </span>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Monitor data (only when connected) */}
      {isConnected && monitor && !monitor.success && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{monitor.error || t('computeUI.connectFailed')}</span>
        </div>
      )}

      {isConnected && hasData && monitor && <ResourceCards monitor={monitor} />}

      {isConnected && !loading && !hasData && monitor?.success && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>{t('computeUI.connectedNoGpu')}</span>
        </div>
      )}

      {/* Operations panel (only when connected) */}
      {isConnected && (
        <div className="border-t pt-4 space-y-3">
          {/* Test connection */}
          <div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={() => void handleTest()}
              disabled={isTesting}
            >
              {isTesting ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              )}
              {t('computeUI.test')}
            </Button>
            <ResultBlock result={testResult} />
          </div>

          {/* Run command */}
          <div className="space-y-1">
            <label htmlFor={commandId} className="text-sm text-muted-foreground">{t('computeUI.run')}</label>
            <div className="flex gap-2">
              <Input
                className="rounded-md h-9"
                placeholder="nvidia-smi"
                id={commandId} value={runCmd}
                onChange={(e) => setRunCmd(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleRun(); }}
              />
              <Button
                size="sm"
                className="rounded-md"
                aria-label={t('computeUI.run')} onClick={() => void handleRun()}
                disabled={isRunning || !runCmd.trim()}
              >
                {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
            </div>
            <ResultBlock result={runResult} />
          </div>

          {/* SSH Terminal toggle */}
          <Button
            variant={showTerminal ? 'default' : 'outline'}
            size="sm"
            className="rounded-md"
            onClick={() => {
              if (!showTerminal) setTerminalKey((prev) => prev + 1);
              setShowTerminal(!showTerminal);
            }}
          >
            <Terminal className="w-3.5 h-3.5 mr-1.5" />
            {t(showTerminal ? 'computeUI.closeTerminal' : 'computeUI.openTerminal')}
          </Button>

          {/* SSH Terminal */}
          {showTerminal && (
            <div className="rounded-md border overflow-hidden">
              <div className="p-2.5 border-b flex items-center gap-2 bg-muted/30">
                <Terminal className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium">
                  SSH — {node.user}@{node.host}
                  {node.port && node.port !== 22 ? `:${node.port}` : ''}
                </span>
                <div className="w-2 h-2 rounded-full bg-emerald-500 " />
              </div>
              <div className="h-96">
                <Shell
                  key={`${terminalKey}-${node.id}`}
                  selectedProject={{ path: '/', fullPath: '/' } as any}
                  selectedSession={null}
                  initialCommand={null}
                  onProcessComplete={() => {}}
                  isPlainShell={true}
                  autoConnect={true}
                  wsPath={`/compute-shell?nodeId=${node.id}`}
                  minimal={true}
                />
              </div>
            </div>
          )}

          {/* Slurm panel (only for slurm nodes) */}
          {node.type === 'slurm' && (
            <div className="border-t pt-4">
              <SlurmPanel node={node} projectPath={node.workDir} />
            </div>
          )}
        </div>
      )}

      {/* Bottom actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {isConnected ? (
            <Button
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={() => { setShowTerminal(false); onDisconnect(); }}
            >
              <Unplug className="h-3.5 w-3.5 mr-1.5" />
              {t('computeUI.disconnect')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={onConnect}
              disabled={loading}
            >
              <Plug className="h-3.5 w-3.5 mr-1.5" />
              {t('computeUI.connect')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="rounded-md text-muted-foreground"
            onClick={() => setShowEdit(true)}
          >
            <Edit3 className="h-3.5 w-3.5 mr-1.5" />
            {t('buttons.edit')}
          </Button>
          {!isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-md text-muted-foreground"
              onClick={() => void handleSetActive()}
              disabled={isSettingActive}
            >
              {isSettingActive ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Server className="h-3.5 w-3.5 mr-1.5" />}
              {t('computeUI.setActive')}
            </Button>
          )}
        </div>

        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('computeUI.deleteConfirm')}</span>
            <Button
              variant="destructive"
              size="sm"
              className="rounded-md h-7 text-xs"
              onClick={() => { setConfirmDelete(false); onDelete(); }}
            >
              {t('buttons.confirm')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-md h-7 text-xs"
              onClick={() => setConfirmDelete(false)}
            >
              {t('buttons.cancel')}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-md text-muted-foreground hover:text-destructive"
            aria-label={t('buttons.delete')} onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
