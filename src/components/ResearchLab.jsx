import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  FlaskConical, RefreshCw, FileText, BookOpen, Settings2, Lightbulb,
  GitBranch, FolderOpen, ChevronDown, ChevronRight, ExternalLink,
  FileCode, Beaker, Brain, Save, AlertCircle,
  Sparkles, Copy, Check, PenTool, Target, Clock3, ListChecks, MessageSquare
} from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { api } from '../utils/api';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Read a JSON file from the project via API, return parsed object or null */
async function readProjectJson(projectName, relativePath) {
  try {
    const res = await api.readFile(projectName, relativePath);
    if (!res.ok) return null; // 404 or other error — file doesn't exist yet
    const data = await res.json();
    if (data?.content) return JSON.parse(data.content);
  } catch (e) {
    console.warn(`ResearchLab: failed to read ${relativePath}:`, e.message);
  }
  return null;
}

/** Convert absolute path to relative to project root for API reads; if already relative, return as-is */
function toRelativePath(fullPath, projectRoot) {
  if (!fullPath || typeof fullPath !== 'string') return fullPath;
  const p = fullPath.replace(/\\/g, '/').trim();
  const root = (projectRoot || '').replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  if (root !== '/' && p.startsWith(root)) return p.slice(root.length).replace(/^\/+/, '');
  if (p.startsWith('/') && projectRoot) return p; // absolute but not under projectRoot — keep for display only
  return p;
}

/** Collect all relative file paths from the file tree (for existence checks, to avoid 404s) */
function collectAllRelativePaths(nodes, projectRoot) {
  const out = new Set();
  if (!nodes || !Array.isArray(nodes)) return out;
  const normRoot = projectRoot
    ? (projectRoot.replace(/[/\\]+$/, '') + '/').replace(/\\/g, '/')
    : '';

  function walk(items) {
    for (const item of items) {
      const pathNorm = (item.path || '').replace(/\\/g, '/');
      const rel = normRoot ? pathNorm.replace(normRoot, '').replace(/^\/+/, '') : pathNorm;
      if (item.type === 'file') out.add(rel);
      if (item.type === 'directory' && Array.isArray(item.children)) walk(item.children);
    }
  }
  walk(nodes);
  return out;
}

/** Walk file tree and collect files matching a predicate on the relative path */
function collectFiles(nodes, projectRoot, predicate) {
  const files = [];
  if (!nodes || !Array.isArray(nodes)) return files;
  const normRoot = projectRoot
    ? (projectRoot.replace(/[/\\]+$/, '') + '/').replace(/\\/g, '/')
    : '';

  function walk(items) {
    for (const item of items) {
      const pathNorm = (item.path || '').replace(/\\/g, '/');
      const rel = normRoot ? pathNorm.replace(normRoot, '').replace(/^\/+/, '') : pathNorm;
      if (item.type === 'file' && predicate(rel, item.name)) {
        files.push({ name: item.name, relativePath: rel, path: item.path });
      }
      if (item.type === 'directory' && Array.isArray(item.children)) {
        walk(item.children);
      }
    }
  }
  walk(nodes);
  return files;
}

/** Classify a log JSON file into a pipeline stage based on its name and relative path.
 *  Uses the new semantic directory layout (Ideation/, Experiment/) for primary
 *  classification, with filename-based fallback for legacy cache/ layout. */
function classifyArtifact(name, relativePath) {
  const rp = (relativePath || '').replace(/\\/g, '/');

  // ---- Directory-based classification (new layout) ----
  if (rp.startsWith('Ideation/references/')) {
    if (name === 'load_instance.json') return { stage: 'Data Loading', icon: FolderOpen, color: 'blue' };
    if (name === 'github_search.json') return { stage: 'Data Loading', icon: FolderOpen, color: 'blue' };
    if (name.includes('download_arxiv')) return { stage: 'Data Loading', icon: FolderOpen, color: 'blue' };
    if (name === 'prepare_agent.json') return { stage: 'Prepare', icon: Settings2, color: 'blue' };
    return { stage: 'Prepare', icon: Settings2, color: 'blue' };
  }
  if (rp.startsWith('Ideation/ideas/')) {
    if (name.startsWith('idea_generation')) return { stage: 'Idea Generation', icon: Lightbulb, color: 'amber' };
    if (name.includes('medical_evidence') || name.includes('medical_expert'))
      return { stage: 'Medical Expert', icon: Brain, color: 'rose' };
    if (name.includes('engineering_evidence') || name.includes('engineering_expert'))
      return { stage: 'Engineering Expert', icon: Brain, color: 'indigo' };
    return { stage: 'Idea Generation', icon: Lightbulb, color: 'amber' };
  }
  if (rp.startsWith('Experiment/code_references/')) {
    if (name === 'repo_acquisition_agent.json') return { stage: 'Repo Acquisition', icon: GitBranch, color: 'green' };
    if (name === 'code_survey_agent.json') return { stage: 'Code Survey', icon: FileCode, color: 'cyan' };
    return { stage: 'Code Survey', icon: FileCode, color: 'cyan' };
  }
  if (rp.startsWith('Experiment/core_code/')) {
    if (name === 'coding_plan_agent.json') return { stage: 'Implementation Plan', icon: FileText, color: 'purple' };
    if (name.startsWith('machine_learning')) return { stage: 'ML Development', icon: Beaker, color: 'orange' };
    if (name.startsWith('judge_agent')) return { stage: 'Judge', icon: AlertCircle, color: 'yellow' };
    return { stage: 'ML Development', icon: Beaker, color: 'orange' };
  }
  if (rp.startsWith('Experiment/analysis/')) {
    if (name.startsWith('experiment_analysis')) return { stage: 'Experiment Analysis', icon: Beaker, color: 'teal' };
    if (name.startsWith('machine_learning')) return { stage: 'ML Development', icon: Beaker, color: 'orange' };
    return { stage: 'Experiment Analysis', icon: Beaker, color: 'teal' };
  }
  if (rp.startsWith('Publication/')) {
    return { stage: 'Paper Writing', icon: PenTool, color: 'purple' };
  }

  // ---- Filename-based fallback (legacy cache/ layout) ----
  if (relativePath?.includes('/tools/') || name === 'load_instance.json')
    return { stage: 'Data Loading', icon: FolderOpen, color: 'blue' };
  if (name === 'github_search.json') return { stage: 'Data Loading', icon: FolderOpen, color: 'blue' };
  if (name.includes('download_arxiv')) return { stage: 'Data Loading', icon: FolderOpen, color: 'blue' };
  if (name === 'prepare_agent.json') return { stage: 'Prepare', icon: Settings2, color: 'blue' };
  if (name.startsWith('idea_generation')) return { stage: 'Idea Generation', icon: Lightbulb, color: 'amber' };
  if (name.includes('medical_evidence') || name.includes('medical_expert'))
    return { stage: 'Medical Expert', icon: Brain, color: 'rose' };
  if (name.includes('engineering_evidence') || name.includes('engineering_expert'))
    return { stage: 'Engineering Expert', icon: Brain, color: 'indigo' };
  if (name === 'repo_acquisition_agent.json') return { stage: 'Repo Acquisition', icon: GitBranch, color: 'green' };
  if (name === 'code_survey_agent.json') return { stage: 'Code Survey', icon: FileCode, color: 'cyan' };
  if (name === 'coding_plan_agent.json') return { stage: 'Implementation Plan', icon: FileText, color: 'purple' };
  if (name.startsWith('machine_learning')) return { stage: 'ML Development', icon: Beaker, color: 'orange' };
  if (name.startsWith('judge_agent')) return { stage: 'Judge', icon: AlertCircle, color: 'yellow' };
  if (name.startsWith('experiment_analysis')) return { stage: 'Experiment Analysis', icon: Beaker, color: 'teal' };
  return { stage: 'Other', icon: FileText, color: 'gray' };
}

const BADGE_COLORS = {
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  cyan: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  gray: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

const IDEATION_STAGES = new Set([
  'Data Loading',
  'Prepare',
  'Idea Generation',
  'Medical Expert',
  'Engineering Expert',
]);

const EXPERIMENT_STAGES = new Set([
  'Repo Acquisition',
  'Code Survey',
  'Implementation Plan',
  'ML Development',
  'Judge',
  'Experiment Analysis',
  'Other',
]);

const PUBLICATION_STAGES = new Set(['Paper Writing']);
const DEFAULT_RESEARCH_BRIEF_FILENAME = 'research_brief.json';
const DEFAULT_TASKS_FILENAME = 'tasks.json';
const TASK_STAGE_ORDER = ['ideation', 'experiment', 'publication', 'unassigned'];
const TASK_STAGE_META = {
  ideation: { label: 'Ideation', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  experiment: { label: 'Experiment', className: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300' },
  publication: { label: 'Publication', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  unassigned: { label: 'Unassigned', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
};
const TASK_STATUS_META = {
  pending: { label: 'Pending', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  'in-progress': { label: 'In Progress', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  done: { label: 'Done', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  review: { label: 'Review', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  deferred: { label: 'Deferred', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

/* ------------------------------------------------------------------ */
/*  Sub-components (cards)                                             */
/* ------------------------------------------------------------------ */

/** Overview card: target paper, task, mode */
function OverviewCard({ instance, config }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const mode = config?.task_level === 'task1' ? 'Plan' : 'Idea';
  const modeColor = mode === 'Plan'
    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  const taskText = instance?.task2 || instance?.task1 || instance?.ideas || '';
  const shouldTruncate = taskText.length > 400;
  const displayedText = (shouldTruncate && !isExpanded)
    ? taskText.slice(0, 400) + '…'
    : taskText;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Research Overview
        </h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${modeColor}`}>
          {mode} Mode
        </span>
      </div>
      {instance?.target && (
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Target Paper</p>
          <p className="text-sm font-medium text-foreground">{instance.target}</p>
          {instance?.url && (
            <a href={instance.url} target="_blank" rel="noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 mt-0.5">
              {instance.url} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
      {(instance?.instance_id ?? instance?.instance_path) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Instance: <code className="bg-muted px-1 rounded">{instance.instance_id ?? instance.instance_path?.split('/').pop()}</code></span>
          {config?.category && <span>Category: <code className="bg-muted px-1 rounded">{config.category}</code></span>}
        </div>
      )}
      {taskText && (
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Task Description</p>
          <div className="text-sm text-foreground/80 leading-relaxed markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2" {...props} />,
                ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-2" {...props} />,
                li: ({node, ...props}) => <li className="mb-0.5" {...props} />,
                code: ({node, inline, className, children, ...props}) => {
                  return inline ? (
                    <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono" {...props}>
                      {children}
                    </code>
                  ) : (
                    <code className="block bg-muted p-2 rounded text-xs font-mono whitespace-pre-wrap my-2" {...props}>
                      {children}
                    </code>
                  );
                }
              }}
            >
              {displayedText}
            </ReactMarkdown>
          </div>
          {shouldTruncate && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-0 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mt-1"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <span className="flex items-center">
                  <ChevronDown className="w-3 h-3 mr-1" /> Show less
                </span>
              ) : (
                <span className="flex items-center">
                  <ChevronRight className="w-3 h-3 mr-1" /> Show more
                </span>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Source papers list */
function PapersCard({ papers }) {
  const [expanded, setExpanded] = useState(false);
  if (!papers || papers.length === 0) return null;
  const shown = expanded ? papers : papers.slice(0, 5);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        Source Papers
        <span className="text-xs font-normal text-muted-foreground">({papers.length})</span>
      </h3>
      <ul className="space-y-1.5">
        {shown.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="text-xs text-muted-foreground mt-0.5 w-5 text-right flex-shrink-0">{p.rank || i + 1}.</span>
            <div className="min-w-0">
              <span className="text-foreground">{p.reference}</span>
              {p.type && (() => {
                const types = Array.isArray(p.type) ? p.type : [p.type];
                const label = types.join(', ');
                const cls = label.includes('methodolog') ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                  label.includes('component') ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
                return <span className={`ml-2 text-xs px-1.5 py-0 rounded ${cls}`}>{label}</span>;
              })()}
            </div>
          </li>
        ))}
      </ul>
      {papers.length > 5 && (
        <button onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
          {expanded ? 'Show less' : `Show all ${papers.length} papers`}
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}

function StageSection({ title, icon: Icon, badgeClass, expanded, onToggle, children }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 text-left hover:bg-muted/40 rounded-md px-1.5 py-1"
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        <Icon className="w-4 h-4" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${badgeClass}`}>Stage</span>
      </button>
      {expanded && <div className="space-y-3">{children}</div>}
    </div>
  );
}

function TaskPipelineBoard({ tasks, isLoading, onNavigateToChat, projectName, onTaskUpdated }) {
  const { t } = useTranslation('common');
  const [openStages, setOpenStages] = useState({});
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', description: '' });
  const [saving, setSaving] = useState(false);

  // Clear editing state when project changes
  useEffect(() => {
    setEditingTaskId(null);
    setEditForm({ title: '', description: '' });
  }, [projectName]);

  const handleDoubleClick = useCallback((task) => {
    setEditingTaskId(String(task.id));
    setEditForm({ title: task.title || '', description: task.description || '' });
  }, []);

  const handleCancel = useCallback(() => {
    setEditingTaskId(null);
    setEditForm({ title: '', description: '' });
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingTaskId || !projectName) return;
    setSaving(true);
    try {
      await api.taskmaster.updateTask(
        encodeURIComponent(projectName),
        editingTaskId,
        { title: editForm.title, description: editForm.description },
      );
      if (onTaskUpdated) onTaskUpdated();
    } catch (e) {
      console.error('Failed to update task:', e);
    } finally {
      setSaving(false);
      setEditingTaskId(null);
      setEditForm({ title: '', description: '' });
    }
  }, [editingTaskId, editForm, projectName, onTaskUpdated]);

  useEffect(() => {
    if (!Array.isArray(tasks) || tasks.length === 0) return;
    setOpenStages((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { ideation: true, experiment: true, publication: true, unassigned: false };
    });
  }, [tasks]);

  const normalizedTasks = useMemo(
    () => (Array.isArray(tasks) ? tasks : []).map((task) => ({
      ...task,
      stage: TASK_STAGE_META[task?.stage] ? task.stage : 'unassigned',
      status: TASK_STATUS_META[task?.status] ? task.status : 'pending',
    })),
    [tasks],
  );

  const summary = useMemo(() => {
    const total = normalizedTasks.length;
    const done = normalizedTasks.filter((task) => task.status === 'done').length;
    const inProgress = normalizedTasks.filter((task) => task.status === 'in-progress').length;
    const pending = normalizedTasks.filter((task) => task.status === 'pending').length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, inProgress, pending, progress };
  }, [normalizedTasks]);

  const groupedTasks = useMemo(() => {
    const groups = {
      ideation: [],
      experiment: [],
      publication: [],
      unassigned: [],
    };
    normalizedTasks.forEach((task) => {
      groups[task.stage].push(task);
    });
    Object.values(groups).forEach((list) => {
      list.sort((a, b) => Number(a.id) - Number(b.id));
    });
    return groups;
  }, [normalizedTasks]);

  const firstPendingTaskId = useMemo(() => {
    const first = normalizedTasks.find((task) => task.status === 'pending');
    return first ? String(first.id) : null;
  }, [normalizedTasks]);

  const toggleStage = useCallback((stage) => {
    setOpenStages((prev) => ({ ...prev, [stage]: !(prev[stage] ?? false) }));
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-sky-50 via-cyan-50 to-emerald-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-border flex items-center justify-center">
              <ListChecks className="w-4 h-4 text-cyan-700 dark:text-cyan-300" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                Pipeline Task List
              </h3>
              <p className="text-xs text-muted-foreground">
                Stage-oriented task board for your research pipeline
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading pipeline tasks...</div>
        ) : summary.total === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No tasks found yet. Start a conversation in Chat to generate your research pipeline and tasks.
            </p>
            {onNavigateToChat && (
              <Button
                size="sm"
                className="text-white bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-500 hover:from-cyan-400 hover:via-sky-400 hover:to-emerald-400"
                onClick={() => onNavigateToChat()}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Go to Chat
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Total</p>
                <p className="text-sm font-semibold text-foreground">{summary.total}</p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Done</p>
                <p className="text-sm font-semibold text-green-600 dark:text-green-400">{summary.done}</p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">In Progress</p>
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">{summary.inProgress}</p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Pending</p>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{summary.pending}</p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background p-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span className="flex items-center gap-1"><Target className="w-3.5 h-3.5" /> Progress</span>
                <span>{summary.progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-300"
                  style={{ width: `${summary.progress}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              {TASK_STAGE_ORDER.map((stage) => {
                const stageTasks = groupedTasks[stage];
                if (!stageTasks || stageTasks.length === 0) return null;
                const isOpen = openStages[stage] ?? true;
                const meta = TASK_STAGE_META[stage];
                return (
                  <div key={stage} className="rounded-lg border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleStage(stage)}
                      className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/40 text-left"
                    >
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.className}`}>{meta.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{stageTasks.length}</span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-border bg-background/60">
                        {stageTasks.map((task) => {
                          const statusMeta = TASK_STATUS_META[task.status] || TASK_STATUS_META.pending;
                          const isFirstPendingTask = task.status === 'pending' && String(task.id) === firstPendingTaskId;
                          const isEditing = editingTaskId === String(task.id);
                          const cardTone = task.status === 'done'
                            ? 'border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-900/70 dark:bg-emerald-950/20'
                            : task.status === 'in-progress'
                              ? 'border-blue-200/80 bg-blue-50/40 dark:border-blue-900/70 dark:bg-blue-950/20'
                              : 'border-slate-200/80 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-950/20';
                          return (
                            <div
                              key={`${stage}-${task.id}`}
                              className={`mx-2 my-2 rounded-xl border px-3 py-2.5 transition-all ${
                                isFirstPendingTask && !isEditing ? 'ring-1 ring-emerald-300/60 dark:ring-emerald-700/60' : ''
                              } ${cardTone} ${!isEditing ? 'cursor-pointer hover:shadow-sm hover:border-cyan-300/70 dark:hover:border-cyan-800/70' : 'border-cyan-400/70 dark:border-cyan-700/70 bg-cyan-50/40 dark:bg-cyan-950/20'}`}
                              onDoubleClick={!isEditing ? () => handleDoubleClick(task) : undefined}
                              title={!isEditing ? t('researchLabTaskBoard.doubleClickToEdit') : undefined}
                            >
                              <div className="flex items-start gap-2">
                                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-background/90 border border-border text-muted-foreground mt-0.5">#{task.id}</span>
                                <div className="min-w-0 flex-1">
                                  {isEditing ? (
                                    <div className="space-y-1.5">
                                      <input
                                        type="text"
                                        className="w-full text-sm font-medium text-foreground bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                        value={editForm.title}
                                        onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
                                          if (e.key === 'Escape') handleCancel();
                                        }}
                                        disabled={saving}
                                        autoFocus
                                        placeholder={t('researchLabTaskBoard.taskTitlePlaceholder')}
                                      />
                                      <textarea
                                        className="w-full text-xs text-muted-foreground bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y min-h-[2.5rem]"
                                        value={editForm.description}
                                        onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
                                          if (e.key === 'Escape') handleCancel();
                                        }}
                                        disabled={saving}
                                        rows={2}
                                        placeholder={t('researchLabTaskBoard.taskDescriptionPlaceholder')}
                                      />
                                      <div className="flex items-center gap-1.5">
                                        <Button
                                          size="sm"
                                          className="h-6 px-2 text-[10px]"
                                          onClick={handleSave}
                                          disabled={saving}
                                        >
                                          <Check className="w-3 h-3 mr-1" />
                                          {saving ? t('researchLabTaskBoard.saving') : t('buttons.save')}
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-2 text-[10px]"
                                          onClick={handleCancel}
                                          disabled={saving}
                                        >
                                          {t('buttons.cancel')}
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <p className="text-sm font-semibold text-foreground line-clamp-2">{task.title || t('researchLabTaskBoard.untitledTask')}</p>
                                      {task.description && (
                                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>
                                      )}
                                      <p className="text-[10px] text-muted-foreground/80 mt-1 inline-flex items-center gap-1">
                                        <PenTool className="w-3 h-3" />
                                        {t('researchLabTaskBoard.editHint')}
                                      </p>
                                    </>
                                  )}
                                  {!isEditing && Array.isArray(task.suggestedSkills) && task.suggestedSkills.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                      {task.suggestedSkills.slice(0, 3).map((skill) => (
                                        <span key={`${task.id}-${skill}`} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300">
                                          {skill}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {!isEditing && (
                                  <div className="flex flex-col items-end gap-1">
                                    <div className="flex items-center gap-1">
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusMeta.className}`}>{statusMeta.label}</span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-[10px] border border-border/70 hover:border-cyan-400/70"
                                        onClick={() => handleDoubleClick(task)}
                                      >
                                        <PenTool className="w-3 h-3 mr-1" />
                                        {t('buttons.edit')}
                                      </Button>
                                    </div>
                                    {isFirstPendingTask && onNavigateToChat && (
                                      <div className="mt-0.5 inline-flex flex-col items-end gap-1">
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 animate-pulse">
                                          Next
                                        </span>
                                        <Button
                                          size="sm"
                                          className="h-7 px-2.5 text-[11px] font-semibold text-white bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-500 hover:from-cyan-400 hover:via-sky-400 hover:to-emerald-400 shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_8px_18px_rgba(16,185,129,0.35)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_20px_rgba(34,211,238,0.35)] transition-all"
                                          onClick={() => onNavigateToChat()}
                                        >
                                          <Sparkles className="w-3 h-3 mr-1.5" />
                                          <MessageSquare className="w-3 h-3 mr-1" />
                                          Go to Chat
                                        </Button>
                                      </div>
                                    )}
                                    {task.status === 'in-progress' && (
                                      <span className="text-[10px] text-blue-600 dark:text-blue-300 inline-flex items-center gap-1">
                                        <Clock3 className="w-3 h-3" />
                                        Active
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Research artifacts grouped by pipeline stage */
function ArtifactsCard({ artifacts, onSelect, selectedPath }) {
  const [openStages, setOpenStages] = useState({});
  if (!artifacts || artifacts.length === 0) return null;

  // Group by stage
  const groups = {};
  for (const a of artifacts) {
    const info = classifyArtifact(a.name, a.relativePath);
    if (!groups[info.stage]) groups[info.stage] = { ...info, files: [] };
    groups[info.stage].files.push(a);
  }
  const stageOrder = [
    'Data Loading', 'Prepare', 'Idea Generation', 'Medical Expert', 'Engineering Expert',
    'Repo Acquisition', 'Code Survey', 'Implementation Plan',
    'ML Development', 'Judge', 'Experiment Analysis', 'Paper Writing', 'Other'
  ];
  const sorted = stageOrder.filter(s => groups[s]).map(s => ({ stage: s, ...groups[s] }));

  const toggle = (stage) => setOpenStages(prev => ({ ...prev, [stage]: !prev[stage] }));

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Beaker className="w-4 h-4 text-orange-500 dark:text-orange-400" />
        Research Artifacts
        <span className="text-xs font-normal text-muted-foreground">({artifacts.length} files)</span>
      </h3>
      <div className="space-y-1">
        {sorted.map(g => {
          const Icon = g.icon;
          const isOpen = openStages[g.stage] ?? false;
          return (
            <div key={g.stage}>
              <button onClick={() => toggle(g.stage)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm">
                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <Icon className="w-4 h-4" />
                <span className="font-medium text-foreground">{g.stage}</span>
                <span className={`ml-auto text-xs px-1.5 py-0 rounded ${BADGE_COLORS[g.color]}`}>
                  {g.files.length}
                </span>
              </button>
              {isOpen && (
                <ul className="ml-6 pl-2 border-l border-border space-y-0.5 py-1">
                  {g.files.map(f => (
                    <li key={f.relativePath}>
                      <button onClick={() => onSelect(f)}
                        className={`w-full text-left px-2 py-1 rounded text-xs flex items-center gap-1.5 truncate ${
                          selectedPath === f.relativePath
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200'
                            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}>
                        <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Markdown components for IdeaCard                                   */
/* ------------------------------------------------------------------ */
const ideaMarkdownComponents = {
  h1: ({ children }) => <h1 className="text-xl font-bold text-foreground mt-5 mb-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-semibold text-foreground mt-4 mb-2 border-b border-border pb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold text-foreground mt-3 mb-1">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold text-foreground mt-2 mb-1">{children}</h4>,
  p: ({ children }) => <p className="text-sm text-foreground/85 leading-relaxed mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside text-sm text-foreground/85 mb-2 space-y-0.5 ml-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside text-sm text-foreground/85 mb-2 space-y-0.5 ml-2">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-blue-300 dark:border-blue-600 pl-3 italic text-foreground/70 my-2 text-sm">{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  code: ({ inline, className, children, ...props }) => {
    if (inline) {
      return <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">{children}</code>;
    }
    const lang = (className || '').replace('language-', '');
    return (
      <div className="my-2 rounded-lg overflow-hidden border border-border">
        {lang && <div className="bg-muted/60 px-3 py-1 text-xs text-muted-foreground font-mono border-b border-border">{lang}</div>}
        <pre className="bg-muted/30 p-3 overflow-x-auto text-xs">
          <code className="font-mono text-foreground/90">{children}</code>
        </pre>
      </div>
    );
  },
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse border border-border text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-1.5 text-left text-xs font-semibold border border-border">{children}</th>,
  td: ({ children }) => <td className="px-3 py-1.5 align-top text-xs border border-border">{children}</td>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-3 border-border" />,
};

/** Read a text file from the project via API, return string or null */
async function readProjectText(projectName, relativePath) {
  try {
    const res = await api.readFile(projectName, relativePath);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.content) return data.content;
  } catch (e) {
    console.warn(`ResearchLab: failed to read text ${relativePath}:`, e.message);
  }
  return null;
}

/** Helper: only request file if it might exist (avoids 404s when project has no pipeline output yet) */
function hasFile(fileSet, relativePath) {
  if (!fileSet) return false;
  return fileSet.has(relativePath);
}

/** Final Idea card — shows the selected idea rendered as markdown */
function IdeaCard({ projectName, config, projectFileSet }) {
  const [ideaText, setIdeaText] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);

  useEffect(() => {
    if (!projectName) { setLoading(false); return; }
    // Wait for file tree to load so we can avoid probing missing files (prevents 404 spam).
    if (projectFileSet === null) { setLoading(true); return; }

    setLoading(true);

    (async () => {
      try {
        // --- New layout or legacy path: prefer config.ideas_path_relative (compat with old projects) ---
        const ideasDir = config?.ideas_path_relative || 'Ideation/ideas';

        // 1. Primary: read selected_idea.txt from ideas dir (skip request if file not in tree to avoid 404)
        const selectedPath = `${ideasDir}/selected_idea.txt`;
        if (hasFile(projectFileSet, selectedPath)) {
          const selectedTxt = await readProjectText(projectName, selectedPath);
          if (selectedTxt) {
            setIdeaText(selectedTxt);
            setLoading(false);
            return;
          }
        }

        // 2. Fallback: read raw_idea_N.txt in reverse order (latest first)
        for (let i = 10; i >= 1; i--) {
          const rawPath = `${ideasDir}/raw_idea_${i}.txt`;
          if (!hasFile(projectFileSet, rawPath)) continue;
          const rawTxt = await readProjectText(projectName, rawPath);
          if (rawTxt) {
            setIdeaText(rawTxt);
            setLoading(false);
            return;
          }
        }

        // 3. Fallback: read from logs JSON
        const selectFile = `${ideasDir}/logs/idea_generation_agent_iter_select.json`;
        if (hasFile(projectFileSet, selectFile)) {
          const selectData = await readProjectJson(projectName, selectFile);
          if (selectData?.context_variables?.final_selected_idea_data) {
            const data = selectData.context_variables.final_selected_idea_data;
            setIdeaText(data.selected_idea_text || data.raw_idea || null);
            setLoading(false);
            return;
          }
        }

        // --- Legacy layout: cache_path based ---
        if (config?.cache_path) {
          const cachePath = config.cache_path;
          const relativeCacheBase = cachePath.includes('/outputs/')
            ? 'outputs/' + cachePath.split('/outputs/')[1]
            : cachePath;
          const cacheDir = relativeCacheBase.replace(/\/+$/, '');

          const legacySelectedPath = `${cacheDir}/selected_idea.txt`;
          if (hasFile(projectFileSet, legacySelectedPath)) {
            const legacySelected = await readProjectText(projectName, legacySelectedPath);
            if (legacySelected) {
              setIdeaText(legacySelected);
              setLoading(false);
              return;
            }
          }
          for (let i = 10; i >= 1; i--) {
            const rawPath = `${cacheDir}/raw_idea_${i}.txt`;
            if (!hasFile(projectFileSet, rawPath)) continue;
            const rawTxt = await readProjectText(projectName, rawPath);
            if (rawTxt) {
              setIdeaText(rawTxt);
              setLoading(false);
              return;
            }
          }
          const legacySelectFile = `${cacheDir}/agents/idea_generation_agent_iter_select.json`;
          if (hasFile(projectFileSet, legacySelectFile)) {
            const legacyData = await readProjectJson(projectName, legacySelectFile);
            if (legacyData?.context_variables?.final_selected_idea_data) {
              const data = legacyData.context_variables.final_selected_idea_data;
              setIdeaText(data.selected_idea_text || data.raw_idea || null);
              setLoading(false);
              return;
            }
          }
        }
      } catch (e) {
        console.warn('IdeaCard: failed to load idea:', e.message);
      }
      setIdeaText(null);
      setLoading(false);
    })();
  }, [projectName, config, projectFileSet]);

  const handleCopy = useCallback(() => {
    if (!ideaText) return;
    navigator.clipboard.writeText(ideaText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [ideaText]);

  if (loading) return null;
  if (!ideaText) return null;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          Final Selected Idea
        </h3>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            title="Copy to clipboard"
          >
            {copied
              ? <Check className="w-3.5 h-3.5 text-green-600" />
              : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
          </Button>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? '' : '-rotate-90'}`} />
        </div>
      </div>

      {/* Body — markdown rendered */}
      {expanded && (
        <div className="border-t border-border px-5 py-4 max-h-[600px] overflow-y-auto">
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={ideaMarkdownComponents}
          >
            {ideaText}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/** Paper (main.pdf) viewer — shows Publication/paper/main.pdf when present */
function PaperCard({ projectName, projectRoot }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'loaded' | 'not_found' | 'error'
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!projectName || !projectRoot) {
      setStatus('not_found');
      return;
    }
    const absolutePath = `${projectRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/Publication/paper/main.pdf`;
    setStatus('loading');
    setPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    api.getFileContentBlob(projectName, absolutePath)
      .then((blob) => {
        setPdfUrl(URL.createObjectURL(blob));
        setStatus('loaded');
      })
      .catch((err) => {
        setStatus(err?.message === 'Not found' ? 'not_found' : 'error');
      });
    return () => {
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [projectName, projectRoot]);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <PenTool className="w-4 h-4 text-purple-500 dark:text-purple-400" />
          Paper (main.pdf)
        </h3>
        {status === 'loaded' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              if (pdfUrl) window.open(pdfUrl, '_blank', 'noopener');
            }}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" />
            Open in new tab
          </Button>
        )}
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 ml-2 transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </div>
      {expanded && (
        <div className="border-t border-border">
          {status === 'loading' && (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading paper…</div>
          )}
          {status === 'loaded' && pdfUrl && (
            <div className="relative w-full" style={{ minHeight: '60vh' }}>
              <iframe
                title="Paper (main.pdf)"
                src={pdfUrl}
                className="w-full border-0 rounded-b-lg"
                style={{ height: '70vh' }}
              />
            </div>
          )}
          {status === 'not_found' && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <p>No <code className="bg-muted px-1 rounded">main.pdf</code> found.</p>
              <p className="mt-1">Run the <strong>inno-paper-writing</strong> skill and output the paper to <code className="bg-muted px-1 rounded">Publication/paper/</code> to view it here.</p>
            </div>
          )}
          {status === 'error' && (
            <div className="p-6 text-center text-sm text-destructive">
              Failed to load the paper. Check that <code className="bg-muted px-1 rounded">Publication/paper/main.pdf</code> exists and try again.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** File viewer / editor panel */
function FileViewer({ projectName, file, onClose }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    if (!file) return;
    setLoading(true);
    setDirty(false);
    setSaveStatus(null);
    api.readFile(projectName, file.relativePath)
      .then(async (response) => {
        if (!response?.ok) {
          return null;
        }

        const rawText = await response.text();
        if (!rawText) {
          return { content: '' };
        }

        try {
          return JSON.parse(rawText);
        } catch {
          // Fallback for non-JSON error pages or unexpected payloads.
          return { content: rawText };
        }
      })
      .then((data) => setContent(data?.content ?? ''))
      .catch(() => setContent(''))
      .finally(() => setLoading(false));
  }, [projectName, file]);

  const handleSave = async () => {
    if (!file) return;
    setSaveStatus('saving');
    try {
      await api.saveFile(projectName, file.relativePath, content);
      setDirty(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  if (!file) return null;

  return (
    <div className="rounded-lg border border-border bg-card flex flex-col overflow-hidden">
      <div className="border-b border-border px-3 py-2 flex items-center justify-between flex-shrink-0 bg-muted/30">
        <span className="text-xs font-medium text-foreground truncate flex-1 mr-2">{file.relativePath}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveStatus === 'saved' && <span className="text-xs text-green-600">Saved</span>}
          {saveStatus === 'error' && <span className="text-xs text-red-600">Failed</span>}
          <Button size="sm" variant="ghost" onClick={handleSave} disabled={!dirty || loading}>
            <Save className="w-3.5 h-3.5 mr-1" /> Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>✕</Button>
        </div>
      </div>
      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading...</div>
      ) : (
        <textarea
          className="flex-1 min-h-[250px] p-3 text-xs font-mono bg-background border-0 resize-y focus:outline-none focus:ring-0 text-foreground"
          value={content}
          onChange={e => { setContent(e.target.value); setDirty(true); }}
          spellCheck={false}
        />
      )}
    </div>
  );
}

function UsageGuideNotice({ t, onNavigateToChat }) {
  return (
    <div className="rounded-lg border border-blue-300/60 dark:border-blue-700/60 bg-blue-50/80 dark:bg-blue-900/20 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200">
            {t('researchLabGuide.title')}
          </h3>
          <p className="text-xs text-blue-900/90 dark:text-blue-200/90">
            {t('researchLabGuide.description')}
          </p>
          <ol className="list-decimal pl-4 space-y-1 text-xs text-blue-900/90 dark:text-blue-200/90">
            <li>{t('researchLabGuide.step1')}</li>
            <li>{t('researchLabGuide.step2')}</li>
            <li>{t('researchLabGuide.step3')}</li>
            <li>{t('researchLabGuide.step4')}</li>
          </ol>
          <p className="text-xs font-medium text-blue-900 dark:text-blue-200">
            {t('researchLabGuide.interfaceMap')}
          </p>
          {onNavigateToChat && (
            <Button
              size="sm"
              className="mt-1 text-white bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-500 hover:from-cyan-400 hover:via-sky-400 hover:to-emerald-400"
              onClick={onNavigateToChat}
            >
              <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
              Go to Chat
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

function ResearchLab({ selectedProject, onNavigateToChat }) {
  const { t } = useTranslation('common');
  const [loading, setLoading] = useState(false);
  const [instance, setInstance] = useState(null);
  const [config, setConfig] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [projectFileSet, setProjectFileSet] = useState(null);
  const [selectedFile, setSelectedFileRaw] = useState(null);
  const HIDDEN_FILENAMES = useMemo(() => new Set([DEFAULT_RESEARCH_BRIEF_FILENAME, DEFAULT_TASKS_FILENAME]), []);
  const setSelectedFile = useCallback((file) => {
    if (file && HIDDEN_FILENAMES.has(file.name)) return;
    setSelectedFileRaw(file);
  }, [HIDDEN_FILENAMES]);
  const [sectionsOpen, setSectionsOpen] = useState({
    ideation: true,
    experiment: true,
    publication: true,
  });

  const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';
  const projectName = selectedProject?.name;
  const projectIdentity = `${projectRoot || ''}::${projectName || ''}`;

  useEffect(() => {
    if (!projectName) {
      setSelectedFile(null);
      return;
    }
    const briefRelativePath = `.pipeline/docs/${DEFAULT_RESEARCH_BRIEF_FILENAME}`;
    setSelectedFile({
      name: DEFAULT_RESEARCH_BRIEF_FILENAME,
      relativePath: briefRelativePath,
      path: `${projectRoot.replace(/[/\\]+$/, '')}/${briefRelativePath}`,
    });
  }, [projectIdentity, projectName, projectRoot]);

  const loadData = useCallback(async () => {
    if (!projectName) {
      setInstance(null);
      setConfig(null);
      setArtifacts([]);
      setTasks([]);
      setProjectFileSet(null);
      return;
    }
    setLoading(true);
    setTasksLoading(true);
    setInstance(null);
    setConfig(null);
    try {
      const [tasksResponse, filesResponse] = await Promise.all([
        api.get(`/taskmaster/tasks/${encodeURIComponent(projectName)}`).catch(() => null),
        api.getFiles(projectName),
      ]);
      const taskData = tasksResponse && tasksResponse.ok ? await tasksResponse.json() : null;
      setTasks(Array.isArray(taskData?.tasks) ? taskData.tasks : []);

      // Load file tree and collect log artifacts from new layout + legacy cache
      const filesRawText = filesResponse?.ok ? await filesResponse.text() : '[]';
      let data = [];
      try {
        data = filesRawText ? JSON.parse(filesRawText) : [];
      } catch {
        data = [];
      }
      const tree = Array.isArray(data) ? data : [];
      const fileSet = collectAllRelativePaths(tree, projectRoot);
      setProjectFileSet(fileSet);

      // Optional compatibility: read legacy metadata files only when they exist.
      const hasInstanceFile = fileSet.has('instance.json');
      const hasPipelineConfig = fileSet.has('pipeline_config.json');

      if (hasInstanceFile || hasPipelineConfig) {
        const [inst, pipelineConfig] = await Promise.all([
          hasInstanceFile ? readProjectJson(projectName, 'instance.json') : Promise.resolve(null),
          hasPipelineConfig ? readProjectJson(projectName, 'pipeline_config.json') : Promise.resolve(null),
        ]);

        // Prefer instance.json; merge in pipeline_config for old projects or missing keys
        const merged = inst
          ? { ...(pipelineConfig || {}), ...inst }
          : pipelineConfig
            ? { ...pipelineConfig, instance_path: pipelineConfig.instance_path }
            : null;
        setInstance(merged);

        // Normalize for UI: support both new schema (Ideation.*, Experiment.*, instance) and old (*_path, task_level)
        const ideasPath = merged?.Ideation?.ideas ?? merged?.ideas_path;
        const referencesPath = merged?.Ideation?.references ?? merged?.references_path;
        const conf = merged
          ? {
              ...merged,
              instance: merged.instance ?? merged.instance_path,
              dataset_path: merged.Experiment?.datasets ?? merged.datasets_path,
              task_level: merged.idea_maturity ?? merged.task_level ?? undefined,
              cache_path: merged.cache_path,
              ideas_path: ideasPath,
              references_path: referencesPath,
              ideas_path_relative: toRelativePath(ideasPath, projectRoot) || 'Ideation/ideas',
              references_path_relative: toRelativePath(referencesPath, projectRoot) || 'Ideation/references',
            }
          : null;
        setConfig(conf);
      }

      const logFiles = collectFiles(tree, projectRoot, (rel) => {
        if (!rel.endsWith('.json')) return false;
        // New layout: JSON files inside logs/ dirs under Ideation/ or Experiment/
        if (/^(Ideation|Experiment)\/.*\/logs\//.test(rel)) return true;
        // Publication: any JSON files under Publication/
        if (/^Publication\//.test(rel)) return true;
        // Legacy layout: JSON files inside cache/ directories
        if (/(?:^|\/)cache\//.test(rel)) return true;
        return false;
      });
      // Exclude research_brief.json and tasks.json from user-visible artifacts
      const HIDDEN_FILES = new Set([DEFAULT_RESEARCH_BRIEF_FILENAME, DEFAULT_TASKS_FILENAME]);
      setArtifacts(logFiles.filter((f) => !HIDDEN_FILES.has(f.name)));
    } catch (e) {
      console.error('ResearchLab load:', e);
    } finally {
      setLoading(false);
      setTasksLoading(false);
    }
  }, [projectName, projectRoot]);

  useEffect(() => { loadData(); }, [loadData]);
  const toggleSection = useCallback((key) => {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const hasContent = instance || config || artifacts.length > 0 || tasks.length > 0;

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>{t('mainContent.chooseProject') || 'Choose a project'}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <span className="font-medium text-foreground">
            {t('tabs.researchLab') || 'Research Lab'}
          </span>
          {config?.task_level && (
            <Badge variant="outline" className="text-xs">
              {config.task_level === 'task1' ? 'Plan' : 'Idea'}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="p-4 max-w-[1380px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
            <div className="space-y-4 min-w-0">
              <UsageGuideNotice t={t} onNavigateToChat={onNavigateToChat} />

              <TaskPipelineBoard
                tasks={tasks}
                isLoading={tasksLoading}
                onNavigateToChat={onNavigateToChat}
                projectName={projectName}
                onTaskUpdated={loadData}
              />

              {loading && !hasContent ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                  Loading research data...
                </div>
              ) : !hasContent ? (
                <div className="flex flex-col items-center justify-center h-60 text-muted-foreground text-sm gap-3">
                  <FolderOpen className="w-14 h-14 opacity-40" />
                  <p>No research data found in this project.</p>
                  <p className="text-xs max-w-md text-center">
                    Start a research pipeline to initialize project artifacts.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Beaker className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                        Artifacts Explorer
                      </h3>
                      <span className="text-xs text-muted-foreground">{artifacts.length} files</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Browse artifacts generated across Ideation, Experiment, and Publication stages.
                    </p>
                    {artifacts.length > 0 ? (
                      <ArtifactsCard
                        artifacts={artifacts}
                        onSelect={setSelectedFile}
                        selectedPath={selectedFile?.relativePath}
                      />
                    ) : (
                      <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-4">
                        No stage artifacts found yet. Run tasks first, then refresh.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="hidden lg:block lg:sticky lg:top-4">
              {selectedFile ? (
                <FileViewer
                  projectName={projectName}
                  file={selectedFile}
                  onClose={() => setSelectedFile(null)}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-card/60 px-4 py-6 text-center text-xs text-muted-foreground">
                  Select any artifact file to preview it here.
                </div>
              )}
            </div>
          </div>

          {selectedFile && (
            <div className="lg:hidden mt-4">
              <FileViewer
                projectName={projectName}
                file={selectedFile}
                onClose={() => setSelectedFile(null)}
              />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default ResearchLab;
