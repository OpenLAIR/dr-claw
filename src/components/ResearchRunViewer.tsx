import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Terminal,
  XCircle,
} from 'lucide-react';
import { api } from '../utils/api';
import { Markdown } from './chat/view/subcomponents/Markdown';
import type { CommunityToolTerminalConfig } from './CommunityToolTerminalOverlay';
import StandaloneShell from './StandaloneShell';

const AnyStandaloneShell = StandaloneShell as any;

type OutputEntry = {
  name: string;
  path: string;
  type: 'dir' | 'directory' | 'file';
  size?: number;
  children?: OutputEntry[];
};

type StageHealth = {
  stage_id?: string;
  stage_number?: number;
  stage_name?: string;
  status?: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  error?: string;
};

type Checkpoint = {
  last_completed_stage?: number;
  last_completed_name?: string;
  total_stages?: number;
  status?: string;
  run_id?: string;
};

const isDir = (entry: OutputEntry) => entry.type === 'dir' || entry.type === 'directory';

type ResearchRunViewerProps = {
  toolId: string;
  runPath: string;
  onOpenTerminal?: (config: CommunityToolTerminalConfig) => void;
};

export default function ResearchRunViewer({
  toolId,
  runPath,
  onOpenTerminal,
}: ResearchRunViewerProps) {
  const { t } = useTranslation('common');
  const [tree, setTree] = useState<OutputEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [stageHealthMap, setStageHealthMap] = useState<Record<string, StageHealth>>({});
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [installDir, setInstallDir] = useState<string | null>(null);
  const [setupDir, setSetupDir] = useState<string | null>(null);
  const [shellId] = useState(() => `run-${Date.now().toString(36)}`);
  const [resuming, setResuming] = useState(false);
  const [resumeLogs, setResumeLogs] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [runActive, setRunActive] = useState(false);

  // Resume polling ref
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Terminal drag-to-resize
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizingTerminal = useRef(false);
  const [terminalWidth, setTerminalWidth] = useState(400);

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingTerminal.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const container = containerRef.current;
    if (!container) return;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingTerminal.current || !container) return;
      const rect = container.getBoundingClientRect();
      const maxWidth = rect.width * 0.7;
      const newWidth = Math.min(maxWidth, Math.max(200, rect.right - ev.clientX));
      setTerminalWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizingTerminal.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const runName = useMemo(() => {
    const parts = runPath.split('/');
    return parts[parts.length - 1] || runPath;
  }, [runPath]);

  // Fetch install dirs for embedded terminal
  useEffect(() => {
    (async () => {
      try {
        const res = await api.communityTools.installed();
        if (!res.ok) return;
        const data = await res.json();
        const info = (data.tools || {})[toolId];
        if (info) {
          setInstallDir(info.installDir || null);
          setSetupDir(info.setupDir || null);
        }
      } catch { /* ignore */ }
    })();
  }, [toolId]);

  // Build terminal command
  const terminalCommand = useMemo(() => {
    const dir = setupDir || installDir;
    if (!dir) return null;
    const parts: string[] = [];
    if (setupDir) parts.push(`source "${setupDir}/.venv/bin/activate"`);
    parts.push(`cd "${dir}"`);
    parts.push('exec bash');
    return parts.join(' && ');
  }, [setupDir, installDir]);

  // Resolve the run's subtree from the full outputs tree
  const resolveRunTree = useCallback(
    (fullTree: OutputEntry[]): OutputEntry[] => {
      const pathParts = runPath.split('/');
      let current: OutputEntry[] = fullTree;
      for (const part of pathParts) {
        const dir = current.find(
          (entry) => entry.name === part && isDir(entry),
        );
        if (!dir) break;
        current = dir.children || [];
      }
      return current;
    },
    [runPath],
  );

  // Fetch the run's file tree (with loading indicator — used on mount)
  const fetchTree = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.communityTools.outputs(toolId);
      if (!res.ok) throw new Error('Failed to load outputs');

      const data = await res.json();
      const current = resolveRunTree(data.tree || []);
      setTree(current);

      // Auto-expand stage directories
      const stageDirs = new Set<string>();
      for (const entry of current) {
        if (isDir(entry) && entry.name.startsWith('stage-')) {
          stageDirs.add(entry.path);
        }
      }
      setExpandedDirs(stageDirs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [toolId, resolveRunTree]);

  // Silent tree refresh — no loading spinner, auto-expands new stage dirs
  const refreshTree = useCallback(async () => {
    try {
      const res = await api.communityTools.outputs(toolId);
      if (!res.ok) return;
      const data = await res.json();
      const current = resolveRunTree(data.tree || []);
      setTree((prev) => {
        // Only update if the tree actually changed (new entries)
        if (JSON.stringify(prev.map((e) => e.name)) === JSON.stringify(current.map((e) => e.name))) {
          return prev;
        }
        // Auto-expand any new stage directories
        const prevNames = new Set(prev.map((e) => e.name));
        const newStageDirs: string[] = [];
        for (const entry of current) {
          if (isDir(entry) && entry.name.startsWith('stage-') && !prevNames.has(entry.name)) {
            newStageDirs.push(entry.path);
          }
        }
        if (newStageDirs.length > 0) {
          setExpandedDirs((dirs) => {
            const next = new Set(dirs);
            for (const d of newStageDirs) next.add(d);
            return next;
          });
        }
        return current;
      });
    } catch {
      // Silently ignore refresh errors
    }
  }, [toolId, resolveRunTree]);

  // Fetch checkpoint.json and stage_health.json files
  const fetchMetadata = useCallback(async () => {
    try {
      // Try to load checkpoint.json
      const cpRes = await api.communityTools.readOutputFile(
        toolId,
        `${runPath}/checkpoint.json`,
      );
      if (cpRes.ok) {
        const cpWrapper = await cpRes.json();
        setCheckpoint(JSON.parse(cpWrapper.content));
      }
    } catch {
      // Checkpoint may not exist
    }

    // Load stage health files
    const healthMap: Record<string, StageHealth> = {};
    for (const entry of tree) {
      if (isDir(entry) && entry.name.startsWith('stage-')) {
        try {
          const healthRes = await api.communityTools.readOutputFile(
            toolId,
            `${runPath}/${entry.name}/stage_health.json`,
          );
          if (healthRes.ok) {
            const wrapper = await healthRes.json();
            healthMap[entry.name] = JSON.parse(wrapper.content);
          }
        } catch {
          // Stage health may not exist
        }
      }
    }
    setStageHealthMap(healthMap);
  }, [toolId, runPath, tree]);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  useEffect(() => {
    if (tree.length > 0) {
      void fetchMetadata();
    }
  }, [tree.length, fetchMetadata]);

  // On mount, auto-detect if a run is already in progress and start polling
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.communityTools.status(toolId);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (data.activeOperation?.running) {
          setResuming(true);
          startResumePolling();
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId]);

  // Cleanup poll intervals on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, []);

  // Auto-refresh tree + checkpoint while run is active
  // Checks heartbeat to detect active runs (not just ones started via Resume)
  useEffect(() => {
    // Check heartbeat to detect if the run is active
    const checkHeartbeat = async () => {
      try {
        const hbRes = await api.communityTools.readOutputFile(
          toolId,
          `${runPath}/heartbeat.json`,
        );
        if (!hbRes.ok) return false;
        const wrapper = await hbRes.json();
        const hb = JSON.parse(wrapper.content);
        const ts = new Date(hb.timestamp).getTime();
        // Active if heartbeat is within the last 60 seconds
        return Date.now() - ts < 60_000;
      } catch {
        return false;
      }
    };

    let mounted = true;
    const startRefresh = async () => {
      const active = resuming || (await checkHeartbeat());
      if (!mounted) return;
      setRunActive(active);

      if (active && !refreshIntervalRef.current) {
        // Refresh tree + checkpoint every 5 seconds while active
        refreshIntervalRef.current = setInterval(async () => {
          await refreshTree();
          // Refresh checkpoint (silent)
          try {
            const cpRes = await api.communityTools.readOutputFile(
              toolId,
              `${runPath}/checkpoint.json`,
            );
            if (cpRes.ok) {
              const cpWrapper = await cpRes.json();
              setCheckpoint(JSON.parse(cpWrapper.content));
            }
          } catch { /* ignore */ }
          // Re-check heartbeat; stop refreshing when run finishes
          const stillActive = resuming || (await checkHeartbeat());
          if (!stillActive && refreshIntervalRef.current) {
            clearInterval(refreshIntervalRef.current);
            refreshIntervalRef.current = null;
            setRunActive(false);
            // Final full refresh
            void fetchTree();
            void fetchMetadata();
          }
        }, 5000);
      }
    };

    void startRefresh();
    return () => {
      mounted = false;
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId, runPath, resuming]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [resumeLogs]);

  // Load selected file content
  const loadFile = useCallback(
    async (filePath: string) => {
      setSelectedFile(filePath);
      setFileContent(null);
      setFileLoading(true);
      try {
        const res = await api.communityTools.readOutputFile(toolId, filePath);
        if (!res.ok) throw new Error('Failed to read file');
        const wrapper = await res.json();
        setFileContent(wrapper.content);
      } catch {
        setFileContent('Error loading file');
      } finally {
        setFileLoading(false);
      }
    },
    [toolId],
  );

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Stage list for timeline (exclude _v1/_v2 versioned dirs — they show in file tree only)
  const stages = useMemo(() => {
    return tree
      .filter((entry) => isDir(entry) && /^stage-\d+$/.test(entry.name))
      .sort((a, b) => {
        const numA = parseInt(a.name.replace('stage-', ''), 10);
        const numB = parseInt(b.name.replace('stage-', ''), 10);
        return numA - numB;
      })
      .map((entry) => {
        const health = stageHealthMap[entry.name];
        // Extract stage name from stage_id (e.g. "01-topic_init" → "TOPIC_INIT")
        // or from directory name (e.g. "stage-01-topic_init" → "TOPIC_INIT")
        let cliStageName: string | undefined;
        if (health?.stage_id) {
          const parts = health.stage_id.split('-');
          cliStageName = parts.slice(1).join('_').toUpperCase();
        } else {
          const match = entry.name.match(/^stage-\d+-(.+)$/);
          if (match) cliStageName = match[1].toUpperCase();
        }
        return {
          name: entry.name,
          path: entry.path,
          displayName: health?.stage_name || entry.name,
          status: health?.status || 'unknown',
          duration: health?.duration_seconds,
          error: health?.error,
          cliStageName,
        };
      });
  }, [tree, stageHealthMap]);

  const overallStatus = runActive ? 'in-progress' : (checkpoint?.status || (stages.length > 0 ? 'in-progress' : 'unknown'));
  const canResume = !!checkpoint && overallStatus !== 'completed' && overallStatus !== 'done';

  const startResumePolling = useCallback(() => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setResumeLogs([]);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await api.communityTools.status(toolId);
        if (!res.ok) return;
        const data = await res.json();
        const logs: string[] = data.activeOperation?.logs || [];
        setResumeLogs(logs);
        if (!data.activeOperation?.running) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setResuming(false);
          void fetchTree();
          void fetchMetadata();
        }
      } catch { /* ignore polling errors */ }
    }, 2000);
  }, [toolId, fetchTree, fetchMetadata]);

  const handleResume = useCallback(async () => {
    setResuming(true);
    try {
      await api.communityTools.run(toolId, 'run', ['--resume']);
      startResumePolling();
    } catch (err) {
      console.error('Resume failed:', err);
      setResuming(false);
    }
  }, [toolId, startResumePolling]);

  const handleStop = useCallback(async () => {
    try {
      await api.communityTools.stop(toolId);
    } catch (err) {
      console.error('Stop failed:', err);
    }
    // Polling will detect running === false and clean up
  }, [toolId]);

  const handleResumeFromStage = useCallback(async (stageName: string) => {
    setResuming(true);
    try {
      await api.communityTools.run(toolId, 'run', ['--from-stage', stageName]);
      startResumePolling();
    } catch (err) {
      console.error('Resume from stage failed:', err);
      setResuming(false);
    }
  }, [toolId, startResumePolling]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'done':
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-3.5 h-3.5 text-red-500" />;
      case 'running':
      case 'in-progress':
        return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-muted-foreground/50" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
      case 'done':
        return 'bg-green-500';
      case 'failed':
      case 'error':
        return 'bg-red-500';
      case 'running':
      case 'in-progress':
        return 'bg-blue-500';
      default:
        return 'bg-muted-foreground/30';
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const formatStageName = (name: string): string =>
    name.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

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
        </div>
      </div>
    );
  }

  const renderFileIcon = (name: string) => {
    if (name.endsWith('.md')) return <FileText className="w-3.5 h-3.5 text-blue-400" />;
    if (name.endsWith('.json')) return <File className="w-3.5 h-3.5 text-yellow-400" />;
    return <File className="w-3.5 h-3.5 text-muted-foreground/60" />;
  };

  const renderTree = (entries: OutputEntry[], depth = 0) => {
    return entries
      .sort((a, b) => {
        // Directories first, then by name
        if (a.type !== b.type) return isDir(a) ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        const entryIsDir = isDir(entry);
        const isExpanded = expandedDirs.has(entry.path);
        const isSelected = selectedFile === entry.path;

        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => {
                if (entryIsDir) {
                  toggleDir(entry.path);
                } else {
                  void loadFile(entry.path);
                }
              }}
              className={`w-full flex items-center gap-1.5 py-1 px-2 text-xs rounded-md transition-colors ${
                isSelected
                  ? 'bg-accent text-foreground'
                  : 'text-foreground/70 hover:bg-accent/40 hover:text-foreground'
              }`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              {entryIsDir ? (
                <>
                  <ChevronRight
                    className={`w-3 h-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                  {isExpanded ? (
                    <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                  ) : (
                    <Folder className="w-3.5 h-3.5 flex-shrink-0 text-amber-400/70" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3 flex-shrink-0" />
                  {renderFileIcon(entry.name)}
                </>
              )}
              <span className="truncate">{entry.name}</span>
            </button>

            {entryIsDir && isExpanded && entry.children && (
              <div>{renderTree(entry.children, depth + 1)}</div>
            )}
          </div>
        );
      });
  };

  const renderFileContent = () => {
    if (!selectedFile) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground/50 text-sm">
          {t('researchTools.selectFile')}
        </div>
      );
    }

    if (fileLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    const fileName = selectedFile.split('/').pop() || '';
    const isJson = fileName.endsWith('.json');
    const isMd = fileName.endsWith('.md');

    let displayContent = fileContent || '';

    if (isJson) {
      try {
        displayContent = JSON.stringify(JSON.parse(displayContent), null, 2);
      } catch {
        // Use raw content if JSON parsing fails
      }
    }

    return (
      <div className="h-full flex flex-col">
        <div className="flex-shrink-0 px-4 py-2 border-b border-border/50 bg-muted/30">
          <div className="flex items-center gap-2">
            {renderFileIcon(fileName)}
            <span className="text-xs font-mono text-foreground/80 truncate">{fileName}</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {isMd ? (
            <Markdown className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
              {displayContent}
            </Markdown>
          ) : (
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-words">
              {displayContent}
            </pre>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Play className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground truncate font-mono">
              {runName}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              {getStatusIcon(overallStatus)}
              <span className="text-xs text-muted-foreground capitalize">{overallStatus}</span>
              {checkpoint?.last_completed_stage !== undefined && (
                <span className="text-xs text-muted-foreground">
                  &middot; Stage {checkpoint.last_completed_stage}/{checkpoint.total_stages || stages.length}
                </span>
              )}
            </div>
          </div>

          {/* Refresh + Resume + Terminal toggle + Open Overlay */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await fetchTree();
                  await fetchMetadata();
                } finally {
                  setRefreshing(false);
                }
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors disabled:opacity-50"
              title="Refresh stages & files"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            {resuming ? (
              <button
                type="button"
                onClick={handleStop}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                title="Stop running process"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            ) : canResume ? (
              <button
                type="button"
                onClick={handleResume}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                title="Resume run from last checkpoint"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Resume</span>
              </button>
            ) : null}
            {terminalCommand && (
              <button
                type="button"
                onClick={() => setTerminalVisible((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                  terminalVisible
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
                title={terminalVisible ? t('researchTools.hideTerminal') : t('researchTools.showTerminal')}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>{terminalVisible ? t('researchTools.hideTerminal') : t('researchTools.showTerminal')}</span>
              </button>
            )}
            {onOpenTerminal && terminalCommand && (
              <button
                type="button"
                onClick={() => onOpenTerminal({
                  toolId,
                  toolName: toolId,
                  installDir: installDir || '',
                  setupDir: setupDir || '',
                })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
                title={t('researchTools.openTerminal')}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stage Timeline */}
      {stages.length > 0 && (
        <div className="flex-shrink-0 px-6 py-3 border-b border-border/50 bg-muted/20 max-h-32 overflow-y-auto">
          <div className="flex items-center gap-1 flex-wrap">
            {stages.map((stage, idx) => {
              const isIncomplete = stage.status !== 'completed' && stage.status !== 'done';
              const canContinueFromHere = canResume && isIncomplete && stage.cliStageName && !resuming;
              return (
                <div key={stage.name} className="flex items-center flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (canContinueFromHere) {
                        void handleResumeFromStage(stage.cliStageName!);
                      } else {
                        setExpandedDirs((prev) => new Set([...prev, stage.path]));
                      }
                    }}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors group ${
                      canContinueFromHere
                        ? 'hover:bg-primary/10 hover:ring-1 hover:ring-primary/30'
                        : 'hover:bg-accent/60'
                    }`}
                    title={
                      canContinueFromHere
                        ? `Continue from ${stage.displayName}`
                        : `${stage.displayName}${stage.duration ? ` (${formatDuration(stage.duration)})` : ''}`
                    }
                  >
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(stage.status)}`} />
                    <span className="text-foreground/70 group-hover:text-foreground whitespace-nowrap text-[10px]">
                      {idx + 1}. {formatStageName(stage.cliStageName || stage.name.replace(/^stage-\d+-/, ''))}
                    </span>
                  </button>
                  {idx < stages.length - 1 && (
                    <div className="w-3 h-px bg-border/60 flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Split: File tree + Preview + Terminal */}
      <div ref={containerRef} className="flex-1 flex min-h-0 overflow-hidden">
        {/* File tree */}
        <div className="w-56 flex-shrink-0 border-r border-border/50 overflow-y-auto py-1">
          {renderTree(tree)}
        </div>

        {/* File preview / Resume logs */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {resuming || (resumeLogs.length > 0 && !selectedFile) ? (
            <div className="h-full flex flex-col">
              <div className="flex-shrink-0 px-4 py-2 border-b border-border/50 bg-muted/30">
                <div className="flex items-center gap-2">
                  {resuming && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
                  {!resuming && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                  <span className="text-xs font-mono text-foreground/80">
                    {resuming ? 'Running...' : 'Process finished'}
                  </span>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-gray-950 p-4">
                <pre className="text-xs font-mono text-green-400/90 whitespace-pre-wrap break-words">
                  {resumeLogs.length > 0 ? resumeLogs.join('') : 'Waiting for output...'}
                </pre>
                <div ref={logsEndRef} />
              </div>
            </div>
          ) : (
            renderFileContent()
          )}
        </div>

        {/* Terminal drag handle */}
        {terminalCommand && terminalVisible && (
          <div
            className="w-1 flex-shrink-0 cursor-col-resize bg-border/50 hover:bg-primary/50 transition-colors"
            onMouseDown={handleTerminalResizeStart}
          />
        )}

        {/* Embedded terminal — CSS visibility toggle to keep WebSocket alive */}
        {terminalCommand && (
          <div
            className={`flex-shrink-0 border-l border-border/50 bg-gray-900 ${
              terminalVisible ? '' : 'w-0 overflow-hidden'
            }`}
            style={terminalVisible ? { width: terminalWidth } : undefined}
          >
            <div className="h-full min-w-[200px]">
              <AnyStandaloneShell
                project={{
                  name: `research-run-${toolId}`,
                  displayName: `${toolId} terminal`,
                  fullPath: setupDir || installDir || '',
                }}
                command={terminalCommand}
                isPlainShell={true}
                shellInstanceId={shellId}
                autoConnect={true}
                minimal={true}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
