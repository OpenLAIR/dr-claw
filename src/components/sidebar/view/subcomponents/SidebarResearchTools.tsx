import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Folder,
  Loader2,
  Settings,
  Trash2,
} from 'lucide-react';
import { api } from '../../../../utils/api';
import type { AppTab } from '../../../../types/app';

type RegistryTool = {
  id: string;
  name: string;
  type: string;
};

type InstalledInfo = {
  installDir: string;
  setupDir?: string;
};

type OutputEntry = {
  name: string;
  path: string;
  type: 'dir' | 'directory' | 'file';
  children?: OutputEntry[];
};

type RunInfo = {
  name: string;
  path: string;
  stageCount: number;
  isActive: boolean;
};

type SidebarResearchToolsProps = {
  activeTab: AppTab;
  selectedRunPath: string | null;
  onSelectRun: (toolId: string, runPath: string) => void;
  onDeleteRun?: (toolId: string, runPath: string) => Promise<void>;
  onOpenConfig: () => void;
  onStartRun: (toolId: string) => void;
};

const COLLAPSE_KEY = 'sidebar-research-tools-collapsed';

export default function SidebarResearchTools({
  activeTab,
  selectedRunPath,
  onSelectRun,
  onDeleteRun,
  onOpenConfig,
  onStartRun,
}: SidebarResearchToolsProps) {
  const { t } = useTranslation('common');
  const [tools, setTools] = useState<RegistryTool[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [toolRuns, setToolRuns] = useState<Record<string, RunInfo[]>>({});
  const [runsLoading, setRunsLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === 'true'; } catch { return false; }
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  // Fetch installed python-app tools
  const fetchTools = useCallback(async () => {
    try {
      setLoading(true);
      const [regRes, instRes] = await Promise.all([
        api.communityTools.registry(),
        api.communityTools.installed(),
      ]);
      if (!regRes.ok || !instRes.ok) return;

      const regData = await regRes.json();
      const instData = await instRes.json();
      const allTools: RegistryTool[] = regData.tools || [];
      const installedTools: Record<string, InstalledInfo> = instData.tools || {};

      const researchTools = allTools.filter(
        (tool) => tool.type === 'python-app' && installedTools[tool.id],
      );

      setTools(researchTools);

      // Auto-expand all tools so runs are immediately visible
      setExpandedTools(new Set(researchTools.map((t) => t.id)));
    } catch (err) {
      console.error('Error fetching research tools:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch runs for a specific tool
  const fetchToolRuns = useCallback(async (toolId: string) => {
    setRunsLoading((prev) => ({ ...prev, [toolId]: true }));
    try {
      const res = await api.communityTools.outputs(toolId);
      if (!res.ok) return;

      const data = await res.json();
      const tree: OutputEntry[] = data.tree || [];

      const artifactsDir = tree.find(
        (entry) => entry.name === 'artifacts' && (entry.type === 'dir' || entry.type === 'directory'),
      );
      const runEntries = artifactsDir?.children || [];

      const now = Date.now();
      const runDirs = runEntries.filter(
        (entry) => entry.type === 'dir' || entry.type === 'directory',
      );

      // Check heartbeat for each run to detect active ones
      const runInfos: RunInfo[] = await Promise.all(
        runDirs.map(async (entry) => {
          let isActive = false;
          try {
            const hbRes = await api.communityTools.readOutputFile(
              toolId,
              `${entry.path}/heartbeat.json`,
            );
            if (hbRes.ok) {
              const wrapper = await hbRes.json();
              const hb = JSON.parse(wrapper.content);
              const ts = new Date(hb.timestamp).getTime();
              isActive = now - ts < 60_000;
            }
          } catch { /* ignore */ }
          return {
            name: entry.name,
            path: entry.path,
            stageCount: (entry.children || []).filter(
              (child) =>
                (child.type === 'dir' || child.type === 'directory') &&
                child.name.startsWith('stage-'),
            ).length,
            isActive,
          };
        }),
      );

      // Active runs first, then by name descending
      runInfos.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.name.localeCompare(a.name);
      });

      setToolRuns((prev) => ({ ...prev, [toolId]: runInfos }));
    } catch (err) {
      console.error('Error fetching runs:', err);
    } finally {
      setRunsLoading((prev) => ({ ...prev, [toolId]: false }));
    }
  }, []);

  useEffect(() => {
    void fetchTools();
  }, [fetchTools]);

  // Fetch runs when a tool is expanded
  useEffect(() => {
    for (const toolId of expandedTools) {
      if (!toolRuns[toolId] && !runsLoading[toolId]) {
        void fetchToolRuns(toolId);
      }
    }
  }, [expandedTools, toolRuns, runsLoading, fetchToolRuns]);

  const toggleTool = useCallback((toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{t('researchTools.sectionTitle')}</span>
        </div>
      </div>
    );
  }

  if (tools.length === 0) {
    return null;
  }

  return (
    <div className="px-1.5 py-1">
      {/* Section header — clickable to collapse */}
      <div className="flex items-center justify-between px-2 py-1">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          {t('researchTools.sectionTitle')}
        </button>
        <button
          type="button"
          onClick={onOpenConfig}
          className="p-0.5 rounded hover:bg-accent/80 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          title={t('researchTools.configure')}
        >
          <Settings className="w-3 h-3" />
        </button>
      </div>

      {collapsed ? null : (
        <div className="space-y-0.5">
          {tools.map((tool) => {
            const isExpanded = expandedTools.has(tool.id);
            const runs = toolRuns[tool.id] || [];
            const isToolRunsLoading = runsLoading[tool.id];

            return (
              <div key={tool.id}>
                {/* Tool row — click to expand/collapse */}
                <div className="flex items-center group">
                  <button
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    className="flex-1 flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg hover:bg-accent/40 transition-colors min-w-0"
                  >
                    <ChevronRight
                      className={`w-3 h-3 flex-shrink-0 text-muted-foreground/60 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                    <FlaskConical className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
                    <span className="flex-1 text-left truncate text-foreground/80">
                      {tool.name}
                    </span>
                  </button>
                </div>

                {/* Runs list under this tool */}
                {isExpanded && (
                  <div className="ml-3 space-y-0.5">
                    {isToolRunsLoading ? (
                      <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" />
                      </div>
                    ) : runs.length === 0 ? (
                      <div className="px-3 py-1 text-[11px] text-muted-foreground/60">
                        {t('researchTools.noRuns')}
                      </div>
                    ) : (
                      runs.map((run) => {
                        const isSelected = activeTab === 'research-run' && selectedRunPath === run.path;

                        return (
                          <div key={run.path} className="flex items-center group/run">
                            <button
                              type="button"
                              onClick={() => onSelectRun(tool.id, run.path)}
                              className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                                isSelected
                                  ? 'bg-accent text-foreground'
                                  : 'text-foreground/70 hover:bg-accent/40 hover:text-foreground'
                              }`}
                            >
                              {run.isActive ? (
                                <Loader2 className="w-3.5 h-3.5 flex-shrink-0 text-blue-500 animate-spin" />
                              ) : (
                                <Folder className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/70" />
                              )}
                              <span className="flex-1 text-left truncate font-mono text-[11px]">
                                {run.name}
                              </span>
                              <span className={`text-[10px] flex-shrink-0 ${run.isActive ? 'text-blue-500 font-medium' : 'text-muted-foreground/50'}`}>
                                {run.stageCount} {t('researchTools.stages')}
                                {run.isActive && ' · Running'}
                              </span>
                            </button>
                            {onDeleteRun && (
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const confirmed = window.confirm(
                                    t('researchTools.confirmDeleteRun', { name: run.name }),
                                  );
                                  if (!confirmed) return;
                                  try {
                                    await onDeleteRun(tool.id, run.path);
                                    void fetchToolRuns(tool.id);
                                  } catch (err) {
                                    console.error('Delete run failed:', err);
                                  }
                                }}
                                className="p-1 rounded opacity-0 group-hover/run:opacity-100 hover:bg-destructive/20 text-muted-foreground/50 hover:text-destructive transition-all flex-shrink-0"
                                title={t('researchTools.deleteRun')}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
