import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeLatexDelimiters } from '../utils/latexNormalizer';
import {
  FlaskConical, RefreshCw, FileText, BookOpen, Settings2, Lightbulb,
  GitBranch, FolderOpen, ChevronDown, ChevronRight, ExternalLink,
  FileCode, Beaker, Brain, Save, AlertCircle,
  Sparkles, Copy, Check, PenTool, Target, Clock3, ListChecks, MessageSquare,
  Plus, Trash2, AlertTriangle, Maximize2, X
} from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import WorkbenchDialog from './ui/WorkbenchDialog';
import { api } from '../utils/api';
import useLocalStorage from '../hooks/useLocalStorage';
import { useTaskMaster } from '../contexts/TaskMasterContext';
import JsonTreeViewer from './JsonTreeViewer';

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
  if (rp.startsWith('Survey/') || rp.startsWith('Research/')) {
    if (rp.includes('/references/')) return { stage: 'Literature Survey', icon: BookOpen, color: 'sky' };
    if (rp.includes('/reports/')) return { stage: 'Gap Analysis', icon: BookOpen, color: 'sky' };
    return { stage: 'Literature Survey', icon: BookOpen, color: 'sky' };
  }
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
  if (
    rp.startsWith('Promotion/')
    || rp.startsWith('Presentation/')
    || rp.startsWith('Publication/homepage/')
    || rp.startsWith('Publication/slide/')
  ) {
    if (rp.includes('/homepage/'))
      return { stage: 'Homepage Delivery', icon: FileText, color: 'pink' };
    if (rp.includes('slides/') || rp.includes('/slide/') || name.endsWith('.png') || name.endsWith('.jpg'))
      return { stage: 'Slide Generation', icon: FileText, color: 'pink' };
    if (name.endsWith('.mp3') || name.endsWith('.wav'))
      return { stage: 'TTS Audio', icon: FileText, color: 'pink' };
    if (name.endsWith('.mp4'))
      return { stage: 'Video Assembly', icon: FileText, color: 'pink' };
    return { stage: 'Slide Generation', icon: FileText, color: 'pink' };
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
  if (relativePath?.startsWith('Research/') || relativePath?.startsWith('Survey/'))
    return { stage: 'Literature Survey', icon: BookOpen, color: 'sky' };
  return { stage: 'Other', icon: FileText, color: 'gray' };
}

const BADGE_COLORS = {
  sky: 'bg-muted text-muted-foreground',
  blue: 'bg-muted text-muted-foreground',
  amber: 'bg-muted text-muted-foreground',
  rose: 'bg-muted text-muted-foreground',
  indigo: 'bg-muted text-muted-foreground',
  green: 'bg-muted text-muted-foreground',
  cyan: 'bg-muted text-muted-foreground',
  purple: 'bg-muted text-muted-foreground',
  orange: 'bg-muted text-muted-foreground',
  yellow: 'bg-muted text-muted-foreground',
  teal: 'bg-muted text-muted-foreground',
  gray: 'bg-muted text-muted-foreground',
  pink: 'bg-muted text-muted-foreground',
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
const PRESENTATION_STAGES = new Set(['Homepage Delivery', 'Slide Generation', 'TTS Audio', 'Video Assembly']);
const DEFAULT_RESEARCH_BRIEF_FILENAME = 'research_brief.json';
const DEFAULT_RESEARCH_BRIEF_PATH = '.pipeline/docs/research_brief.json';
const DEFAULT_TASKS_FILENAME = 'tasks.json';
const TASK_STAGE_ORDER = ['survey', 'ideation', 'experiment', 'publication', 'promotion', 'unassigned'];
const TASK_STAGE_META = {
  survey: { label: 'Survey', className: 'bg-muted text-muted-foreground' },
  ideation: { label: 'Ideation', className: 'bg-muted text-muted-foreground' },
  experiment: { label: 'Experiment', className: 'bg-muted text-muted-foreground' },
  publication: { label: 'Publication', className: 'bg-muted text-muted-foreground' },
  promotion: { label: 'Promotion', className: 'bg-muted text-muted-foreground' },
  unassigned: { label: 'Unassigned', className: 'bg-muted text-muted-foreground' },
};
const TASK_STATUS_META = {
  pending: { label: 'Pending', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  'in-progress': { label: 'In Progress', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  done: { label: 'Done', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  review: { label: 'Review', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  deferred: { label: 'Deferred', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};
const SESSION_TAG_SOURCE_META = {
  manual: { label: 'Manual', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  task_context: { label: 'Task Context', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  auto_research: { label: 'Auto Research', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  chat_context: { label: 'Chat Context', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
  inferred: { label: 'Inferred', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' }, // Reserved for future ML-based tag inference
  unknown: { label: 'Tagged', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
};
const ARTIFACT_STAGE_ORDER = [
  'Literature Survey',
  'Gap Analysis',
  'Data Loading',
  'Prepare',
  'Idea Generation',
  'Medical Expert',
  'Engineering Expert',
  'Repo Acquisition',
  'Code Survey',
  'Implementation Plan',
  'ML Development',
  'Judge',
  'Experiment Analysis',
  'Paper Writing',
  'Homepage Delivery',
  'Slide Generation',
  'TTS Audio',
  'Video Assembly',
  'Other',
];

const PIPELINE_STAGE_KEYS = TASK_STAGE_ORDER.filter((stage) => stage !== 'unassigned');

const OVERVIEW_MARKDOWN_COMPONENTS = {
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
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeString(value) {
  return isNonEmptyString(value) ? value.trim() : '';
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value) => isNonEmptyString(value))
    .map((value) => value.trim());
}

function toMarkdownList(values) {
  return normalizeStringList(values)
    .map((value) => `- ${value}`)
    .join('\n');
}

function formatStageLabel(stage) {
  const normalized = normalizeString(stage);
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildOverviewSections(researchBrief, instance) {
  const overviewSections = [];
  const briefSections = researchBrief?.sections || {};

  const appendSection = (label, value) => {
    if (Array.isArray(value)) {
      const content = toMarkdownList(value);
      if (content) overviewSections.push({ label, content });
      return;
    }

    const content = normalizeString(value);
    if (content) overviewSections.push({ label, content });
  };

  appendSection('Research Goal', briefSections.ideation?.research_goal);
  appendSection('Problem Framing', briefSections.ideation?.problem_framing);
  appendSection('Survey Summary', briefSections.survey?.synthesis_summary);
  appendSection('Open Gaps', briefSections.survey?.open_gaps);
  appendSection('Evidence Plan', briefSections.ideation?.evidence_plan);
  appendSection('Success Criteria', briefSections.ideation?.success_criteria);
  appendSection('Hypothesis / Validation Goal', briefSections.experiment?.hypothesis_or_validation_goal);
  appendSection('Method / Protocol', briefSections.experiment?.method_or_protocol);
  appendSection('Evaluation Plan', briefSections.experiment?.evaluation_plan);
  appendSection('Paper Outline', briefSections.publication?.paper_outline);
  appendSection('Figures / Tables Plan', briefSections.publication?.figures_tables_plan);
  appendSection('Artifact Plan', briefSections.publication?.artifact_plan);

  if (overviewSections.length > 0) return overviewSections;

  const legacyTask = normalizeString(instance?.task2 || instance?.task1 || instance?.ideas);
  return legacyTask ? [{ label: 'Task Description', content: legacyTask, isLegacy: true }] : [];
}

function normalizeTask(task) {
  return {
    ...task,
    stage: task?.stage === 'presentation'
      ? 'promotion'
      : task?.stage === 'research'
        ? 'survey'
        : (TASK_STAGE_META[task?.stage] ? task.stage : 'unassigned'),
    status: TASK_STATUS_META[task?.status] ? task.status : 'pending',
  };
}

function normalizeTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map(normalizeTask);
}

function getArtifactPipelineStage(stage) {
  if (stage === 'Literature Survey' || stage === 'Gap Analysis') return 'survey';
  if (IDEATION_STAGES.has(stage)) return 'ideation';
  if (EXPERIMENT_STAGES.has(stage)) return 'experiment';
  if (PUBLICATION_STAGES.has(stage)) return 'publication';
  if (PRESENTATION_STAGES.has(stage)) return 'promotion';
  return 'unassigned';
}

function buildTaskSummary(tasks) {
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === 'done').length;
  const inProgress = tasks.filter((task) => task.status === 'in-progress').length;
  const pending = tasks.filter((task) => task.status === 'pending').length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return { total, done, inProgress, pending, progress };
}

function buildPipelineStageOverview(tasks, artifacts) {
  const stages = PIPELINE_STAGE_KEYS.reduce((acc, stage) => {
    acc[stage] = {
      key: stage,
      meta: TASK_STAGE_META[stage],
      total: 0,
      done: 0,
      inProgress: 0,
      pending: 0,
      artifacts: 0,
    };
    return acc;
  }, {});

  tasks.forEach((task) => {
    const bucket = stages[task.stage];
    if (!bucket) return;
    bucket.total += 1;
    if (task.status === 'done') bucket.done += 1;
    if (task.status === 'in-progress') bucket.inProgress += 1;
    if (task.status === 'pending') bucket.pending += 1;
  });

  artifacts.forEach((artifact) => {
    const stage = classifyArtifact(artifact.name, artifact.relativePath).stage;
    const bucket = stages[getArtifactPipelineStage(stage)];
    if (!bucket) return;
    bucket.artifacts += 1;
  });

  return PIPELINE_STAGE_KEYS.map((stage) => stages[stage]);
}

function getNextTask(tasks) {
  return tasks.find((task) => task.status === 'in-progress')
    ?? tasks.find((task) => task.status === 'pending')
    ?? null;
}

function getSourcePapers(instance, researchBrief) {
  const papers = Array.isArray(instance?.source_papers) && instance.source_papers.length > 0
    ? instance.source_papers
    : normalizeStringList(researchBrief?.sections?.survey?.key_references);

  if (!Array.isArray(papers) || papers.length === 0) {
    return [];
  }

  return papers
    .map((paper, index) => {
      if (typeof paper === 'string') {
        return { reference: paper, rank: index + 1 };
      }
      if (paper && typeof paper === 'object') {
        return {
          rank: paper.rank ?? index + 1,
          reference: paper.reference || paper.title || paper.url || `Paper ${index + 1}`,
          type: paper.type,
          url: paper.url,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function ResearchMetricCard({ icon: Icon, label, value, detail, compact = false }) {
  const { t } = useTranslation('common');
  return <div className="min-w-0 py-2">
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4 shrink-0" />{label}</div>
    <div className={compact ? 'mt-1 text-lg font-semibold' : 'mt-2 text-xl font-semibold'}>{value}</div>
    {detail && <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>}
  </div>;
}

function PipelineStageChip({ stage, compact = false }) {
  const { t } = useTranslation('common');
  const tone = 'border-border bg-background';

  const summaryLabel = stage.total > 0
    ? `${stage.done}/${stage.total}`
    : stage.artifacts > 0
      ? t('researchLabUI.artifactsOnly')
      : t('researchLabUI.waiting');

  if (compact) {
    return (
      <div className={`min-w-0 rounded-lg border px-2 py-1.5 ${tone}`}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-1.5 gap-y-1">
          <span className={`inline-flex min-w-0 items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${stage.meta.className}`}>
            <span className="truncate">{t(`researchLabLabels.${stage.meta.label}`, { defaultValue: stage.meta.label })}</span>
          </span>
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{summaryLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border px-3 py-3  ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${stage.meta.className}`}>
          {t(`researchLabLabels.${stage.meta.label}`, { defaultValue: stage.meta.label })}
        </span>
        <span className="text-xs text-muted-foreground">{summaryLabel}</span>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{stage.total} {t('researchLabUI.tasks')}</span>
        <span>{stage.artifacts} {t('researchLabUI.artifacts')}</span>
      </div>
    </div>
  );
}

function sortArtifactsByStageAndPath(files) {
  const rank = new Map(ARTIFACT_STAGE_ORDER.map((stage, index) => [stage, index]));
  return [...files].sort((left, right) => {
    const leftStage = classifyArtifact(left.name, left.relativePath).stage;
    const rightStage = classifyArtifact(right.name, right.relativePath).stage;
    const leftRank = rank.get(leftStage) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(rightStage) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.relativePath.localeCompare(right.relativePath);
  });
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);
const UNSUPPORTED_BINARY_EXTENSIONS = new Set([
  'zip', 'gz', 'tar', 'tgz', '7z', 'rar',
  'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx',
  'bin', 'npy', 'npz', 'pkl', 'pt', 'pth', 'ckpt', 'onnx',
]);

function getArtifactPreviewKind(file) {
  const name = file?.name || file?.relativePath || '';
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

  if (extension === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  if (UNSUPPORTED_BINARY_EXTENSIONS.has(extension)) return 'unsupported';
  return 'text';
}

/* ------------------------------------------------------------------ */
/*  Sub-components (cards)                                             */
/* ------------------------------------------------------------------ */

/** Overview card: title, brief summary, and instance metadata */
function OverviewCard({ instance, config, researchBrief, compact = false }) {
  const { t } = useTranslation('common');
  const [showOverviewModal, setShowOverviewModal] = useState(false);
  const [collapsed, setCollapsed] = useState(compact);
  const overviewSections = useMemo(
    () => buildOverviewSections(researchBrief, instance),
    [researchBrief, instance],
  );
  const briefMeta = researchBrief?.meta || {};
  const overviewTitle = normalizeString(briefMeta.title);
  const targetPaper = normalizeString(instance?.target);
  const instanceLabel = normalizeString(instance?.instance_id || instance?.instance_path?.split('/').pop());
  const metadata = [
    { label: 'Start Stage', value: formatStageLabel(researchBrief?.pipeline?.startStage) },
    { label: 'Target Venue', value: normalizeString(briefMeta.target_venue) },
    { label: 'Lead Author', value: normalizeString(briefMeta.lead_author) },
    { label: 'Date', value: normalizeString(briefMeta.date) },
    { label: 'Instance', value: instanceLabel },
    { label: 'Category', value: normalizeString(config?.category) },
  ].filter((item) => item.value);
  const hasDetailedContent = overviewSections.length > 0;
  const overviewSummary = hasDetailedContent
    ? overviewSections.length === 1
      ? t('researchLabUI.briefCount', { count: 1 })
      : t('researchLabUI.briefCount', { count: overviewSections.length })
    : '';
  const showTargetPaper = targetPaper && targetPaper !== overviewTitle;
  const hasOverviewContent = Boolean(
    overviewTitle
    || showTargetPaper
    || metadata.length > 0
    || hasDetailedContent
  );

  return (
    <>
      <div className={`flex h-full flex-col border border-border/60 bg-card   ${compact ? 'gap-2 rounded-lg p-3 border-l-2 border-l-border dark:border-l-border' : 'gap-4 rounded-lg p-5'}`}>
        <button type="button" onClick={() => setCollapsed(v => !v)} aria-expanded={!collapsed} className="flex w-full items-center justify-between gap-2 text-left">
          <div className="flex items-center gap-2.5">
            {compact ? (
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground">
                <FlaskConical className="w-3.5 h-3.5" />
              </div>
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground">
                <FlaskConical className="w-5 h-5" />
              </div>
            )}
            <h3 className={`font-semibold tracking-tight text-foreground ${compact ? 'text-sm' : 'text-base'}`}>
              {t('researchLabUI.overview')}
            </h3>
            {!compact && <p className="hidden text-xs text-muted-foreground sm:block">{t('researchLabUI.overviewHint')}</p>}
          </div>
          <div className="flex items-center gap-2">
            {compact && metadata.length > 0 && (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground">{metadata.length}</span>
            )}
            {collapsed ? <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
          </div>
        </button>
        {!collapsed && overviewTitle && (
          <div className="rounded-lg border border-border/60 bg-background p-4">
            <p className="text-xs  text-muted-foreground">{t('researchLabUI.title')}</p>
            <p className="mt-2 text-sm font-medium text-foreground">{overviewTitle}</p>
            {instance?.url && !showTargetPaper ? (
              <a href={instance.url} target="_blank" rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline dark:text-muted-foreground">
                {instance.url} <ExternalLink className="w-3 h-3" />
              </a>
            ) : null}
          </div>
        )}
        {!collapsed && showTargetPaper && (
          <div className={`rounded-lg border border-border/60 bg-background  ${compact ? 'p-2.5' : 'p-4'}`}>
            <p className="text-xs  text-muted-foreground">{t('researchLabUI.targetPaper')}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{targetPaper}</p>
            {instance?.url && (
              <a href={instance.url} target="_blank" rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline dark:text-muted-foreground">
                {instance.url} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
        {!collapsed && metadata.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {metadata.map((item) => (
              <span key={t(`researchLabLabels.${item.label}`, { defaultValue: item.label })} className="rounded-full border border-border/60 bg-background px-2 py-0.5">
                {t(`researchLabLabels.${item.label}`, { defaultValue: item.label })}: <code className="bg-muted px-1 rounded">{item.value}</code>
              </span>
            ))}
          </div>
        )}
        {!collapsed && hasDetailedContent && (
          <div className={`flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background  ${compact ? 'p-2.5' : 'p-4'}`}>
            <div className="min-w-0">
              <p className="text-xs  text-muted-foreground">{t('researchLabUI.brief')}</p>
              <p className="mt-1 text-sm text-foreground/80">
                {overviewSummary}
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0 rounded-full"
              onClick={() => setShowOverviewModal(true)}
            >
              <Maximize2 className="mr-1.5 h-4 w-4" />
              {t('researchLabUI.readBrief')}
            </Button>
          </div>
        )}
        {!collapsed && !hasOverviewContent && (
          <div className={`rounded-lg border border-dashed border-border/60 bg-background text-sm text-muted-foreground ${compact ? 'px-3 py-3' : 'px-4 py-5'}`}>
            {t('researchLabUI.startHint')}
          </div>
        )}
      </div>

      {showOverviewModal && <WorkbenchDialog title={t('researchLabUI.overview')} onClose={() => setShowOverviewModal(false)} size="wide">
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2">
                {(overviewTitle || showTargetPaper) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {overviewTitle ? (
                      <div className="border-b border-border py-4">
                        <p className="text-xs  text-muted-foreground">{t('researchLabUI.title')}</p>
                        <p className="mt-2 text-sm font-medium text-foreground">{overviewTitle}</p>
                      </div>
                    ) : null}
                    {showTargetPaper ? (
                      <div className="border-b border-border py-4">
                        <p className="text-xs  text-muted-foreground">{t('researchLabUI.targetPaper')}</p>
                        <p className="mt-2 text-sm font-medium text-foreground">{targetPaper}</p>
                        {instance?.url ? (
                          <a href={instance.url} target="_blank" rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline dark:text-muted-foreground">
                            {instance.url} <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
                {metadata.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {metadata.map((item) => (
                      <span key={t(`researchLabLabels.${item.label}`, { defaultValue: item.label })} className="rounded-full border border-border/60 bg-card px-3 py-1">
                        {t(`researchLabLabels.${item.label}`, { defaultValue: item.label })}: <code className="bg-muted px-1 rounded">{item.value}</code>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  {overviewSections.map((section) => (
                    <div key={t(`researchLabLabels.${section.label}`, { defaultValue: section.label })} className="border-b border-border py-4">
                      <p className="text-xs  text-muted-foreground">{t(`researchLabLabels.${section.label}`, { defaultValue: section.label })}</p>
                      <div className="mt-2 text-sm text-foreground/80 leading-relaxed markdown-body">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                          components={OVERVIEW_MARKDOWN_COMPONENTS}
                        >
                          {normalizeLatexDelimiters(section.content)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </ScrollArea>
      </WorkbenchDialog>}
    </>
  );
}

/** Source papers list */
function PapersCard({ papers, compact = false }) {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(compact);
  if (!papers || papers.length === 0) return null;
  const shown = expanded ? papers : papers.slice(0, compact ? 3 : 5);

  return (
    <div className={`flex h-full flex-col border border-border/60 bg-card   ${compact ? 'rounded-lg p-3 border-l-2 border-l-border dark:border-l-border' : 'rounded-lg p-5'}`}>
      <button type="button" onClick={() => setCollapsed(v => !v)} aria-expanded={!collapsed} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex items-center gap-2.5">
          {compact ? (
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground">
              <BookOpen className="w-5 h-5" />
            </div>
          )}
          <h3 className={`font-semibold tracking-tight text-foreground ${compact ? 'text-sm' : 'text-base'}`}>
            {t('researchLabUI.papers')}
          </h3>
          {!compact && <p className="text-xs text-muted-foreground">{t('researchLabUI.papersHint', { count: papers.length })}</p>}
        </div>
        <div className="flex items-center gap-2">
          {compact && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground">{papers.length}</span>
          )}
          {collapsed ? <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
        </div>
      </button>
      {!collapsed && <ul className={`flex-1 space-y-1.5 ${compact ? 'mt-2' : 'mt-4'}`}>
        {shown.map((p, i) => (
          <li key={i} className={`flex items-start gap-2 rounded-lg border border-border/60 bg-background text-sm  ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
            <span className="mt-0.5 w-6 flex-shrink-0 text-right text-xs text-muted-foreground">{p.rank || i + 1}.</span>
            <div className="min-w-0 flex-1">
              {p.url ? (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground hover:text-muted-foreground dark:hover:text-muted-foreground"
                >
                  <span>{p.reference}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <span className="text-foreground">{p.reference}</span>
              )}
              {p.type && (() => {
                const types = Array.isArray(p.type) ? p.type : [p.type];
                const label = types.join(', ');
                const cls = label.includes('methodolog') ? 'bg-muted text-muted-foreground dark:bg-blue-900/30 dark:text-muted-foreground' :
                  label.includes('component') ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
                return <span className={`ml-2 text-xs px-1.5 py-0 rounded ${cls}`}>{label}</span>;
              })()}
            </div>
          </li>
        ))}
      </ul>}
      {!collapsed && papers.length > (compact ? 3 : 5) && (
        <button onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:underline dark:text-muted-foreground">
          {expanded ? t('researchLabUI.showLess') : t('researchLabUI.showPapers', { count: papers.length })}
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}

function StageSection({ title, icon: Icon, badgeClass, expanded, onToggle, children }) {
  const { t } = useTranslation('common');
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
        <span className={`text-xs px-2 py-0.5 rounded-full ${badgeClass}`}>{t('researchLabUI.stage')}</span>
      </button>
      {expanded && <div className="space-y-3">{children}</div>}
    </div>
  );
}

function TaskPipelineBoard({ tasks, isLoading, onNavigateToChat, projectName, onTaskUpdated, loadError = false, compact = false }) {
  const { t } = useTranslation('common');
  const [boardCollapsed, setBoardCollapsed] = useState(compact);
  const [openStages, setOpenStages] = useState({});
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [addingToStage, setAddingToStage] = useState(null);
  const [addForm, setAddForm] = useState({ title: '', description: '' });
  const [addingTask, setAddingTask] = useState(false);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [taskError, setTaskError] = useState(null);

  // Clear all interaction state when project changes
  useEffect(() => {
    setTaskError(null);
    setEditingTaskId(null);
    setEditForm({ title: '', description: '' });
    setAddingToStage(null);
    setAddForm({ title: '', description: '' });
    setDeleteConfirmTask(null);
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
    setTaskError(null);
    try {
      const response = await api.taskmaster.updateTask(
        encodeURIComponent(projectName),
        editingTaskId,
        { title: editForm.title, description: editForm.description },
      );
      if (!response.ok) throw new Error('task');
      setEditingTaskId(null);
      setEditForm({ title: '', description: '' });
      if (onTaskUpdated) onTaskUpdated();
    } catch (e) {
      console.error('Failed to update task:', e);
      setTaskError(t('messages.operationFailed'));
    } finally {
      setSaving(false);
    }
  }, [editingTaskId, editForm, projectName, onTaskUpdated, t]);

  const handleAddTask = useCallback(async () => {
    if (!addForm.title.trim() || !projectName || !addingToStage) return;
    setAddingTask(true);
    setTaskError(null);
    try {
      const response = await api.taskmaster.addTask(
        encodeURIComponent(projectName),
        {
          title: addForm.title.trim(),
          description: addForm.description.trim() || addForm.title.trim(),
          priority: 'medium',
          stage: addingToStage.stage === 'unassigned' ? undefined : addingToStage.stage,
          insertAfterId: addingToStage.insertAfterId,
        },
      );
      if (!response.ok) throw new Error('task');
      setAddingToStage(null);
      setAddForm({ title: '', description: '' });
      if (onTaskUpdated) onTaskUpdated();
    } catch (e) {
      console.error('Failed to add task:', e);
      setTaskError(t('messages.operationFailed'));
    } finally {
      setAddingTask(false);
    }
  }, [addForm, addingToStage, projectName, onTaskUpdated, t]);

  const handleCancelAdd = useCallback(() => {
    setAddingToStage(null);
    setAddForm({ title: '', description: '' });
  }, []);

  const handleDeleteTask = useCallback(async () => {
    if (!deleteConfirmTask || !projectName) return;
    setDeletingTask(true);
    setTaskError(null);
    try {
      const response = await api.taskmaster.deleteTask(
        encodeURIComponent(projectName),
        String(deleteConfirmTask.id),
      );
      if (!response.ok) throw new Error('task');
      setDeleteConfirmTask(null);
      if (onTaskUpdated) onTaskUpdated();
    } catch (e) {
      console.error('Failed to delete task:', e);
      setTaskError(t('messages.operationFailed'));
    } finally {
      setDeletingTask(false);
    }
  }, [deleteConfirmTask, projectName, onTaskUpdated, t]);

  useEffect(() => {
    setOpenStages((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { survey: true, ideation: true, experiment: true, publication: true, promotion: true, unassigned: false };
    });
  }, [tasks]);

  const normalizedTasks = useMemo(() => normalizeTasks(tasks), [tasks]);

  const summary = useMemo(() => buildTaskSummary(normalizedTasks), [normalizedTasks]);

  const groupedTasks = useMemo(() => {
    const groups = {
      survey: [],
      ideation: [],
      experiment: [],
      publication: [],
      promotion: [],
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
    <div className={`overflow-hidden border border-border/60 bg-card   ${compact ? 'rounded-lg border-l-2 border-l-cyan-400 dark:border-l-cyan-600' : 'rounded-lg'}`}>
      <button type="button" onClick={() => setBoardCollapsed(v => !v)} aria-expanded={!boardCollapsed} className={`flex w-full items-center justify-between text-left ${compact ? 'px-3 py-2.5' : 'border-b border-border/60 bg-muted px-5 py-4   '}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {compact ? (
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground">
              <ListChecks className="w-3.5 h-3.5" />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/70 bg-white/85  dark:border-white/10 dark:bg-slate-800/80">
              <ListChecks className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
            </div>
          )}
          <h3 className={`font-semibold tracking-tight text-foreground ${compact ? 'text-sm' : 'text-base'}`}>
            {t('researchLabTaskBoard.title')}
          </h3>
          {!compact && <p className="hidden text-sm text-muted-foreground sm:block">{t('researchLabTaskBoard.description')}</p>}
        </div>
        <div className="flex items-center gap-2">
          {compact && summary.total > 0 && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground">{summary.total}</span>
          )}
          {boardCollapsed ? <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
        </div>
      </button>

      {taskError && !deleteConfirmTask && <p role="alert" className="px-4 py-3 text-sm text-red-700 dark:text-red-300">{taskError}</p>}
      {!boardCollapsed && <div className={`space-y-4 ${compact ? 'p-3' : 'p-3 sm:p-5'}`}>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t('status.loading')}</div>
        ) : summary.total === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {t(loadError ? 'workbench.loadError' : 'researchLabTaskBoard.empty')}
            </p>
            {onNavigateToChat && (
              <Button
                size="sm"
                className="text-primary-foreground bg-primary"
                onClick={() => onNavigateToChat()}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                {t('researchLabTaskBoard.goToChat')}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 border-b border-border pb-3 sm:grid-cols-4">
              {[["total", summary.total], ["done", summary.done], ["inProgress", summary.inProgress], ["pending", summary.pending]].map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t(`researchLabUI.${key}`)}</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>

            <div className="py-1">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Target className="w-3.5 h-3.5" /> {t('researchLabUI.progress')}</span>
                <span>{summary.progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-colors duration-300"
                  style={{ width: `${summary.progress}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              {TASK_STAGE_ORDER.map((stage) => {
                const stageTasks = groupedTasks[stage] || [];
                // Always show pipeline stages; hide unassigned when empty
                if (stage === 'unassigned' && stageTasks.length === 0) return null;
                const isOpen = openStages[stage] ?? true;
                const meta = TASK_STAGE_META[stage];

                const isAddingHere = (afterId) =>
                  addingToStage?.stage === stage && addingToStage?.insertAfterId === afterId;

                const renderInsertionPoint = (afterId, key) =>
                  isAddingHere(afterId) ? (
                    <div key={key} className="px-3 py-2 border-b border-border bg-muted/20">
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          className="w-full text-sm font-medium text-foreground bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          value={addForm.title}
                          onChange={(e) => setAddForm((prev) => ({ ...prev, title: e.target.value }))}
                          onKeyDown={(e) => {
                            if (!e.nativeEvent.isComposing && e.key === 'Enter') { e.preventDefault(); handleAddTask(); }
                            if (e.key === 'Escape') handleCancelAdd();
                          }}
                          disabled={addingTask}
                          autoFocus
                          aria-label={t('researchLabTaskBoard.taskTitlePlaceholder')} placeholder={t('researchLabTaskBoard.taskTitlePlaceholder')}
                        />
                        <textarea
                          className="w-full text-xs text-muted-foreground bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y min-h-[2.5rem]"
                          value={addForm.description}
                          onChange={(e) => setAddForm((prev) => ({ ...prev, description: e.target.value }))}
                          onKeyDown={(e) => {
                            if (!e.nativeEvent.isComposing && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddTask(); }
                            if (e.key === 'Escape') handleCancelAdd();
                          }}
                          disabled={addingTask}
                          rows={2}
                          aria-label={t('researchLabTaskBoard.taskDescriptionPlaceholder')} placeholder={t('researchLabTaskBoard.taskDescriptionPlaceholder')}
                        />
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" className="h-6 px-2 text-xs" onClick={handleAddTask} disabled={addingTask || !addForm.title.trim()}>
                            <Plus className="w-3 h-3 mr-1" />
                            {addingTask ? t('status.loading') : t('researchLabTaskBoard.addTask')}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCancelAdd} disabled={addingTask}>
                            {t('buttons.cancel')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={key} className="group/insert relative h-0">
                      <button
                        type="button"
                        onClick={() => setAddingToStage({ stage, insertAfterId: afterId })}
                        className="absolute inset-x-0 -top-2 -bottom-2 z-10 flex items-center justify-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
                      >
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground dark:text-muted-foreground">
                          <Plus className="w-3 h-3" />
                          <span className="text-xs">{t('researchLabUI.insert')}</span>
                        </div>
                      </button>
                    </div>
                  );

                return (
                  <div key={stage} className="border-t border-border bg-background pb-2">
                    <div className="flex items-center hover:bg-muted/30">
                      <button
                        type="button"
                        onClick={() => toggleStage(stage)}
                        className="flex-1 px-3 py-2 flex items-center gap-2 text-left"
                      >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className={`text-xs px-1.5 py-0.5 rounded ${meta.className}`}>{t(`workbench.stages.${stage}`, { defaultValue: meta.label })}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{stageTasks.length}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAddingToStage({ stage, insertAfterId: null }); if (!isOpen) toggleStage(stage); }}
                        className="p-1.5 mr-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title={t('researchLabTaskBoard.addTask')}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="border-t border-border/60 bg-background">
                        {/* Insertion point before first task */}
                        {renderInsertionPoint(null, `${stage}-insert-top`)}
                        {stageTasks.map((task) => {
                          const statusMeta = TASK_STATUS_META[task.status] || TASK_STATUS_META.pending;
                          const isFirstPendingTask = task.status === 'pending' && String(task.id) === firstPendingTaskId;
                          const isEditing = editingTaskId === String(task.id);
                          return (
                            <React.Fragment key={`${stage}-${task.id}`}>
                            <div
                              className={`group border-b border-border px-2 py-3 ${isEditing ? 'bg-muted/30' : 'hover:bg-muted/20'}`}
                              onDoubleClick={!isEditing ? () => handleDoubleClick(task) : undefined}
                              title={!isEditing ? t('researchLabTaskBoard.doubleClickToEdit') : undefined}
                            >
                              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
                                <span className="text-xs px-1.5 py-0.5 rounded-md bg-background border border-border text-muted-foreground mt-0.5">#{task.id}</span>
                                <div className="min-w-0 flex-1">
                                  {isEditing ? (
                                    <div className="space-y-1.5">
                                      <input
                                        type="text"
                                        className="w-full text-sm font-medium text-foreground bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                        value={editForm.title}
                                        onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                                        onKeyDown={(e) => {
                                          if (!e.nativeEvent.isComposing && e.key === 'Enter') { e.preventDefault(); handleSave(); }
                                          if (e.key === 'Escape') handleCancel();
                                        }}
                                        disabled={saving}
                                        autoFocus
                                        aria-label={t('researchLabTaskBoard.taskTitlePlaceholder')} placeholder={t('researchLabTaskBoard.taskTitlePlaceholder')}
                                      />
                                      <textarea
                                        className="w-full text-xs text-muted-foreground bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y min-h-[2.5rem]"
                                        value={editForm.description}
                                        onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                                        onKeyDown={(e) => {
                                          if (!e.nativeEvent.isComposing && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
                                          if (e.key === 'Escape') handleCancel();
                                        }}
                                        disabled={saving}
                                        rows={2}
                                        placeholder={t('researchLabTaskBoard.taskDescriptionPlaceholder')}
                                      />
                                      <div className="flex items-center gap-1.5">
                                        <Button
                                          size="sm"
                                          className="h-6 px-2 text-xs"
                                          onClick={handleSave}
                                          disabled={saving}
                                        >
                                          <Check className="w-3 h-3 mr-1" />
                                          {saving ? t('researchLabTaskBoard.saving') : t('buttons.save')}
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-2 text-xs"
                                          onClick={handleCancel}
                                          disabled={saving}
                                        >
                                          {t('buttons.cancel')}
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <p className="break-words text-sm font-semibold text-foreground line-clamp-2">{task.title || t('researchLabTaskBoard.untitledTask')}</p>
                                      {task.description && (
                                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>
                                      )}
                                      <p className="hidden text-xs text-muted-foreground mt-1 sm:inline-flex items-center gap-1">
                                        <PenTool className="w-3 h-3" />
                                        {t('researchLabTaskBoard.editHint')}
                                      </p>
                                    </>
                                  )}
                                  {!isEditing && Array.isArray(task.suggestedSkills) && task.suggestedSkills.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                      {task.suggestedSkills.slice(0, 3).map((skill) => (
                                        <span key={`${task.id}-${skill}`} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground">
                                          {skill}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {!isEditing && (
                                  <div className="col-start-2 flex flex-wrap items-start gap-2 lg:col-start-3 lg:flex-col lg:items-end">
                                    <div className="flex items-center gap-1">
                                      <span className={`text-xs px-1.5 py-0.5 rounded ${statusMeta.className}`}>{t(`researchLabTaskBoard.states.${task.status}`, { defaultValue: statusMeta.label })}</span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs border border-border/70 hover:border-border"
                                        onClick={() => handleDoubleClick(task)}
                                      >
                                        <PenTool className="w-3 h-3 mr-1" />
                                        {t('buttons.edit')}
                                      </Button>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmTask(task); }}
                                        className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 opacity-100 transition-opacity"
                                        title={t('researchLabTaskBoard.deleteTitle')}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                    {isFirstPendingTask && onNavigateToChat && (
                                      <div className="mt-0.5 inline-flex flex-wrap items-center gap-2">
                                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 ">
                                          {t('researchLabTaskBoard.next')}
                                        </span>
                                        <Button
                                          size="sm"
                                          className="h-7 px-2.5 text-xs font-semibold text-primary-foreground bg-primary         transition-colors"
                                          onClick={() => onNavigateToChat()}
                                        >
                                          <Sparkles className="w-3 h-3 mr-1.5" />
                                          <MessageSquare className="w-3 h-3 mr-1" />
                                          {t('researchLabTaskBoard.goToChat')}
                                        </Button>
                                      </div>
                                    )}
                                    {task.status === 'in-progress' && (
                                      <span className="text-xs text-blue-600 dark:text-blue-300 inline-flex items-center gap-1">
                                        <Clock3 className="w-3 h-3" />
                                        {t('workbench.running')}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                              {/* Insertion point after this task */}
                              {renderInsertionPoint(task.id, `${stage}-insert-after-${task.id}`)}
                            </React.Fragment>
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
      </div>}

      {deleteConfirmTask && <WorkbenchDialog title={t('researchLabTaskBoard.deleteTitle')} onClose={() => { if (!deletingTask) setDeleteConfirmTask(null); }}>
        <p className="break-words text-sm">{t('researchLabTaskBoard.deleteConfirm', { title: `#${deleteConfirmTask.id} ${deleteConfirmTask.title}` })}</p>
        {taskError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{taskError}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteConfirmTask(null)} disabled={deletingTask}>{t('buttons.cancel')}</Button>
          <Button variant="destructive" onClick={handleDeleteTask} disabled={deletingTask}>{t(deletingTask ? 'status.loading' : 'buttons.delete')}</Button>
        </div>
      </WorkbenchDialog>}

    </div>
  );
}

function getSessionStageTags(sessionTags = []) {
  return (Array.isArray(sessionTags) ? sessionTags : []).filter(
    (tag) => tag?.tagType === 'stage'
  );
}

function getSessionTagSourceMeta(source) {
  return SESSION_TAG_SOURCE_META[source] || SESSION_TAG_SOURCE_META.unknown;
}

function getResearchLabSessionName(session) {
  if (!session) return 'Session';
  if (session.__provider === 'cursor') {
    return normalizeString(session.name) || 'Untitled Session';
  }
  if (session.__provider === 'codex') {
    return normalizeString(session.summary || session.name) || 'Codex Session';
  }
  if (session.__provider === 'gemini') {
    return normalizeString(session.summary || session.name) || 'Gemini Session';
  }
  return normalizeString(session.summary || session.name) || 'New Session';
}

function getResearchLabSessionTime(session) {
  return normalizeString(
    session?.lastActivity || session?.createdAt || session?.created_at || session?.updated_at || ''
  );
}

function SessionStageBoard({
  projectTags,
  sessions,
  sessionTagsById,
  savingSessionId,
  onToggleStageTag,
  compact = false,
}) {
  const { t } = useTranslation('common');
  const [sessionBoardCollapsed, setSessionBoardCollapsed] = useState(compact);
  const stageTags = useMemo(() => {
    const tags = (Array.isArray(projectTags) ? projectTags : []).filter(
      (tag) => tag?.tagType === 'stage'
    );
    const byKey = new Map(tags.map((tag) => [tag.tagKey, tag]));
    return PIPELINE_STAGE_KEYS.map((stageKey) => byKey.get(stageKey)).filter(Boolean);
  }, [projectTags]);

  const stageCounts = useMemo(() => {
    const counts = {};
    stageTags.forEach((tag) => {
      counts[tag.tagKey] = 0;
    });

    sessions.forEach((session) => {
      const sessionStageTags = getSessionStageTags(sessionTagsById[session.id] || session.tags);
      const stageKeys = new Set(sessionStageTags.map((tag) => tag.tagKey).filter(Boolean));
      stageKeys.forEach((stageKey) => {
        if (Object.prototype.hasOwnProperty.call(counts, stageKey)) {
          counts[stageKey] += 1;
        }
      });
    });

    return counts;
  }, [sessions, sessionTagsById, stageTags]);

  if (sessions.length === 0) {
    return (
      <div className={`border border-border/60 bg-card   ${compact ? 'rounded-lg p-3 border-l-2 border-l-border dark:border-l-border' : 'rounded-lg p-5'}`}>
        <button type="button" onClick={() => setSessionBoardCollapsed(v => !v)} aria-expanded={!sessionBoardCollapsed} className="flex w-full items-center justify-between gap-2 text-left">
          <div className="flex items-center gap-2.5">
            {compact ? (
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground">
                <GitBranch className="w-3.5 h-3.5" />
              </div>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground">
                <GitBranch className="w-5 h-5" />
              </div>
            )}
            <h3 className={`font-semibold tracking-tight text-foreground ${compact ? 'text-sm' : 'text-base'}`}>{t('researchLabUI.sessionStages')}</h3>
          </div>
          {sessionBoardCollapsed ? <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
        </button>
        {!sessionBoardCollapsed && (
          <div className={`rounded-lg border border-dashed border-border/60 bg-background text-sm text-muted-foreground ${compact ? 'mt-2 px-3 py-3' : 'mt-4 px-4 py-5'}`}>
            {t('researchLabUI.noSessions')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`border border-border/60 bg-card   ${compact ? 'rounded-lg p-3 border-l-2 border-l-border dark:border-l-border' : 'rounded-lg p-5'}`}>
      <button type="button" onClick={() => setSessionBoardCollapsed(v => !v)} aria-expanded={!sessionBoardCollapsed} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex items-center gap-2.5">
          {compact ? (
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground">
              <GitBranch className="w-3.5 h-3.5" />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground">
              <GitBranch className="w-5 h-5" />
            </div>
          )}
          <h3 className={`font-semibold tracking-tight text-foreground ${compact ? 'text-sm' : 'text-base'}`}>{t('researchLabUI.sessionStages')}</h3>
        </div>
        <div className="flex items-center gap-2">
          {compact && sessions.length > 0 && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground">{sessions.length}</span>
          )}
          {sessionBoardCollapsed ? <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
        </div>
      </button>

      {!sessionBoardCollapsed && <div className={`mt-3 grid gap-2 ${compact ? 'grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-5'}`}>
        {stageTags.map((tag) => {
          const stageKey = tag.tagKey;
          const meta = TASK_STAGE_META[stageKey] || TASK_STAGE_META.unassigned;
          return (
            <div key={tag.id} className="rounded-lg border border-border/60 bg-background px-3 py-3">
              <div className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
                {t(`workbench.stages.${tag.tagKey}`, { defaultValue: tag.label })}
              </div>
              <div className="mt-2 text-sm font-semibold text-foreground">{stageCounts[stageKey] || 0}</div>
              <div className="text-xs text-muted-foreground">{t('researchLabUI.linkedSessions')}</div>
            </div>
          );
        })}
      </div>}

      {!sessionBoardCollapsed && <div className={`space-y-2 ${compact ? 'mt-2' : 'mt-4'}`}>
        {sessions.map((session) => {
          const currentTags = sessionTagsById[session.id] || session.tags || [];
          const selectedStageTagIds = new Set(getSessionStageTags(currentTags).map((tag) => tag.id));
          const selectedStageTags = getSessionStageTags(currentTags);
          const sessionName = getResearchLabSessionName(session);
          const isSaving = savingSessionId === session.id;

          return (
            <div key={`${session.__provider}-${session.id}`} className="rounded-lg border border-border/60 bg-background p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{sessionName}</span>
                    <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {session.__provider || 'claude'}
                    </span>
                    {session.mode ? (
                      <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {session.mode === 'workspace_qa' ? t('researchLabUI.workspaceQA') : t('researchLabUI.research')}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {getResearchLabSessionTime(session) || t('researchLabUI.noTimestamp')}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {stageTags.map((tag) => {
                    const stageKey = tag.tagKey;
                    const meta = TASK_STAGE_META[stageKey] || TASK_STAGE_META.unassigned;
                    const isSelected = selectedStageTagIds.has(tag.id);
                    return (
                      <button
                        key={`${session.id}-${tag.id}`}
                        type="button"
                        onClick={() => onToggleStageTag(session, tag)}
                        disabled={isSaving}
                        aria-pressed={isSelected}
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                          isSelected
                            ? meta.className
                            : 'border-border/70 bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                        } ${isSaving ? 'cursor-wait opacity-70' : ''}`}
                      >
                        {t(`workbench.stages.${tag.tagKey}`, { defaultValue: tag.label })}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {selectedStageTags.length > 0 ? selectedStageTags.map((tag) => {
                  const stageKey = tag.tagKey;
                  const stageMeta = TASK_STAGE_META[stageKey] || TASK_STAGE_META.unassigned;
                  const sourceMeta = getSessionTagSourceMeta(tag.source);
                  return (
                    <div
                      key={`selected-${session.id}-${tag.id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-1.5 py-1"
                    >
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageMeta.className}`}>
                        {t(`workbench.stages.${tag.tagKey}`, { defaultValue: tag.label })}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sourceMeta.className}`}>
                        {t(`researchLabLabels.${sourceMeta.label}`, { defaultValue: sourceMeta.label })}
                      </span>
                    </div>
                  );
                }) : (
                  <div className="text-xs text-muted-foreground">
                    {t('researchLabUI.noTags')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}

/** Research artifacts grouped by pipeline stage */
function ArtifactsCard({ artifacts, onSelect, selectedPath, compact = false }) {
  const { t } = useTranslation('common');
  const [openStages, setOpenStages] = useState({});
  const [cardCollapsed, setCardCollapsed] = useState(compact);

  // Group by stage
  const groups = {};
  for (const a of artifacts) {
    const info = classifyArtifact(a.name, a.relativePath);
    if (!groups[info.stage]) groups[info.stage] = { ...info, files: [] };
    groups[info.stage].files.push(a);
  }
  const sorted = [
    ...ARTIFACT_STAGE_ORDER.filter((stage) => groups[stage]).map((stage) => ({ stage, ...groups[stage] })),
    ...Object.keys(groups)
      .filter((stage) => !ARTIFACT_STAGE_ORDER.includes(stage))
      .sort((left, right) => left.localeCompare(right))
      .map((stage) => ({ stage, ...groups[stage] })),
  ];

  const toggle = (stage, defaultOpen) => setOpenStages(prev => ({ ...prev, [stage]: !(prev[stage] ?? defaultOpen) }));

  return (
    <div className={`border border-border/60 bg-card   ${compact ? 'rounded-lg p-3 border-l-2 border-l-border dark:border-l-border' : 'rounded-lg p-5'}`}>
      <button type="button" onClick={() => setCardCollapsed(v => !v)} aria-expanded={!cardCollapsed} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex items-center gap-2.5">
          {compact ? (
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground">
              <Beaker className="w-3.5 h-3.5" />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground">
              <Beaker className="w-5 h-5" />
            </div>
          )}
          <h3 className={`font-semibold tracking-tight text-foreground ${compact ? 'text-sm' : 'text-base'}`}>
            {t('researchLabUI.artifactsExplorer')}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium  ${compact ? 'border border-border bg-muted text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground' : 'border border-border/60 bg-background text-xs text-muted-foreground'}`}>
            {artifacts.length}
          </span>
          {cardCollapsed ? <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
        </div>
      </button>
      {cardCollapsed ? null : artifacts.length === 0 ? (
        <div className={`rounded-lg border border-dashed border-border/60 bg-background text-xs text-muted-foreground ${compact ? 'mt-2 px-3 py-3' : 'px-4 py-5'}`}>
          {t('researchLabUI.noArtifacts')}
        </div>
      ) : (
        <div className={`space-y-2 overflow-y-auto pr-1 ${compact ? 'mt-2 max-h-[200px]' : 'max-h-[360px]'}`}>
          {sorted.map(g => {
            const Icon = g.icon;
            const isStageSelected = g.files.some((file) => file.relativePath === selectedPath);
            const defaultOpen = isStageSelected || (!selectedPath && sorted[0]?.stage === g.stage);
            const isOpen = openStages[g.stage] ?? defaultOpen;
            return (
              <div key={t(`researchLabLabels.${g.stage}`, { defaultValue: g.stage })} className="overflow-hidden rounded-lg border border-border/60 bg-background">
                <button onClick={() => toggle(g.stage, defaultOpen)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/30">
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-background">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="font-medium text-foreground">{t(`researchLabLabels.${g.stage}`, { defaultValue: g.stage })}</span>
                  <span className={`ml-auto text-xs px-1.5 py-0 rounded ${BADGE_COLORS[g.color]}`}>
                    {g.files.length}
                  </span>
                </button>
                {isOpen && (
                  <ul className="mx-3 mb-3 border-l border-border pl-3 space-y-1">
                    {g.files.map(f => (
                      <li key={f.relativePath}>
                        <button onClick={() => onSelect(f)}
                          className={`flex w-full items-center gap-1.5 truncate rounded-lg px-3 py-2 text-left text-xs ${
                            selectedPath === f.relativePath
                              ? 'bg-muted text-blue-800  dark:bg-blue-900/40 dark:text-blue-200'
                              : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
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
      )}
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
    <a href={href} className="text-muted-foreground dark:text-muted-foreground hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>
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
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
};

/** Markdown component overrides */
const markdownComponents = {
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-blue-300 dark:border-blue-600 pl-3 italic text-foreground/70 my-2 text-sm">{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-muted-foreground dark:text-muted-foreground hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>
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
function IdeaCard({ projectName, config, projectFileSet, compact = false }) {
  const { t } = useTranslation('common');
  const [ideaText, setIdeaText] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!compact);
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
    <div className={`overflow-hidden border border-border/60 bg-card   ${compact ? 'rounded-lg border-l-2 border-l-border dark:border-l-border' : 'rounded-lg'}`}>
      {/* Header */}
      <button
        type="button"
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between text-left transition-colors hover:bg-muted/30 ${compact ? 'px-3 py-2.5' : 'border-b border-border/60 bg-muted px-5 py-4   '}`}
        onClick={() => setExpanded(!expanded)}
      >
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          {compact ? (
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
              <Lightbulb className="w-3.5 h-3.5" />
            </div>
          ) : (
            <Sparkles className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          )}
          {t('researchLabUI.idea')}
        </h3>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            title={t('researchLabUI.copy')}
          >
            {copied
              ? <Check className="w-3.5 h-3.5 text-green-600" />
              : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
          </Button>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? '' : '-rotate-90'}`} />
        </div>
      </button>

      {/* Body — markdown rendered */}
      {expanded && (
        <div className={`overflow-y-auto ${compact ? 'max-h-[300px] px-3 py-3' : 'max-h-[600px] px-5 py-4'}`}>
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={ideaMarkdownComponents}
          >
            {normalizeLatexDelimiters(ideaText)}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/** Paper (main.pdf) viewer — shows Publication/paper/main.pdf when present */
function PaperCard({ projectName, projectRoot, compact = false }) {
  const { t } = useTranslation('common');
  const [pdfUrl, setPdfUrl] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'loaded' | 'not_found' | 'error'
  const [expanded, setExpanded] = useState(!compact);

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
    <div className={`overflow-hidden border border-border/60 bg-card   ${compact ? 'rounded-lg border-l-2 border-l-border dark:border-l-border' : 'rounded-lg'}`}>
      <button
        type="button"
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between text-left transition-colors hover:bg-muted/30 ${compact ? 'px-3 py-2.5' : 'border-b border-border/60 bg-muted px-5 py-4   '}`}
        onClick={() => setExpanded(!expanded)}
      >
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          {compact ? (
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground">
              <PenTool className="w-3.5 h-3.5" />
            </div>
          ) : (
            <PenTool className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
          )}
          {t('researchLabUI.paper')}
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
            {t('researchLabUI.openTab')}
          </Button>
        )}
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 ml-2 transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>
      {expanded && (
        <div className="border-t border-border">
          {status === 'loading' && (
            <div className="p-6 text-center text-sm text-muted-foreground">{t('researchLabUI.loadingPaper')}</div>
          )}
          {status === 'loaded' && pdfUrl && (
            <div className="relative w-full" style={{ minHeight: '60vh' }}>
              <iframe
                title={t('researchLabUI.paper')}
                src={pdfUrl}
                className="w-full border-0 rounded-b-lg"
                style={{ height: '70vh' }}
              />
            </div>
          )}
          {status === 'not_found' && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <p>{t('researchLabUI.missingPaper')}</p>
              <p className="mt-1">{t('researchLabUI.paperHint')}</p>
            </div>
          )}
          {status === 'error' && (
            <div className="p-6 text-center text-sm text-destructive">
              {t('researchLabUI.paperError')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** File viewer / editor panel */
function FileViewer({ projectName, file, onClose }) {
  const { t } = useTranslation('common');
  const [content, setContent] = useState('');
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [viewMode, setViewMode] = useState('preview');
  const [showExpandedPreview, setShowExpandedPreview] = useState(false);
  const previewKind = useMemo(() => getArtifactPreviewKind(file), [file]);
  const isPreviewRenderable = previewKind === 'markdown' || previewKind === 'html' || previewKind === 'json';
  const isTextEditable = previewKind === 'text' || previewKind === 'markdown' || previewKind === 'html' || previewKind === 'json';
  const supportsBlobPreview = previewKind === 'pdf' || previewKind === 'image' || previewKind === 'audio' || previewKind === 'video';
  const canExpandPreview = previewKind !== 'unsupported';
  const viewerHeight = previewKind === 'pdf'
    ? '78vh'
    : previewKind === 'video'
      ? '32rem'
      : previewKind === 'image'
        ? '30rem'
        : previewKind === 'markdown' || previewKind === 'html' || previewKind === 'json'
          ? '48rem'
          : '28rem';

  useEffect(() => {
    setViewMode(isPreviewRenderable ? 'preview' : 'edit');
  }, [file?.relativePath, isPreviewRenderable]);

  useEffect(() => {
    setShowExpandedPreview(false);
  }, [file?.relativePath]);

  useEffect(() => {
    if (!showExpandedPreview) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowExpandedPreview(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showExpandedPreview]);

  useEffect(() => {
    if (!file) return;
    let objectUrl = null;
    let cancelled = false;

    setLoading(true);
    setDirty(false);
    setSaveStatus(null);
    setLoadError(null);
    setContent('');
    setBlobUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });

    const loadPreview = async () => {
      try {
        if (supportsBlobPreview) {
          const absolutePath = file.path || file.absolutePath;
          if (!absolutePath) {
            throw new Error('Missing absolute path for binary preview.');
          }

          const blob = await api.getFileContentBlob(projectName, absolutePath);
          if (cancelled) return;

          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
          return;
        }

        if (previewKind === 'unsupported') {
          return;
        }

        const response = await api.readFile(projectName, file.relativePath);
        if (!response?.ok) {
          throw new Error(`Failed to load file: ${response?.status || 'unknown error'}`);
        }

        const rawText = await response.text();
        if (cancelled) return;

        if (!rawText) {
          setContent('');
          return;
        }

        try {
          const data = JSON.parse(rawText);
          setContent(data?.content ?? '');
        } catch {
          // Fallback for non-JSON responses.
          setContent(rawText);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error?.message || t('researchLabUI.previewFailed'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectName, file, previewKind, supportsBlobPreview]);

  const handleSave = async () => {
    if (!file || !isTextEditable) return;
    setSaveStatus('saving');
    try {
      const response = await api.saveFile(projectName, file.relativePath, content);
      if (!response.ok) throw new Error('Save failed');
      setDirty(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setSaveStatus('error');

    }
  };

  const renderPreviewContent = (expanded = false) => {
    if (loading) {
      return <div className="flex-1 min-h-0 p-4 text-sm text-muted-foreground">{t('researchLabUI.loading')}</div>;
    }

    if (loadError) {
      return (
        <div className="flex-1 min-h-0 p-4 text-sm text-destructive">
          {t('researchLabUI.previewFailed')} {loadError}
        </div>
      );
    }

    if (previewKind === 'pdf' && blobUrl) {
      return (
        <div className="flex-1 min-h-0 bg-background">
          <iframe
            title={file.name}
            src={blobUrl}
            className="w-full h-full border-0"
          />
        </div>
      );
    }

    if (previewKind === 'image' && blobUrl) {
      return (
        <div className="flex-1 min-h-0 bg-muted/10 overflow-auto p-3">
          <img
            src={blobUrl}
            alt={file.name}
            className={`${expanded ? 'max-h-none w-auto max-w-full' : 'max-w-full h-auto'} mx-auto rounded-md border border-border`}
          />
        </div>
      );
    }

    if (previewKind === 'audio' && blobUrl) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-4">
          <audio src={blobUrl} controls className="w-full max-w-md" />
        </div>
      );
    }

    if (previewKind === 'video' && blobUrl) {
      return (
        <div className="flex-1 min-h-0 bg-background p-3">
          <video src={blobUrl} controls className="h-full w-full rounded-md border border-border bg-black" />
        </div>
      );
    }

    if (previewKind === 'html' && viewMode === 'preview') {
      return (
        <div className="flex-1 min-h-0 overflow-auto bg-muted/10 p-4">
          <iframe
            title={file.name}
            srcDoc={content}
            sandbox="allow-scripts allow-same-origin"
            className={`w-full rounded-lg border border-border/60 bg-white  ${expanded ? 'h-full min-h-[78vh]' : 'h-full min-h-[40rem]'}`}
          />
        </div>
      );
    }

    if (previewKind === 'json' && viewMode === 'preview') {
      return (
        <div className="flex-1 min-h-0 overflow-auto bg-muted/10 p-4">
          <JsonTreeViewer
            content={content}
            defaultExpandDepth={1}
            className={`${expanded ? 'min-h-[78vh]' : 'min-h-[40rem]'}`}
            invalidFallbackClassName={expanded ? 'min-h-[78vh]' : 'min-h-[40rem]'}
          />
        </div>
      );
    }

    if (previewKind === 'markdown' && viewMode === 'preview') {
      return (
        <div className="flex-1 min-h-0 overflow-auto bg-muted/10 p-4">
          <div className={`prose max-w-none rounded-lg border border-border/60 bg-background  dark:prose-invert ${expanded ? 'prose-base p-8' : 'prose-sm p-6'}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={markdownComponents}
            >
              {normalizeLatexDelimiters(content ?? '')}
            </ReactMarkdown>
          </div>
        </div>
      );
    }

    if (previewKind === 'unsupported') {
      return (
        <div className="flex-1 min-h-0 p-4 text-sm text-muted-foreground">
          {t('researchLabUI.unsupported')}
        </div>
      );
    }

    return (
      <textarea
        className={`flex-1 min-h-0 h-full w-full border-0 bg-background font-mono text-foreground resize-none focus:outline-none focus:ring-0 ${expanded ? 'p-5 text-sm' : 'p-3 text-xs'}`}
        aria-label={t('researchLabUI.edit')}
        value={content}
        onChange={e => { setContent(e.target.value); setDirty(true); }}
        spellCheck={false}
      />
    );
  };

  const renderToolbarActions = () => (
    <>
      {saveStatus === 'saved' && <span role="status" className="text-xs text-green-600">{t('researchLabUI.saved')}</span>}
      {saveStatus === 'error' && <span role="alert" className="text-xs text-red-600">{t('researchLabUI.failed')}</span>}
      {isPreviewRenderable && (
        <div className="flex items-center rounded-full border border-border/60 bg-background p-0.5">
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'preview'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setViewMode('preview')}
          >
            {t('researchLabUI.preview')}
          </button>
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'edit'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setViewMode('edit')}
          >
            {t('researchLabUI.edit')}
          </button>
        </div>
      )}
      {canExpandPreview && !showExpandedPreview && (
        <Button size="sm" variant="ghost" onClick={() => setShowExpandedPreview(true)} disabled={loading}>
          <Maximize2 className="w-3.5 h-3.5 mr-1" />
          {t('researchLabUI.expand')}
        </Button>
      )}
      {blobUrl && supportsBlobPreview && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => window.open(blobUrl, '_blank', 'noopener')}
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1" /> {t('researchLabUI.open')}
        </Button>
      )}
      {isTextEditable && (
        <Button size="sm" variant="ghost" onClick={handleSave} disabled={!dirty || loading || saveStatus === 'saving'}>
          <Save className="w-3.5 h-3.5 mr-1" /> {t('researchLabUI.save')}
        </Button>
      )}
    </>
  );

  if (!file) return null;

  return (
    <>
      <div
        className="flex min-h-[360px] max-h-[88vh] flex-col overflow-hidden rounded-lg border border-border/60 bg-card   resize-y"
        style={{ height: viewerHeight }}
      >
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted px-4 py-3">
          <span className="text-xs font-medium text-foreground truncate flex-1 mr-2">{file.relativePath}</span>
          <div className="flex flex-wrap items-center gap-2">
            {renderToolbarActions()}
            <Button size="sm" variant="ghost" onClick={onClose} aria-label={t('buttons.close')}><X className="h-4 w-4" /></Button>
          </div>
        </div>
        {renderPreviewContent(false)}
      </div>

      {showExpandedPreview && <WorkbenchDialog title={file.name} onClose={() => setShowExpandedPreview(false)} size="wide">
        <div className="mb-3 flex flex-wrap items-center gap-2">{renderToolbarActions()}</div>
        <div className="flex h-[60dvh] min-h-0 flex-col overflow-hidden">{renderPreviewContent(true)}</div>
      </WorkbenchDialog>}
    </>
  );
}

function ArtifactPreviewEmptyState({ hasArtifacts }) {
  const { t } = useTranslation('common');
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-card px-5 py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-border/60 bg-background">
        <FileText className="h-6 w-6 text-muted-foreground/70" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{t('researchLabUI.artifactPreview')}</h3>
      <p className="mx-auto mt-2 max-w-xs text-xs text-muted-foreground">
        {hasArtifacts
          ? t('researchLabUI.selectArtifact')
          : t('researchLabUI.runFirst')}
      </p>
    </div>
  );
}

function UsageGuideNotice({
  t,
  onNavigateToChat,
  collapsed,
  onToggleCollapsed,
  onDismiss,
}) {
  const guideSteps = ['step1', 'step2', 'step3', 'step4', 'step5'];

  return (
    <div className="rounded-lg border border-border p-4">

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex shrink-0 items-center justify-center py-1 text-muted-foreground">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-sky-100">
              {t('researchLabGuide.title')}
            </h3>
            {!collapsed ? (
              <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-sky-100/85">
                {t('researchLabGuide.description')}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-600 dark:text-sky-100/70">
                {t('researchLabUI.guideHidden')}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-full text-slate-700 hover:text-slate-900 dark:text-sky-100/80 dark:hover:text-sky-100"
            onClick={onToggleCollapsed}
          >
            {collapsed ? <ChevronRight className="mr-1.5 h-4 w-4" /> : <ChevronDown className="mr-1.5 h-4 w-4" />}
            {collapsed ? t('researchLabUI.expand') : t('researchLabUI.collapse')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-full text-slate-700 hover:text-slate-900 dark:text-sky-100/80 dark:hover:text-sky-100"
            onClick={onDismiss}
          >
            <X className="mr-1.5 h-4 w-4" />
            {t('researchLabUI.dismissGuide')}
          </Button>
        </div>
      </div>
      {!collapsed ? (
        <div className="relative mt-4 space-y-3 sm:pl-8">
          <ol className="list-decimal pl-4 space-y-1.5 text-sm text-slate-700 dark:text-sky-100/85">
            {guideSteps.map((key) => (
              <li key={key}>{t(`researchLabGuide.${key}`)}</li>
            ))}
          </ol>
          <p className="text-xs font-medium text-slate-600 dark:text-sky-100/75">
            {t('researchLabGuide.interfaceMap')}
          </p>
          {onNavigateToChat && (
            <Button
              size="sm"
              className="mt-1 text-primary-foreground bg-primary"
              onClick={onNavigateToChat}
            >
              <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
              {t('researchLabUI.goChat')}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

function ResearchLab({ selectedProject, onNavigateToChat, compact = false, onFileOpen, onStartTask }) {
  const { t } = useTranslation('common');
  const { currentProject, nextTask: guidedNextTask } = useTaskMaster();
  const [loading, setLoading] = useState(false);
  const [loadErrors, setLoadErrors] = useState([]);
  const loadSequence = useRef(0);
  const [instance, setInstance] = useState(null);
  const [researchBrief, setResearchBrief] = useState(null);
  const [config, setConfig] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [projectTags, setProjectTags] = useState([]);
  const [sessionTagsById, setSessionTagsById] = useState({});
  const [savingSessionId, setSavingSessionId] = useState(null);
  const [tagSaveError, setTagSaveError] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [projectFileSet, setProjectFileSet] = useState(null);
  const [selectedFile, setSelectedFileRaw] = useState(null);
  const [guideCollapsed, setGuideCollapsed] = useLocalStorage('research-lab-guide-collapsed', true);
  const [guideDismissed, setGuideDismissed] = useLocalStorage('research-lab-guide-dismissed', false);
  const HIDDEN_FILENAMES = useMemo(() => new Set([DEFAULT_RESEARCH_BRIEF_FILENAME, DEFAULT_TASKS_FILENAME]), []);
  const setSelectedFile = useCallback((file) => {
    if (file && HIDDEN_FILENAMES.has(file.name)) return;
    setSelectedFileRaw(file);
  }, [HIDDEN_FILENAMES]);

  const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';
  const projectName = selectedProject?.name;
  const projectIdentity = `${projectRoot || ''}::${projectName || ''}`;

  useEffect(() => {
    setSelectedFileRaw(null);
    setTagSaveError(false);
  }, [projectIdentity]);

  const projectSessions = useMemo(() => {
    if (!selectedProject) {
      return [];
    }

    const sessions = [
      ...(selectedProject.sessions || []).map((session) => ({ ...session, __provider: 'claude' })),
      ...(selectedProject.cursorSessions || []).map((session) => ({ ...session, __provider: 'cursor' })),
      ...(selectedProject.codexSessions || []).map((session) => ({ ...session, __provider: 'codex' })),
      ...(selectedProject.geminiSessions || []).map((session) => ({ ...session, __provider: 'gemini' })),
    ];

    return sessions.sort((left, right) => {
      const leftTime = new Date(getResearchLabSessionTime(left) || 0).getTime();
      const rightTime = new Date(getResearchLabSessionTime(right) || 0).getTime();
      return rightTime - leftTime;
    });
  }, [
    selectedProject,
    selectedProject?.sessions,
    selectedProject?.cursorSessions,
    selectedProject?.codexSessions,
    selectedProject?.geminiSessions,
  ]);

  const prevProjectIdentityRef = useRef(projectIdentity);
  useEffect(() => {
    const isProjectSwitch = prevProjectIdentityRef.current !== projectIdentity;
    prevProjectIdentityRef.current = projectIdentity;

    setSessionTagsById((current) => {
      if (isProjectSwitch) {
        const next = {};
        projectSessions.forEach((session) => {
          next[session.id] = Array.isArray(session.tags) ? session.tags : [];
        });
        return next;
      }
      // Merge: preserve locally-managed tags (optimistic updates), add new sessions only
      const next = { ...current };
      projectSessions.forEach((session) => {
        if (!Object.prototype.hasOwnProperty.call(next, session.id)) {
          next[session.id] = Array.isArray(session.tags) ? session.tags : [];
        }
      });
      return next;
    });
  }, [projectIdentity, projectSessions]);

  const loadData = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoadErrors([]);
    if (!projectName) {
      setInstance(null);
      setResearchBrief(null);
      setConfig(null);
      setArtifacts([]);
      setTasks([]);
      setProjectTags([]);
      setProjectFileSet(null);
      return;
    }
    setLoading(true);
    setTasksLoading(true);
    setInstance(null);
    setResearchBrief(null);
    setConfig(null);
    try {
      const [tasksResponse, filesResponse, tagsResponse] = await Promise.all([
        api.get(`/taskmaster/tasks/${encodeURIComponent(projectName)}`).catch(() => null),
        api.getFiles(projectName, { maxDepth: 10 }).catch(() => null),
        api.projectTags(projectName, 'stage').catch(() => null),
      ]);
      const taskData = tasksResponse?.ok ? await tasksResponse.json().catch(() => null) : null;
      const tagsData = tagsResponse?.ok ? await tagsResponse.json().catch(() => null) : null;
      if (sequence !== loadSequence.current) return;
      const errors = [];
      if (Array.isArray(taskData?.tasks)) setTasks(taskData.tasks);
      else errors.push('tasks');
      if (Array.isArray(tagsData?.tags)) setProjectTags(tagsData.tags);
      if (!filesResponse?.ok) errors.push('files');
      setLoadErrors(errors);
      if (!filesResponse?.ok) return;

      // Load file tree and collect log artifacts from new layout + legacy cache
      const filesRawText = filesResponse?.ok ? await filesResponse.text() : '[]';
      let data = [];
      try {
        data = filesRawText ? JSON.parse(filesRawText) : [];
      } catch {
        data = null;
      }
      if (sequence !== loadSequence.current) return;
      if (!Array.isArray(data)) { setLoadErrors(previous => [...previous, 'files']); return; }
      const tree = data;
      const fileSet = collectAllRelativePaths(tree, projectRoot);
      setProjectFileSet(fileSet);

      // Optional compatibility: read legacy metadata files only when they exist.
      const hasInstanceFile = fileSet.has('instance.json');
      const hasPipelineConfig = fileSet.has('pipeline_config.json');
      const hasResearchBrief = fileSet.has(DEFAULT_RESEARCH_BRIEF_PATH);

      if (hasInstanceFile || hasPipelineConfig || hasResearchBrief) {
        const [inst, pipelineConfig, brief] = await Promise.all([
          hasInstanceFile ? readProjectJson(projectName, 'instance.json') : Promise.resolve(null),
          hasPipelineConfig ? readProjectJson(projectName, 'pipeline_config.json') : Promise.resolve(null),
          hasResearchBrief ? readProjectJson(projectName, DEFAULT_RESEARCH_BRIEF_PATH) : Promise.resolve(null),
        ]);
        if (sequence !== loadSequence.current) return;
        setResearchBrief(brief);

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
        const surveyReferencesPath = merged?.Survey?.references ?? merged?.survey_references_path;
        const surveyReportsPath = merged?.Survey?.reports ?? merged?.survey_reports_path ?? merged?.Research;
        const conf = merged
          ? {
              ...merged,
              instance: merged.instance ?? merged.instance_path,
              dataset_path: merged.Experiment?.datasets ?? merged.datasets_path,
              task_level: merged.idea_maturity ?? merged.task_level ?? undefined,
              cache_path: merged.cache_path,
              ideas_path: ideasPath,
              references_path: referencesPath,
              survey_references_path: surveyReferencesPath,
              survey_reports_path: surveyReportsPath,
              ideas_path_relative: toRelativePath(ideasPath, projectRoot) || 'Ideation/ideas',
              references_path_relative: toRelativePath(referencesPath, projectRoot) || 'Ideation/references',
              survey_references_path_relative: toRelativePath(surveyReferencesPath, projectRoot) || (surveyReferencesPath ? 'Survey/references' : undefined),
              survey_reports_path_relative: toRelativePath(surveyReportsPath, projectRoot) || (surveyReportsPath ? 'Survey/reports' : undefined),
            }
          : null;
        setConfig(conf);
      }

      const logFiles = collectFiles(tree, projectRoot, (rel) => {
        if (/^(Survey|Research)\//.test(rel)) return true;
        // Promotion: collect all files under Promotion/ and legacy Presentation/.
        if (/^(Promotion|Presentation)\//.test(rel)) return true;
        // Legacy publication outputs that now belong to Promotion.
        if (/^Publication\/(homepage|slide)\//.test(rel)) return true;
        if (!rel.endsWith('.json')) return false;
        // New layout: JSON files inside logs/ dirs under Survey/, Ideation/, or Experiment/
        if (/^(Survey|Ideation|Experiment)\/.*\/logs\//.test(rel)) return true;
        // Publication: any JSON files under Publication/
        if (/^Publication\//.test(rel)) return true;
        // Legacy layout: JSON files inside cache/ directories
        if (/(?:^|\/)cache\//.test(rel)) return true;
        return false;
      });
      // Exclude research_brief.json and tasks.json from user-visible artifacts
      setArtifacts(sortArtifactsByStageAndPath(
        logFiles.filter((f) => !HIDDEN_FILENAMES.has(f.name))
      ));
    } catch (e) {
      console.error('ResearchLab load:', e);
      if (sequence === loadSequence.current) setLoadErrors(['tasks', 'files']);
    } finally {
      if (sequence === loadSequence.current) { setLoading(false); setTasksLoading(false); }
    }
  }, [projectName, projectRoot, HIDDEN_FILENAMES]);

  useEffect(() => {
    setTasks([]); setArtifacts([]); setProjectFileSet(null); setProjectTags([]);
    void loadData();
    return () => { loadSequence.current++; };
  }, [loadData]);

  useEffect(() => {
    if (!projectName || artifacts.length === 0) {
      setSelectedFileRaw(null);
      return;
    }

    setSelectedFileRaw((current) => {
      if (!current) return artifacts[0];
      return artifacts.find((artifact) => artifact.relativePath === current.relativePath) || artifacts[0];
    });
  }, [artifacts, projectName]);

  const normalizedTasks = useMemo(() => normalizeTasks(tasks), [tasks]);
  const taskSummary = useMemo(() => buildTaskSummary(normalizedTasks), [normalizedTasks]);
  const pipelineStageOverview = useMemo(
    () => buildPipelineStageOverview(normalizedTasks, artifacts),
    [normalizedTasks, artifacts],
  );
  const localNextTask = useMemo(() => getNextTask(normalizedTasks), [normalizedTasks]);
  const nextTask = currentProject?.name === selectedProject?.name
    ? (guidedNextTask || localNextTask)
    : localNextTask;
  const sourcePapers = useMemo(
    () => getSourcePapers(instance, researchBrief),
    [instance, researchBrief],
  );
  const sourcePaperOrigin = useMemo(() => {
    if (Array.isArray(instance?.source_papers) && instance.source_papers.length > 0) {
      return 'instance';
    }
    if (Array.isArray(researchBrief?.sections?.survey?.key_references) && researchBrief.sections.survey.key_references.length > 0) {
      return 'brief';
    }
    return null;
  }, [instance, researchBrief]);
  const projectTitle = selectedProject?.displayName || selectedProject?.name || 'Research Project';
  const liveStageCount = pipelineStageOverview.filter((stage) => stage.total > 0 || stage.artifacts > 0).length;
  const hasPaperPreview = projectFileSet?.has('Publication/paper/main.pdf');
  const hasContent = instance || researchBrief || config || artifacts.length > 0 || tasks.length > 0;
  const handleToggleSessionStageTag = useCallback(async (session, tag) => {
    if (!projectName || !session?.id || !tag?.id) {
      return;
    }

    const currentTags = Array.isArray(sessionTagsById[session.id]) ? sessionTagsById[session.id] : [];
    const nextTagIds = currentTags.some((currentTag) => currentTag.id === tag.id)
      ? currentTags.filter((currentTag) => currentTag.id !== tag.id).map((currentTag) => currentTag.id)
      : [...currentTags.map((currentTag) => currentTag.id), tag.id];

    setTagSaveError(false);
    setSavingSessionId(session.id);
    try {
      const response = await api.updateSessionTags(projectName, session.id, nextTagIds);
      if (!response.ok) {
        throw new Error(`Failed to update session tags: ${response.status}`);
      }

      const payload = await response.json();
      const nextTags = Array.isArray(payload?.tags) ? payload.tags : [];
      setSessionTagsById((current) => ({
        ...current,
        [session.id]: nextTags,
      }));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('session-tags-updated', {
          detail: {
            projectName,
            sessionId: session.id,
            provider: session.__provider || 'claude',
            tags: nextTags,
          },
        }));
      }
    } catch (error) {
      setTagSaveError(true);
      console.error('Failed to update session stage tags:', error);
    } finally {
      setSavingSessionId(null);
    }
  }, [projectName, sessionTagsById]);
  const handleArtifactSelect = useCallback((file) => {
    if (compact && onFileOpen) {
      const filePath = file.absolutePath || file.path || file.relativePath;
      onFileOpen(filePath);
    } else {
      setSelectedFile(file);
    }
  }, [compact, onFileOpen, setSelectedFile]);

  const sidebar = (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <ArtifactsCard
        artifacts={artifacts}
        onSelect={handleArtifactSelect}
        selectedPath={compact ? null : selectedFile?.relativePath}
        compact={compact}
      />

      {!compact && (selectedFile ? (
        <FileViewer
          projectName={projectName}
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      ) : (
        <ArtifactPreviewEmptyState hasArtifacts={artifacts.length > 0} />
      ))}
    </div>
  );

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>{t('mainContent.chooseProject') || 'Choose a project'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background dark:bg-background">
      <div className={`flex flex-shrink-0 items-center justify-between border-b border-border/60 bg-background  ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <div className="flex min-w-0 items-center gap-3">
          {!compact && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-200/70 bg-blue-50/85 text-blue-700  dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300">
              <FlaskConical className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <div className={`font-medium text-foreground ${compact ? 'text-sm' : ''}`}>
              {t('tabs.researchLab') || 'Research Lab'}
            </div>
            {!compact && (
              <div className="truncate text-xs text-muted-foreground">
                {projectTitle}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {nextTask && onNavigateToChat && !compact && (
            <Button
              size="sm"
              className="hidden rounded-full text-primary-foreground  sm:inline-flex bg-primary"
              onClick={() => onNavigateToChat()}
            >
              <MessageSquare className="mr-1.5 h-4 w-4" />
              {t('researchLabUI.continueChat')}
            </Button>
          )}
          <Button aria-label={t('buttons.refresh')} variant="ghost" size="sm" onClick={loadData} disabled={loading} className="rounded-full">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {loadErrors.length > 0 && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-sm text-red-700 dark:text-red-300">
        <span>{t('workbench.loadError')} {loadErrors.map(key => t(key === 'tasks' ? 'tabs.tasks' : 'tabs.files')).join(', ')}</span>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>{t('buttons.retry')}</Button>
      </div>}
      <ScrollArea className="flex-1">
        <div className={compact ?"p-3" :"workbench-page"}>
          {!compact && !guideDismissed ? (
            <div className="mb-6">
              <UsageGuideNotice
                t={t}
                onNavigateToChat={onNavigateToChat}
                collapsed={guideCollapsed}
                onToggleCollapsed={() => setGuideCollapsed((value) => !value)}
                onDismiss={() => setGuideDismissed(true)}
              />
            </div>
          ) : null}

          <section className={`${compact ? 'py-3' : 'pb-6'}`}>


            <div className={`relative grid ${compact ? 'gap-3' : 'gap-6'} ${compact ? '' : 'xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]'}`}>
              <div className="min-w-0">
                <h2 className={`font-semibold tracking-tight text-foreground ${compact ? 'text-base' : 'mt-4 text-2xl'}`}>
                  {projectTitle}
                </h2>

                <div className={`grid ${compact ? 'mt-3 grid-cols-2 gap-2' : 'mt-4 grid-cols-2 gap-4 border-y border-border py-2 xl:grid-cols-4'}`}>
                  <ResearchMetricCard
                    icon={ListChecks}
                    label="Tasks"
                    value={taskSummary.total}
                    detail={taskSummary.total > 0 ? `${taskSummary.progress}% complete` : 'No pipeline tasks yet'}
                    accentClass="border-cyan-200/80 bg-cyan-100/80 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-200"
                    compact={compact}
                  />
                  <ResearchMetricCard
                    icon={Target}
                    label="Completed"
                    value={taskSummary.done}
                    detail={taskSummary.inProgress > 0 ? `${taskSummary.inProgress} active now` : `${taskSummary.pending} pending`}
                    accentClass="border-emerald-200/80 bg-emerald-100/80 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                    compact={compact}
                  />
                  <ResearchMetricCard
                    icon={Beaker}
                    label="Artifacts"
                    value={artifacts.length}
                    detail={artifacts.length > 0 ? `${liveStageCount} pipeline stages populated` : 'No outputs yet'}
                    accentClass="border-blue-200/80 bg-blue-100/80 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200"
                    compact={compact}
                  />
                  <ResearchMetricCard
                    icon={BookOpen}
                    label="Sources"
                    value={sourcePapers.length}
                    detail={
                      sourcePapers.length > 0
                        ? sourcePaperOrigin === 'brief'
                          ? 'Loaded from research brief'
                          : 'Loaded from instance metadata'
                        : 'No papers attached yet'
                    }
                    accentClass="border-amber-200/80 bg-amber-100/80 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                    compact={compact}
                  />
                </div>

                <div className={`grid ${compact ? 'mt-3 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5' : 'mt-4 gap-2 sm:grid-cols-2 xl:grid-cols-3'}`}>
                  {pipelineStageOverview.map((stage) => (
                    <PipelineStageChip key={stage.key} stage={stage} compact={compact} />
                  ))}
                </div>
              </div>

              <div className={`grid ${compact ? 'gap-2' : 'gap-4'}`}>
                {nextTask ? (
                  <div className={`border-l-2 border-blue-500 bg-muted/30 ${compact ? 'p-3' : 'p-4'}`}>
                    {/* Animated glow accent */}



                    <div className="relative">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary">
                            <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
                          </div>
                          {t('researchLabUI.nextAction')}
                        </div>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TASK_STAGE_META[nextTask.stage]?.className || TASK_STAGE_META.unassigned.className}`}>
                          {t(`workbench.stages.${nextTask.stage || 'unassigned'}`)}
                        </span>
                      </div>

                      <div className={`font-semibold tracking-tight text-foreground ${compact ? 'mt-2 text-sm' : 'mt-3 text-lg'}`}>
                        {nextTask.title || t('researchLabTaskBoard.untitledTask')}
                      </div>
                      {nextTask.description ? (
                        <p className={`text-sm leading-6 text-muted-foreground ${compact ? 'mt-1 line-clamp-2' : 'mt-2 line-clamp-3'}`}>
                          {nextTask.description}
                        </p>
                      ) : null}

                      {(onStartTask || onNavigateToChat) && (
                        <button
                          type="button"
                          onClick={() => {
                            // Legacy tasks store prompt at top level; newer ones nest it under guidance
                            const prompt = nextTask.nextActionPrompt || nextTask.guidance?.nextActionPrompt || '';
                            if (onStartTask) {
                              onStartTask(prompt, nextTask);
                            } else if (onNavigateToChat) {
                              onNavigateToChat();
                            }
                          }}
                          className={`relative inline-flex items-center gap-2 overflow-hidden rounded-full font-semibold text-primary-foreground  transition-colors duration-300   bg-primary       ${compact ? 'mt-3 px-4 py-2 text-xs' : 'mt-4 px-5 py-2.5 text-sm'}`}
                        >
                          {/* Shine sweep animation */}

                          <Sparkles className={`relative ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
                          <span className="relative">{t('workbench.prepareTask')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={`border border-border/60 bg-card   ${compact ? 'rounded-lg p-3' : 'rounded-lg p-5'}`}>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      {t('researchLabUI.nextAction')}
                    </div>
                    <div className={`border border-dashed border-border/60 bg-background text-sm text-muted-foreground ${compact ? 'mt-2 rounded-lg px-3 py-3' : 'mt-4 rounded-lg px-4 py-5'}`}>
                      {t('researchLabUI.syncHint')}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className={`grid items-start ${compact ? 'mt-3 gap-3' : 'mt-6 gap-6'} ${compact ? '' : 'xl:grid-cols-[minmax(0,1.05fr)_420px]'}`}>
            <div className={`min-w-0 ${compact ? 'space-y-3' : 'space-y-6'}`}>
              <div className={`grid items-stretch ${compact ? 'gap-3' : 'gap-6'} ${sourcePapers.length > 0 && !compact ? 'lg:grid-cols-2' : ''}`}>
                <OverviewCard instance={instance} config={config} researchBrief={researchBrief} compact={compact} />
                {sourcePapers.length > 0 ? <PapersCard papers={sourcePapers} compact={compact} /> : null}
              </div>

              <TaskPipelineBoard
                tasks={tasks}
                isLoading={tasksLoading}
                loadError={loadErrors.includes('tasks')}
                onNavigateToChat={onNavigateToChat}
                projectName={projectName}
                onTaskUpdated={loadData}
                compact={compact}
              />

              <div className={compact ? '' : 'xl:hidden'}>
                {sidebar}
              </div>

              {tagSaveError && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{t('researchLabUI.tagError')}</div>}
              <SessionStageBoard
                projectTags={projectTags}
                sessions={projectSessions}
                sessionTagsById={sessionTagsById}
                savingSessionId={savingSessionId}
                onToggleStageTag={handleToggleSessionStageTag}
                compact={compact}
              />

              <IdeaCard
                projectName={projectName}
                config={config}
                projectFileSet={projectFileSet}
                compact={compact}
              />

              {hasPaperPreview ? (
                <PaperCard
                  projectName={projectName}
                  projectRoot={projectRoot}
                  compact={compact}
                />
              ) : null}

              {loading && !hasContent ? (
                <div className="flex h-40 items-center justify-center rounded-lg border border-border/60 bg-card text-sm text-muted-foreground">
                  {t('researchLabUI.loadingResearch')}
                </div>
              ) : !hasContent ? (
                <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-card text-sm text-muted-foreground">
                  <FolderOpen className="w-14 h-14 opacity-40" />
                  <p>{t('researchLabUI.noData')}</p>
                  <p className="max-w-md text-center text-xs">
                    {t('researchLabUI.initHint')}
                  </p>
                </div>
              ) : (
                <div className="h-1" />
              )}
            </div>

            {!compact && (
              <div className="hidden xl:block xl:sticky xl:top-6">
                {sidebar}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export default ResearchLab;
