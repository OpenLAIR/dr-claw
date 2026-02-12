import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  FlaskConical, RefreshCw, FileText, BookOpen, Settings2, Lightbulb,
  GitBranch, FolderOpen, ChevronDown, ChevronRight, ExternalLink,
  FileCode, Beaker, ClipboardList, Brain, Save, AlertCircle,
  Sparkles, Copy, Check, PenTool
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
    if (name === 'coding_plan_agent.json') return { stage: 'Implementation Plan', icon: ClipboardList, color: 'purple' };
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
  if (name === 'coding_plan_agent.json') return { stage: 'Implementation Plan', icon: ClipboardList, color: 'purple' };
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

/* ------------------------------------------------------------------ */
/*  Sub-components (cards)                                             */
/* ------------------------------------------------------------------ */

/** Overview card: target paper, task, mode */
function OverviewCard({ instance, config }) {
  const mode = config?.task_level === 'task1' ? 'Plan' : 'Idea';
  const modeColor = mode === 'Plan'
    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  const taskText = instance?.task2 || instance?.task1 || '';
  const truncated = taskText.length > 400 ? taskText.slice(0, 400) + '…' : taskText;

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
      {instance?.instance_id && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Instance: <code className="bg-muted px-1 rounded">{instance.instance_id}</code></span>
          {config?.category && <span>Category: <code className="bg-muted px-1 rounded">{config.category}</code></span>}
        </div>
      )}
      {truncated && (
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Task Description</p>
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">{truncated}</p>
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

/** Pipeline config summary */
function PipelineCard({ config }) {
  if (!config) return null;
  const entries = [
    { label: 'Instance', value: config.instance_path?.split('/').pop() },
    { label: 'Task Level', value: config.task_level },
    { label: 'Category', value: config.category },
    { label: 'Dataset', value: config.dataset_path?.split('/').pop() || '—' },
  ].filter(e => e.value);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        Pipeline Configuration
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {entries.map(e => (
          <React.Fragment key={e.label}>
            <span className="text-muted-foreground text-xs">{e.label}</span>
            <span className="text-foreground text-xs font-medium truncate">{e.value}</span>
          </React.Fragment>
        ))}
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

/** Final Idea card — shows the selected idea rendered as markdown */
function IdeaCard({ projectName, config }) {
  const [ideaText, setIdeaText] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);

  useEffect(() => {
    if (!projectName) { setLoading(false); return; }

    setLoading(true);

    (async () => {
      try {
        // --- New layout: Ideation/ideas/ ---
        const ideasDir = 'Ideation/ideas';

        // 1. Primary: read selected_idea.txt from new path
        const selectedTxt = await readProjectText(projectName, `${ideasDir}/selected_idea.txt`);
        if (selectedTxt) {
          setIdeaText(selectedTxt);
          setLoading(false);
          return;
        }

        // 2. Fallback: read raw_idea_N.txt in reverse order (latest first)
        for (let i = 10; i >= 1; i--) {
          const rawTxt = await readProjectText(projectName, `${ideasDir}/raw_idea_${i}.txt`);
          if (rawTxt) {
            setIdeaText(rawTxt);
            setLoading(false);
            return;
          }
        }

        // 3. Fallback: read from logs JSON
        const selectFile = `${ideasDir}/logs/idea_generation_agent_iter_select.json`;
        const selectData = await readProjectJson(projectName, selectFile);
        if (selectData?.context_variables?.final_selected_idea_data) {
          const data = selectData.context_variables.final_selected_idea_data;
          setIdeaText(data.selected_idea_text || data.raw_idea || null);
          setLoading(false);
          return;
        }

        // --- Legacy layout: cache_path based ---
        if (config?.cache_path) {
          const cachePath = config.cache_path;
          const relativeCacheBase = cachePath.includes('/outputs/')
            ? 'outputs/' + cachePath.split('/outputs/')[1]
            : cachePath;
          const cacheDir = relativeCacheBase.replace(/\/+$/, '');

          const legacySelected = await readProjectText(projectName, `${cacheDir}/selected_idea.txt`);
          if (legacySelected) {
            setIdeaText(legacySelected);
            setLoading(false);
            return;
          }
          for (let i = 10; i >= 1; i--) {
            const rawTxt = await readProjectText(projectName, `${cacheDir}/raw_idea_${i}.txt`);
            if (rawTxt) {
              setIdeaText(rawTxt);
              setLoading(false);
              return;
            }
          }
          const legacySelectFile = `${cacheDir}/agents/idea_generation_agent_iter_select.json`;
          const legacyData = await readProjectJson(projectName, legacySelectFile);
          if (legacyData?.context_variables?.final_selected_idea_data) {
            const data = legacyData.context_variables.final_selected_idea_data;
            setIdeaText(data.selected_idea_text || data.raw_idea || null);
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        console.warn('IdeaCard: failed to load idea:', e.message);
      }
      setIdeaText(null);
      setLoading(false);
    })();
  }, [projectName, config]);

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
      .then(r => r.json())
      .then(d => setContent(d?.content ?? ''))
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

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

function ResearchLab({ selectedProject }) {
  const { t } = useTranslation('common');
  const [loading, setLoading] = useState(false);
  const [instance, setInstance] = useState(null);
  const [config, setConfig] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);

  const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';
  const projectName = selectedProject?.name;

  const loadData = useCallback(async () => {
    if (!projectName) {
      setInstance(null);
      setConfig(null);
      setArtifacts([]);
      return;
    }
    setLoading(true);
    try {
      // Load instance.json and pipeline_config.json
      const [inst, conf] = await Promise.all([
        readProjectJson(projectName, 'instance.json'),
        readProjectJson(projectName, 'pipeline_config.json'),
      ]);
      setInstance(inst);
      setConfig(conf);

      // Load file tree and collect log artifacts from new layout + legacy cache
      const res = await api.getFiles(projectName);
      const data = await res.json();
      const tree = Array.isArray(data) ? data : [];
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
      setArtifacts(logFiles);
    } catch (e) {
      console.error('ResearchLab load:', e);
    } finally {
      setLoading(false);
    }
  }, [projectName, projectRoot]);

  useEffect(() => { loadData(); }, [loadData]);

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>{t('mainContent.chooseProject') || 'Choose a project'}</p>
      </div>
    );
  }

  const hasContent = instance || config || artifacts.length > 0;

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
        {loading && !hasContent ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Loading research data...
          </div>
        ) : !hasContent ? (
          <div className="flex flex-col items-center justify-center h-60 text-muted-foreground text-sm gap-3">
            <FolderOpen className="w-14 h-14 opacity-40" />
            <p>No research data found in this project.</p>
            <p className="text-xs max-w-md text-center">
              Start a research pipeline to generate <code className="bg-muted px-1 rounded">instance.json</code> and <code className="bg-muted px-1 rounded">pipeline_config.json</code> in the project root.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-4 max-w-4xl mx-auto">
            {/* Row 1: Overview + Pipeline Config */}
            {(instance || config) && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  {instance && <OverviewCard instance={instance} config={config} />}
                </div>
                <div>
                  {config && <PipelineCard config={config} />}
                </div>
              </div>
            )}

            {/* Row 2: Source Papers */}
            {instance?.source_papers?.length > 0 && (
              <PapersCard papers={instance.source_papers} />
            )}

            {/* Row 3: Final Idea (markdown) */}
            <IdeaCard projectName={projectName} config={config} />

            {/* Row 4: Artifacts */}
            {artifacts.length > 0 && (
              <ArtifactsCard
                artifacts={artifacts}
                onSelect={setSelectedFile}
                selectedPath={selectedFile?.relativePath}
              />
            )}

            {/* Row 5: File Viewer */}
            {selectedFile && (
              <FileViewer
                projectName={projectName}
                file={selectedFile}
                onClose={() => setSelectedFile(null)}
              />
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export default ResearchLab;
