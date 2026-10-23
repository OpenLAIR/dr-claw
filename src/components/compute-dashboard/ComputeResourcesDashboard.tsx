import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  RefreshCw,
  Laptop,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  Server,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { api } from '../../utils/api';
import useLocalStorage from '../../hooks/useLocalStorage';
import { ResourceCards, SummaryCard } from './ResourceCards';
import NodeCard from './NodeCard';
import NodeForm from './NodeForm';
import type { LocalMonitorData, MonitorData, ComputeNode, NodeWithMonitor } from './types';

const POLL_INTERVAL_MS = 15_000;

type LocaleKey = 'en' | 'zh' | 'ko';

function resolveLocaleKey(lang: string): LocaleKey {
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}



export default function ComputeResourcesDashboard() {
  const { i18n, t: tr } = useTranslation('common');
  const locale = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const t = useMemo(() => tr('computeGuide', { returnObjects: true }) as Record<string, string>, [tr, i18n.language]);

  const [guideCollapsed, setGuideCollapsed] = useLocalStorage('compute-node-guide-collapsed', true);
  const [guideDismissed, setGuideDismissed] = useLocalStorage('compute-node-guide-dismissed', false);

  // ─── State ───
  const [localData, setLocalData] = useState<LocalMonitorData | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [nodesData, setNodesData] = useState<NodeWithMonitor[]>([]);
  const [connectedNodeIds, setConnectedNodeIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [nodesLoadError, setNodesLoadError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Data fetchers ───

  const fetchLocalMonitor = useCallback(async () => {
    try {
      const resp = await api.compute.monitorLocal();
      if (!resp.ok) throw new Error('monitor unavailable');
      return (await resp.json()) as LocalMonitorData;
    } catch {
      return { success: false, gpus: [], cpu: null, error: 'Network error', timestamp: Date.now() } as LocalMonitorData;
    }
  }, []);

  const fetchNodes = useCallback(async () => {
    try {
      const resp = await api.compute.getNodes();
      if (!resp.ok) throw new Error('nodes unavailable');
      const data = (await resp.json()) as { nodes: ComputeNode[]; activeNodeId?: string };
      setNodesLoadError(false);
      return { nodes: data.nodes || [], activeNodeId: data.activeNodeId };
    } catch {
      setNodesLoadError(true);
      return { nodes: null, activeNodeId: undefined };
    }
  }, []);

  const monitorNode = useCallback(async (nodeId: string): Promise<MonitorData> => {
    try {
      const resp = await api.compute.monitorNode(nodeId);
      return (await resp.json()) as MonitorData;
    } catch {
      return { success: false, gpus: [], cpu: null, error: 'Network error', timestamp: Date.now() };
    }
  }, []);

  // ─── Initial load (no auto-connect) ───

  const loadInitial = useCallback(async () => {
    setLocalLoading(true);
    const [localResult, { nodes, activeNodeId }] = await Promise.all([
      fetchLocalMonitor(),
      fetchNodes(),
    ]);
    setLocalData(localResult);
    setLocalLoading(false);
    setNodesData(
      (nodes || []).map((node) => ({
        node,
        monitor: null,
        loading: false,
        isActive: node.id === activeNodeId,
      })),
    );
    setInitialLoad(false);
  }, [fetchLocalMonitor, fetchNodes]);

  // ─── Poll only connected nodes + local ───

  const pollConnected = useCallback(async () => {
    const localResult = await fetchLocalMonitor();
    setLocalData(localResult);

    if (connectedNodeIds.size > 0) {
      const results = await Promise.allSettled(
        Array.from(connectedNodeIds).map(async (nodeId) => {
          const monitor = await monitorNode(nodeId);
          return { nodeId, monitor };
        }),
      );
      setNodesData((prev) =>
        prev.map((item) => {
          const result = results.find(
            (r) => r.status === 'fulfilled' && r.value.nodeId === item.node.id,
          );
          if (result?.status === 'fulfilled') {
            return { ...item, monitor: result.value.monitor, loading: false };
          }
          return item;
        }),
      );
    }
  }, [connectedNodeIds, fetchLocalMonitor, monitorNode]);

  // ─── Connect / Disconnect ───

  const connectNode = useCallback(
    async (nodeId: string) => {
      setConnectedNodeIds((prev) => new Set(prev).add(nodeId));
      setNodesData((prev) =>
        prev.map((item) =>
          item.node.id === nodeId ? { ...item, loading: true } : item,
        ),
      );
      const monitor = await monitorNode(nodeId);
      setNodesData((prev) =>
        prev.map((item) =>
          item.node.id === nodeId ? { ...item, monitor, loading: false } : item,
        ),
      );
    },
    [monitorNode],
  );

  const disconnectNode = useCallback((nodeId: string) => {
    setConnectedNodeIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    setNodesData((prev) =>
      prev.map((item) =>
        item.node.id === nodeId ? { ...item, monitor: null, loading: false } : item,
      ),
    );
  }, []);

  // ─── Node CRUD ───

  const reloadNodes = useCallback(async () => {
    const { nodes, activeNodeId } = await fetchNodes();
    if (!nodes) return;
    setNodesData((prev) =>
      nodes.map((node) => {
        const existing = prev.find((d) => d.node.id === node.id);
        return {
          node,
          monitor: connectedNodeIds.has(node.id) ? (existing?.monitor ?? null) : null,
          loading: false,
          isActive: node.id === activeNodeId,
        };
      }),
    );
  }, [fetchNodes, connectedNodeIds]);

  const handleSetActive = useCallback(
    async (nodeId: string) => {
      setActionError(false);
      try {
        const response = await api.compute.setActive(nodeId);
        if (!response.ok) throw new Error('update failed');
        await reloadNodes();
      } catch { setActionError(true); }
    },
    [reloadNodes],
  );

  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      setActionError(false);
      try {
        const response = await api.compute.deleteNode(nodeId);
        if (!response.ok) throw new Error('delete failed');
      } catch {
        setActionError(true);
        return;
      }
      setConnectedNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
      setNodesData((prev) => prev.filter((item) => item.node.id !== nodeId));
    },
    [],
  );

  // ─── Refresh (manual) ───

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setLocalLoading(true);
    try {
      const localResult = await fetchLocalMonitor();
      setLocalData(localResult);
      setLocalLoading(false);
      await reloadNodes();
      // Re-poll connected nodes
      if (connectedNodeIds.size > 0) {
        const results = await Promise.allSettled(
          Array.from(connectedNodeIds).map(async (id) => {
            const monitor = await monitorNode(id);
            return { nodeId: id, monitor };
          }),
        );
        setNodesData((prev) =>
          prev.map((item) => {
            const result = results.find(
              (r) => r.status === 'fulfilled' && r.value.nodeId === item.node.id,
            );
            if (result?.status === 'fulfilled') {
              return { ...item, monitor: result.value.monitor };
            }
            return item;
          }),
        );
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [connectedNodeIds, fetchLocalMonitor, monitorNode, reloadNodes]);

  // ─── Effects ───

  const loadInitialRef = useRef(loadInitial);
  loadInitialRef.current = loadInitial;

  useEffect(() => {
    void loadInitialRef.current();
  }, []);

  const pollConnectedRef = useRef(pollConnected);
  pollConnectedRef.current = pollConnected;

  useEffect(() => {
    if (initialLoad) return;
    pollRef.current = setInterval(() => {
      void pollConnectedRef.current();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connectedNodeIds, initialLoad]);

  // ─── Aggregated stats ───

  const allMonitors = [
    localData,
    ...nodesData.filter((d) => connectedNodeIds.has(d.node.id)).map((d) => d.monitor),
  ].filter((m): m is MonitorData => !!m && m.success);

  const totalGpus = allMonitors.reduce((n, m) => n + (m.gpus || []).length, 0);
  const activeGpus = allMonitors.reduce(
    (n, m) => n + (m.gpus || []).filter((g) => g.gpuUtil > 5 || g.memUtil > 5).length,
    0,
  );
  const cpuMonitors = allMonitors.filter((m) => m.cpu);
  const coresKnown = cpuMonitors.length > 0 && cpuMonitors.every(m => Number.isFinite(m.cpu?.cores));
  const loadKnown = cpuMonitors.length > 0 && cpuMonitors.every(m => Number.isFinite(m.cpu?.utilPercent));
  const gpuStatusKnown = allMonitors.every(m => (m.gpus || []).every(g => Number.isFinite(g.gpuUtil) && Number.isFinite(g.memUtil)));
  const totalCpuCores = coresKnown ? cpuMonitors.reduce((n, m) => n + m.cpu!.cores, 0) : null;
  const avgCpuUtil = loadKnown ? Math.round(cpuMonitors.reduce((sum, m) => sum + m.cpu!.utilPercent, 0) / cpuMonitors.length) : null;

  const connectedCount = connectedNodeIds.size;

  // ─── Render ───

  return (
    <div className="h-full overflow-y-auto">
      <div className="workbench-page space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{tr('computeUI.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {tr('computeUI.description')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => setShowAddForm(true)}
              disabled={showAddForm}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {tr('computeForm.add')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              {tr('buttons.refresh')}
            </Button>
          </div>
        </div>

        {/* Usage guide */}
        {!guideDismissed && (
          <div className="rounded-lg border border-border p-4">

            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex shrink-0 items-center justify-center py-1 text-muted-foreground">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-sky-100">
                    {t.guideTitle}
                  </h3>
                  {!guideCollapsed ? (
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-sky-100/85">
                      {t.guideDesc}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-600 dark:text-sky-100/70">
                      {tr('computeMetrics.guideHidden')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-700 hover:bg-sky-100/60 hover:text-slate-900 dark:text-sky-100/80 dark:hover:bg-sky-900/30 dark:hover:text-sky-100"
                  onClick={() => setGuideCollapsed(!guideCollapsed)}
                >
                  {guideCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  {guideCollapsed ? t.guideExpand : t.guideCollapse}
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-700 hover:bg-sky-100/60 hover:text-slate-900 dark:text-sky-100/80 dark:hover:bg-sky-900/30 dark:hover:text-sky-100"
                  onClick={() => setGuideDismissed(true)}
                >
                  <X className="h-4 w-4" />
                  {t.guideDismiss}
                </button>
              </div>
            </div>
            {!guideCollapsed && (
              <div className="relative mt-4 space-y-3 sm:pl-8">
                <ol className="list-decimal pl-4 space-y-1.5 text-sm text-slate-700 dark:text-sky-100/85">
                  {(['guideStep1', 'guideStep2', 'guideStep3', 'guideStep4', 'guideStep5'] as const).map((key) => (
                    <li key={key}>{t[key]}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {(nodesLoadError || actionError) && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4 text-sm">
          <span>{tr(nodesLoadError ? 'workbench.computeNodesFailed' : 'workbench.computeActionFailed')}</span>
          {nodesLoadError && <Button variant="outline" size="sm" onClick={() => void reloadNodes()}>{tr('buttons.retry')}</Button>}
        </div>}
        {initialLoad ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            {tr('computeUI.loading')}
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 border-y border-border py-4 md:grid-cols-4">
              <SummaryCard
                label={tr('computeMetrics.nodes')}
                value={nodesLoadError ? '—' : 1 + nodesData.length}
                sublabel={
                  nodesData.length > 0
                    ? tr('computeMetrics.nodeCounts', { remote: nodesData.length, connected: connectedCount })
                    : tr('computeMetrics.local')
                }
              />
              <SummaryCard
                label="GPUs"
                value={!allMonitors.length ? '—' : totalGpus > 0 ? `${gpuStatusKnown ? activeGpus : '—'} / ${totalGpus}` : '0'}
                sublabel={tr(totalGpus > 0 ? 'computeMetrics.inUse' : 'computeMetrics.detected')}
              />
              <SummaryCard label={tr('computeMetrics.cpuCores')} value={totalCpuCores ?? '—'} />
              <SummaryCard label={tr('computeMetrics.avgCpu')} value={avgCpuUtil === null ? '—' : `${avgCpuUtil}%`} />
            </div>

            {/* Local machine */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-base font-semibold">
                    {localData?.hostname || tr('computeMetrics.machine')}
                  </h3>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">
                  {tr('computeUI.local')}
                </span>
                {localData?.platform && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {localData.platform === 'darwin' ? 'macOS' : localData.platform === 'win32' ? 'Windows' : 'Linux'}
                  </span>
                )}
                {localLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>

              {localData && !localData.success && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{tr('computeMetrics.loadFailed')}</span>
                </div>
              )}

              {localData?.success && (localData.cpu || (localData.gpus || []).length > 0) && (
                <ResourceCards monitor={localData} />
              )}

              {localData?.success && !localData.cpu && (localData.gpus || []).length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>{tr('computeUI.noGpu')}</span>
                </div>
              )}
            </div>

            {/* Remote nodes */}
            <div className="border-t pt-4">
              <h2 className="text-sm font-medium text-muted-foreground mb-4">
                {tr('computeUI.remote')}
                {nodesData.length > 0 && (
                  <span className="font-normal ml-2">
                    {tr('computeUI.connectedCount', { connected: connectedCount, total: nodesData.length })}
                  </span>
                )}
              </h2>
            </div>

            {/* Add node form */}
            {showAddForm && (
              <NodeForm
                onSave={() => { setShowAddForm(false); void reloadNodes(); }}
                onCancel={() => setShowAddForm(false)}
              />
            )}

            {/* Node cards */}
            {nodesData.length > 0 ? (
              <div className="space-y-4">
                {nodesData.map((data) => (
                  <NodeCard
                    key={data.node.id}
                    data={data}
                    isConnected={connectedNodeIds.has(data.node.id)}
                    onConnect={() => void connectNode(data.node.id)}
                    onDisconnect={() => disconnectNode(data.node.id)}
                    onDelete={() => void handleDeleteNode(data.node.id)}
                    onNodeUpdated={() => void reloadNodes()}
                    onSetActive={() => void handleSetActive(data.node.id)}
                  />
                ))}
              </div>
            ) : (
              !showAddForm && !nodesLoadError && (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Server className="h-8 w-8 mb-3 opacity-40" />
                  <p className="text-sm">{tr('computeUI.empty')}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg mt-3"
                    onClick={() => setShowAddForm(true)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    {tr('computeUI.first')}
                  </Button>
                </div>
              )
            )}

            {/* Timestamp */}
            {connectedCount > 0 && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                {tr('computeUI.poll', { seconds: POLL_INTERVAL_MS / 1000 })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
