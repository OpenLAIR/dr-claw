import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Stethoscope,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { api } from '../utils/api';

// ── Types ──

type ToolCommand = {
  name: string;
  description: string;
};

type ToolRequirements = {
  runtime: string;
  pythonVersion?: string;
  note?: string;
};

type RegistryTool = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  localPath?: string;
  type: 'claude-skill' | 'python-app';
  commands: ToolCommand[];
  requirements: ToolRequirements;
  tags: string[];
};

type InstalledInfo = {
  installDir: string;
  setupDir?: string;
  installedAt: string;
  type: string;
  repoUrl: string;
  localPath?: string;
  config?: Record<string, string>;
  updatedAt?: string;
};

type ActiveOp = {
  type: string;
  logs: string[];
};

type DoctorResult = {
  check: string;
  ok: boolean;
  message?: string;
};

// ── Main Panel ──

export default function CommunityToolsPanel() {
  const [registry, setRegistry] = useState<RegistryTool[]>([]);
  const [installed, setInstalled] = useState<Record<string, InstalledInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [regRes, instRes] = await Promise.all([
        api.communityTools.registry(),
        api.communityTools.installed(),
      ]);
      if (!regRes.ok) throw new Error('Failed to load registry');
      if (!instRes.ok) throw new Error('Failed to load installed tools');
      const regData = await regRes.json();
      const instData = await instRes.json();
      setRegistry(regData.tools || []);
      setInstalled(instData.tools || {});
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-2">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <button onClick={fetchData} className="text-xs text-primary hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Wrench className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Community Auto Research Tools</h1>
          </div>
          <p className="text-sm text-muted-foreground ml-9">
            Install and manage external research automation tools. Choose from curated community projects to extend your research workflow.
          </p>
        </div>

        {/* Tool Cards */}
        <div className="space-y-4">
          {registry.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              installedInfo={installed[tool.id] || null}
              expanded={expandedTool === tool.id}
              onToggleExpand={() => setExpandedTool(expandedTool === tool.id ? null : tool.id)}
              onRefresh={fetchData}
            />
          ))}
        </div>

        {registry.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No community tools available yet.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tool Card ──

function ToolCard({
  tool,
  installedInfo,
  expanded,
  onToggleExpand,
  onRefresh,
}: {
  tool: RegistryTool;
  installedInfo: InstalledInfo | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onRefresh: () => void;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [doctorResults, setDoctorResults] = useState<DoctorResult[] | null>(null);
  const [runOutput, setRunOutput] = useState<string[]>([]);
  const [polling, setPolling] = useState(false);
  const [configValues, setConfigValues] = useState<Record<string, string>>(
    installedInfo?.config || {}
  );

  const isInstalled = !!installedInfo;

  // Poll for operation progress
  const pollStatus = useCallback(async () => {
    try {
      const res = await api.communityTools.status(tool.id);
      if (!res.ok) return;
      const data = await res.json();
      if (data.activeOperation) {
        setLogs(data.activeOperation.logs || []);
        return true; // still active
      }
      return false;
    } catch {
      return false;
    }
  }, [tool.id]);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      const active = await pollStatus();
      if (!active) {
        setPolling(false);
        onRefresh();
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [polling, pollStatus, onRefresh]);

  const handleInstall = async () => {
    setActionLoading('install');
    setLogs([]);
    setDoctorResults(null);
    try {
      const res = await api.communityTools.install(tool.id);
      const data = await res.json();
      if (!res.ok) {
        setLogs([`Error: ${data.error}`]);
        return;
      }
      if (data.synchronous) {
        // Claude-skill installs complete immediately
        setLogs(data.logs || ['Installation complete']);
        onRefresh();
      } else {
        setPolling(true);
      }
    } catch (err: any) {
      setLogs([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdate = async () => {
    setActionLoading('update');
    setLogs([]);
    try {
      const res = await api.communityTools.update(tool.id);
      if (!res.ok) {
        const data = await res.json();
        setLogs([`Error: ${data.error}`]);
        return;
      }
      setPolling(true);
    } catch (err: any) {
      setLogs([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUninstall = async () => {
    if (!confirm(`Uninstall ${tool.name}? This will remove all installed files.`)) return;
    setActionLoading('uninstall');
    setLogs([]);
    try {
      const res = await api.communityTools.uninstall(tool.id);
      const data = await res.json();
      if (!res.ok) {
        setLogs([`Error: ${data.error}`]);
        return;
      }
      setLogs([data.message]);
      onRefresh();
    } catch (err: any) {
      setLogs([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDoctor = async () => {
    setActionLoading('doctor');
    setDoctorResults(null);
    try {
      const res = await api.communityTools.doctor(tool.id);
      const data = await res.json();
      if (data.success) {
        setDoctorResults(data.results);
      } else {
        setLogs([`Doctor error: ${data.error}`]);
      }
    } catch (err: any) {
      setLogs([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRun = async (command: string) => {
    setActionLoading('run');
    setRunOutput([]);
    try {
      const res = await api.communityTools.run(tool.id, command, []);
      if (!res.ok) {
        const data = await res.json();
        setRunOutput([`Error: ${data.error}`]);
        return;
      }
      setPolling(true);
    } catch (err: any) {
      setRunOutput([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    try {
      await api.communityTools.stop(tool.id);
    } catch { /* ignore */ }
  };

  const handleSaveConfig = async () => {
    setActionLoading('config');
    try {
      const res = await api.communityTools.configure(tool.id, configValues);
      const data = await res.json();
      if (!res.ok) {
        setLogs([`Config error: ${data.error}`]);
        return;
      }
      setLogs([data.message]);
      onRefresh();
    } catch (err: any) {
      setLogs([`Error: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  const typeBadge = tool.type === 'claude-skill'
    ? { label: 'Claude Skill', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' }
    : { label: 'Python App', className: 'bg-green-500/10 text-green-600 dark:text-green-400' };

  const statusBadge = polling
    ? { label: 'Working…', className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' }
    : isInstalled
    ? { label: 'Installed', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
    : { label: 'Not Installed', className: 'bg-muted text-muted-foreground' };

  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      {/* Card Header */}
      <button
        type="button"
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-accent/50 transition-colors"
        onClick={onToggleExpand}
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{tool.name}</span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${typeBadge.className}`}>
              {typeBadge.label}
            </span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusBadge.className}`}>
              {statusBadge.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isInstalled && !polling && (
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={(e) => { e.stopPropagation(); handleInstall(); }}
              disabled={!!actionLoading}
            >
              {actionLoading === 'install' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Install
            </button>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t px-5 py-4 space-y-4">
          {/* Action Buttons */}
          {isInstalled && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-accent transition-colors"
                onClick={handleUpdate}
                disabled={!!actionLoading || polling}
              >
                {actionLoading === 'update' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Update
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-accent transition-colors"
                onClick={handleDoctor}
                disabled={!!actionLoading || polling}
              >
                {actionLoading === 'doctor' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
                Doctor
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                onClick={handleUninstall}
                disabled={!!actionLoading || polling}
              >
                {actionLoading === 'uninstall' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Uninstall
              </button>
            </div>
          )}

          {/* Tool-specific detail */}
          {tool.type === 'claude-skill' && (
            <ClaudeSkillDetail tool={tool} isInstalled={isInstalled} />
          )}
          {tool.type === 'python-app' && isInstalled && (
            <PythonAppDetail
              tool={tool}
              configValues={configValues}
              onConfigChange={setConfigValues}
              onSaveConfig={handleSaveConfig}
              onRun={handleRun}
              onStop={handleStop}
              actionLoading={actionLoading}
              polling={polling}
            />
          )}

          {/* Doctor results */}
          {doctorResults && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Doctor Results</h4>
              <div className="space-y-1">
                {doctorResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {r.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-destructive" />}
                    <span className={r.ok ? 'text-foreground' : 'text-destructive'}>{r.check}</span>
                    {r.message && <span className="text-muted-foreground">— {r.message}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Logs */}
          {logs.length > 0 && (
            <LogOutput title="Operation Log" lines={logs} />
          )}

          {/* Run output (from polling) */}
          {runOutput.length > 0 && (
            <LogOutput title="Run Output" lines={runOutput} />
          )}

          {/* Info */}
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              Repository: <a href={tool.repoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{tool.repoUrl}</a>
            </p>
            {tool.requirements.note && <p>{tool.requirements.note}</p>}
            {isInstalled && installedInfo && (
              <p>Installed: {new Date(installedInfo.installedAt).toLocaleDateString()}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Claude Skill Detail ──

function ClaudeSkillDetail({ tool, isInstalled }: { tool: RegistryTool; isInstalled: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Available Commands</h4>
      <div className="space-y-1.5">
        {tool.commands.map((cmd) => (
          <div key={cmd.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
            <code className="text-xs font-mono text-foreground flex-1">{cmd.name}</code>
            <span className="text-xs text-muted-foreground flex-1">{cmd.description}</span>
            {isInstalled && (
              <button
                type="button"
                className="p-1 rounded hover:bg-accent transition-colors"
                onClick={() => handleCopy(cmd.name)}
                title="Copy command"
              >
                {copied === cmd.name ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardCopy className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
            )}
          </div>
        ))}
      </div>
      {!isInstalled && (
        <p className="text-xs text-muted-foreground italic">Install to use these commands in Claude Code.</p>
      )}
    </div>
  );
}

// ── Python App Detail ──

function PythonAppDetail({
  tool,
  configValues,
  onConfigChange,
  onSaveConfig,
  onRun,
  onStop,
  actionLoading,
  polling,
}: {
  tool: RegistryTool;
  configValues: Record<string, string>;
  onConfigChange: (v: Record<string, string>) => void;
  onSaveConfig: () => void;
  onRun: (command: string) => void;
  onStop: () => void;
  actionLoading: string | null;
  polling: boolean;
}) {
  const [selectedCommand, setSelectedCommand] = useState(tool.commands[0]?.name || '');

  const configFields = [
    { key: 'llm_provider', label: 'LLM Provider', type: 'select', options: ['openai', 'anthropic', 'gemini'] },
    { key: 'api_key', label: 'API Key', type: 'password' },
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'output_dir', label: 'Output Directory', type: 'text' },
  ];

  return (
    <div className="space-y-4">
      {/* Configuration */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Configuration</h4>
        <div className="grid gap-2">
          {configFields.map((field) => (
            <div key={field.key} className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-32 flex-shrink-0">{field.label}</label>
              {field.type === 'select' ? (
                <select
                  className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                  value={configValues[field.key] || ''}
                  onChange={(e) => onConfigChange({ ...configValues, [field.key]: e.target.value })}
                >
                  <option value="">Select…</option>
                  {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input
                  type={field.type}
                  className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
                  placeholder={field.label}
                  value={configValues[field.key] || ''}
                  onChange={(e) => onConfigChange({ ...configValues, [field.key]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-accent transition-colors"
          onClick={onSaveConfig}
          disabled={!!actionLoading}
        >
          {actionLoading === 'config' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Save Config
        </button>
      </div>

      {/* Run Commands */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Run</h4>
        <div className="flex items-center gap-2">
          <select
            className="flex-1 h-8 px-2 text-xs rounded-lg border bg-background"
            value={selectedCommand}
            onChange={(e) => setSelectedCommand(e.target.value)}
          >
            {tool.commands.map((cmd) => (
              <option key={cmd.name} value={cmd.name}>{cmd.name} — {cmd.description}</option>
            ))}
          </select>
          {polling ? (
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              onClick={onStop}
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={() => onRun(selectedCommand)}
              disabled={!!actionLoading}
            >
              {actionLoading === 'run' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Log Output ──

function LogOutput({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h4>
      <div className="bg-muted/50 rounded-lg p-3 max-h-60 overflow-y-auto font-mono text-xs leading-5 whitespace-pre-wrap text-foreground/80">
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
