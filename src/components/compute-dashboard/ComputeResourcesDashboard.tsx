import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Monitor,
  Cpu,
  MemoryStick,
  Thermometer,
  Zap,
  RefreshCw,
  Server,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Laptop,
} from 'lucide-react';
import { Button } from '../ui/button';
import { api } from '../../utils/api';

type GpuInfo = {
  index: number;
  name: string;
  gpuUtil: number;
  memUtil: number;
  memUsedMB: number;
  memTotalMB: number;
  tempC: number;
  powerW: number;
};

type CpuInfo = {
  cores: number;
  model?: string;
  loadAvg: number;
  utilPercent: number;
  memTotalMB: number;
  memUsedMB: number;
  memUtilPercent: number;
};

type MonitorData = {
  success: boolean;
  gpus: GpuInfo[];
  cpu: CpuInfo | null;
  error?: string;
  timestamp: number;
};

type LocalMonitorData = MonitorData & {
  hostname?: string;
  platform?: string;
};

type ComputeNode = {
  id: string;
  name: string;
  host: string;
  user: string;
  port?: number;
  type: string;
  hasPassword?: boolean;
  workDir?: string;
};

type NodeWithMonitor = {
  node: ComputeNode;
  monitor: MonitorData | null;
  loading: boolean;
  isActive: boolean;
};

const POLL_INTERVAL_MS = 15_000;

function UtilBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-2 rounded-full bg-muted/60 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function utilColor(percent: number): string {
  if (percent < 40) return 'bg-emerald-500';
  if (percent < 70) return 'bg-amber-500';
  return 'bg-red-500';
}

function utilTextColor(percent: number): string {
  if (percent < 40) return 'text-emerald-600 dark:text-emerald-400';
  if (percent < 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function GpuCard({ gpu }: { gpu: GpuInfo }) {
  const inUse = gpu.gpuUtil > 5 || gpu.memUtil > 5;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">GPU {gpu.index}</span>
        </div>
        <StatusBadge active={inUse} />
      </div>

      <p className="text-xs text-muted-foreground truncate">{gpu.name}</p>

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">GPU Utilization</span>
            <span className={`text-xs font-semibold ${utilTextColor(gpu.gpuUtil)}`}>
              {gpu.gpuUtil}%
            </span>
          </div>
          <UtilBar percent={gpu.gpuUtil} color={utilColor(gpu.gpuUtil)} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">VRAM</span>
            <span className="text-xs text-muted-foreground">
              {formatMB(gpu.memUsedMB)} / {formatMB(gpu.memTotalMB)}
            </span>
          </div>
          <UtilBar percent={gpu.memUtil} color={utilColor(gpu.memUtil)} />
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
        <span className="flex items-center gap-1">
          <Thermometer className="h-3 w-3" />
          {gpu.tempC}°C
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          {gpu.powerW > 0 ? `${gpu.powerW} W` : 'N/A'}
        </span>
      </div>
    </div>
  );
}

function CpuCard({ cpu }: { cpu: CpuInfo }) {
  const inUse = cpu.utilPercent > 10;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">CPU</span>
          <span className="text-xs text-muted-foreground">({cpu.cores} cores)</span>
        </div>
        <StatusBadge active={inUse} />
      </div>

      {cpu.model && (
        <p className="text-xs text-muted-foreground truncate">{cpu.model}</p>
      )}

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">CPU Load</span>
            <span className={`text-xs font-semibold ${utilTextColor(cpu.utilPercent)}`}>
              {cpu.utilPercent}%
            </span>
          </div>
          <UtilBar percent={cpu.utilPercent} color={utilColor(cpu.utilPercent)} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MemoryStick className="h-3 w-3" />
              System Memory
            </span>
            <span className="text-xs text-muted-foreground">
              {formatMB(cpu.memUsedMB)} / {formatMB(cpu.memTotalMB)}
            </span>
          </div>
          <UtilBar percent={cpu.memUtilPercent} color={utilColor(cpu.memUtilPercent)} />
        </div>
      </div>

      <div className="text-xs text-muted-foreground pt-1">
        Load average: {cpu.loadAvg.toFixed(2)}
      </div>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        active
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {active ? 'In Use' : 'Idle'}
    </span>
  );
}

function ResourceCards({ monitor }: { monitor: MonitorData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {monitor.cpu && <CpuCard cpu={monitor.cpu} />}
      {monitor.gpus.map((gpu) => (
        <GpuCard key={gpu.index} gpu={gpu} />
      ))}
    </div>
  );
}

function NodeSection({ data }: { data: NodeWithMonitor }) {
  const { node, monitor, loading, isActive } = data;
  const hasData = monitor?.success && (monitor.gpus.length > 0 || monitor.cpu);

  return (
    <div className="space-y-4">
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
            Active
          </span>
        )}
        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {node.type === 'slurm' ? 'Slurm HPC' : 'Direct GPU'}
        </span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {monitor && !monitor.success && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{monitor.error || 'Failed to connect'}</span>
        </div>
      )}

      {hasData && <ResourceCards monitor={monitor!} />}

      {!loading && !hasData && monitor?.success && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>Connected — no GPU detected on this node</span>
        </div>
      )}
    </div>
  );
}

export default function ComputeResourcesDashboard() {
  const [localData, setLocalData] = useState<LocalMonitorData | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [nodesData, setNodesData] = useState<NodeWithMonitor[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLocalMonitor = useCallback(async () => {
    try {
      const resp = await api.compute.monitorLocal();
      return (await resp.json()) as LocalMonitorData;
    } catch {
      return { success: false, gpus: [], cpu: null, error: 'Network error', timestamp: Date.now() } as LocalMonitorData;
    }
  }, []);

  const fetchNodes = useCallback(async () => {
    try {
      const resp = await api.compute.getNodes();
      const data = (await resp.json()) as { nodes: ComputeNode[]; activeNodeId?: string };
      return { nodes: data.nodes || [], activeNodeId: data.activeNodeId };
    } catch {
      return { nodes: [], activeNodeId: undefined };
    }
  }, []);

  const monitorNode = useCallback(async (nodeId: string): Promise<MonitorData | null> => {
    try {
      const resp = await api.compute.monitorNode(nodeId);
      return (await resp.json()) as MonitorData;
    } catch {
      return { success: false, gpus: [], cpu: null, error: 'Network error', timestamp: Date.now() };
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    setLocalLoading(true);
    try {
      const [localResult, { nodes, activeNodeId }] = await Promise.all([
        fetchLocalMonitor(),
        fetchNodes(),
      ]);

      setLocalData(localResult);
      setLocalLoading(false);

      if (nodes.length > 0) {
        setNodesData((prev) =>
          nodes.map((node) => ({
            node,
            monitor: prev.find((d) => d.node.id === node.id)?.monitor ?? null,
            loading: true,
            isActive: node.id === activeNodeId,
          })),
        );

        const results = await Promise.allSettled(
          nodes.map(async (node) => {
            const monitor = await monitorNode(node.id);
            return { nodeId: node.id, monitor };
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
            return { ...item, loading: false };
          }),
        );
      } else {
        setNodesData([]);
      }
    } finally {
      setIsRefreshing(false);
      setInitialLoad(false);
    }
  }, [fetchLocalMonitor, fetchNodes, monitorNode]);

  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;

  useEffect(() => {
    void refreshAllRef.current();
    pollRef.current = setInterval(() => {
      void refreshAllRef.current();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Aggregate stats across local + remote
  const allMonitors = [
    localData,
    ...nodesData.map((d) => d.monitor),
  ].filter((m): m is MonitorData => !!m && m.success);

  const totalGpus = allMonitors.reduce((n, m) => n + m.gpus.length, 0);
  const activeGpus = allMonitors.reduce(
    (n, m) => n + m.gpus.filter((g) => g.gpuUtil > 5 || g.memUtil > 5).length,
    0,
  );
  const totalCpuCores = allMonitors.reduce((n, m) => n + (m.cpu?.cores ?? 0), 0);
  const cpuMonitors = allMonitors.filter((m) => m.cpu);
  const avgCpuUtil =
    cpuMonitors.length > 0
      ? Math.round(cpuMonitors.reduce((s, m) => s + m.cpu!.utilPercent, 0) / cpuMonitors.length)
      : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Compute Resources</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor GPU and CPU usage across your compute nodes
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => void refreshAllRef.current()}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {initialLoad ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading compute resources...
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard
                label="Nodes"
                value={1 + nodesData.length}
                sublabel={nodesData.length > 0 ? `(1 local + ${nodesData.length} remote)` : '(local)'}
              />
              <SummaryCard
                label="GPUs"
                value={totalGpus > 0 ? `${activeGpus} / ${totalGpus}` : '0'}
                sublabel={totalGpus > 0 ? 'in use' : 'detected'}
              />
              <SummaryCard label="CPU Cores" value={totalCpuCores} />
              <SummaryCard label="Avg CPU Load" value={`${avgCpuUtil}%`} />
            </div>

            {/* Local machine */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-base font-semibold">
                    {localData?.hostname || 'Local Machine'}
                  </h3>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">
                  This Machine
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
                  <span>{localData.error || 'Failed to read local stats'}</span>
                </div>
              )}

              {localData?.success && (localData.cpu || localData.gpus.length > 0) && (
                <ResourceCards monitor={localData} />
              )}

              {localData?.success && !localData.cpu && localData.gpus.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>No GPU detected on this machine</span>
                </div>
              )}
            </div>

            {/* Remote nodes */}
            {nodesData.length > 0 && (
              <>
                <div className="border-t pt-4">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                    Remote Nodes
                  </h2>
                </div>
                <div className="space-y-6">
                  {nodesData.map((data) => (
                    <NodeSection key={data.node.id} data={data} />
                  ))}
                </div>
              </>
            )}

            {/* Timestamp */}
            <p className="text-xs text-muted-foreground text-center pt-2">
              Auto-refreshes every {POLL_INTERVAL_MS / 1000}s
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold">
        {value}
        {sublabel && (
          <span className="text-xs font-normal text-muted-foreground ml-1">{sublabel}</span>
        )}
      </p>
    </div>
  );
}
