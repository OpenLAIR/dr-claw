export type GpuInfo = {
  index: number;
  name: string;
  gpuUtil: number;
  memUtil: number;
  memUsedMB: number;
  memTotalMB: number;
  tempC: number;
  powerW: number;
};

export type CpuInfo = {
  cores: number;
  model?: string;
  loadAvg: number;
  utilPercent: number;
  memTotalMB: number;
  memUsedMB: number;
  memUtilPercent: number;
};

export type MonitorData = {
  success: boolean;
  gpus: GpuInfo[];
  cpu: CpuInfo | null;
  error?: string;
  timestamp: number;
};

export type LocalMonitorData = MonitorData & {
  hostname?: string;
  platform?: string;
};

export type SlurmConfig = {
  defaultPartition?: string;
  defaultTime?: string;
  defaultGpus?: number;
  defaultAccount?: string;
};

export type ComputeNode = {
  id: string;
  name: string;
  host: string;
  user: string;
  port?: number;
  type: string;
  hasPassword?: boolean;
  keyPath?: string;
  workDir?: string;
  slurm?: SlurmConfig;
};

export type NodeWithMonitor = {
  node: ComputeNode;
  monitor: MonitorData | null;
  loading: boolean;
  isActive: boolean;
};

export type NodeFormData = {
  name: string;
  host: string;
  user: string;
  port: string;
  authType: 'agent' | 'key' | 'password';
  key: string;
  password: string;
  workDir: string;
  type: 'direct' | 'slurm';
  slurmPartition: string;
  slurmTime: string;
  slurmGpus: string;
  slurmAccount: string;
};

export const defaultFormData: NodeFormData = {
  name: '',
  host: '',
  user: '',
  port: '22',
  authType: 'agent',
  key: '',
  password: '',
  workDir: '~',
  type: 'direct',
  slurmPartition: '',
  slurmTime: '00:30:00',
  slurmGpus: '1',
  slurmAccount: '',
};

export type SimpleProject = {
  name: string;
  path: string;
  fullPath?: string;
  displayName?: string;
};
