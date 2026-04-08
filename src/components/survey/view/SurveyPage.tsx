import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  FileText,
  Network,
  NotebookText,
  RefreshCw,
  AlertCircle,
  ClipboardList,
  Loader2,
  ChevronDown,
  ChevronRight,
  Library,
} from 'lucide-react';

import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { cn } from '../../../lib/utils';
import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import { useSurveyData, type SurveyFile } from '../hooks/useSurveyData';
import MermaidDiagramViewer from './MermaidDiagramViewer';
import { saveSurveyDiagramSource } from '../utils/diagramWindow';
import ReferencesPanel from '../../references/view/ReferencesPanel';
import type { Reference } from '../../references/types';

type SurveyPageProps = {
  selectedProject: Project;
  onChatFromReference?: (ref: Reference) => void;
};

type SelectedItem =
  | { type: 'file'; value: SurveyFile }
  | null;

type PreviewState = {
  loading: boolean;
  content: string | null;
  pdfUrl: string | null;
  mermaidSvg: string | null;
  error: string | null;
};

const SECTION_META = {
  papers: { icon: BookOpen, tone: 'text-sky-600 dark:text-sky-400' },
  reports: { icon: FileText, tone: 'text-emerald-600 dark:text-emerald-400' },
  graphs: { icon: Network, tone: 'text-indigo-600 dark:text-indigo-400' },
  notes: { icon: NotebookText, tone: 'text-amber-600 dark:text-amber-400' },
} as const;

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof BookOpen;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.78))] p-3 shadow-sm dark:bg-[linear-gradient(180deg,rgba(20,23,29,0.92),rgba(17,24,39,0.82))]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
        </div>
        <div className={cn('rounded-lg border border-border/40 bg-background/80 p-1.5 shadow-sm', tone)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function CollapsiblePanel({
  title,
  badge,
  collapsed,
  onToggle,
  children,
  accentClassName,
}: {
  title: string;
  badge?: string | number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  accentClassName?: string;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="rounded-xl border border-border/50 bg-card/75 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/30"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className={cn('h-2 w-2 rounded-full bg-primary/60', accentClassName)} />
          <h3 className="truncate text-xs font-semibold text-foreground">{title}</h3>
          {badge !== undefined ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">{badge}</Badge> : null}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>{collapsed ? t('surveyPage.actions.expand') : t('surveyPage.actions.collapse')}</span>
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>
      {!collapsed ? <div className="border-t border-border/40">{children}</div> : null}
    </div>
  );
}

function SurveySection({
  sectionKey,
  title,
  files,
  selectedItem,
  onSelect,
  emptyLabel,
  filter,
  collapsed,
  onToggle,
}: {
  sectionKey: keyof typeof SECTION_META;
  title: string;
  files: SurveyFile[];
  selectedItem: SelectedItem;
  onSelect: (item: SelectedItem) => void;
  emptyLabel: string;
  filter: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('common');
  const filteredFiles = files.filter((file) => {
    if (!filter) {
      return true;
    }

    const haystack = `${file.name} ${file.relativePath}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  const Icon = SECTION_META[sectionKey].icon;

  return (
    <div className="rounded-lg border border-border/50 bg-background/55 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className={cn('rounded-md border border-border/40 bg-background/80 p-1', SECTION_META[sectionKey].tone)}>
            <Icon className="h-3 w-3" />
          </div>
          <h3 className="truncate text-xs font-semibold text-foreground">{title}</h3>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{filteredFiles.length}</Badge>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>{collapsed ? t('surveyPage.actions.expand') : t('surveyPage.actions.collapse')}</span>
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>
      {!collapsed ? (
      <div className="border-t border-border/40 p-1.5">
        {filteredFiles.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 px-2 py-4 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isSelected = selectedItem?.type === 'file' && selectedItem.value.id === file.id;
            return (
              <button
                key={file.id}
                type="button"
                onClick={() => onSelect({ type: 'file', value: file })}
                className={cn(
                  'mb-1 flex w-full items-start justify-between rounded-md border px-2 py-1.5 text-left transition-colors last:mb-0',
                  isSelected
                    ? 'border-primary/60 bg-primary/8'
                    : 'border-transparent bg-muted/40 hover:border-border/60 hover:bg-muted/70',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-foreground">{file.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{file.relativePath}</div>
                </div>
                <Badge variant="secondary" className="ml-2 shrink-0 text-[10px] uppercase px-1.5 py-0">
                  {file.extension.replace('.', '') || 'file'}
                </Badge>
              </button>
            );
          })
        )}
      </div>
      ) : null}
    </div>
  );
}

function PreviewContent({
  file,
  preview,
  onOpenMermaidWindow,
}: {
  file: SurveyFile;
  preview: PreviewState;
  onOpenMermaidWindow: () => void;
}) {
  const { t } = useTranslation('common');

  return (
    <>
      {file.previewKind === 'pdf' && preview.pdfUrl ? (
        <iframe
          title={file.name}
          src={preview.pdfUrl}
          className="h-full w-full rounded-xl border border-border/50 bg-background shadow-sm"
        />
      ) : null}

      {preview.mermaidSvg ? (
        <MermaidDiagramViewer svg={preview.mermaidSvg} onOpenInWindow={onOpenMermaidWindow} />
      ) : null}

      {file.previewKind === 'html' && preview.content ? (
        <iframe
          title={file.name}
          srcDoc={preview.content}
          sandbox="allow-scripts allow-same-origin"
          className="h-full w-full rounded-xl border border-border/50 bg-white shadow-sm"
        />
      ) : null}

      {file.previewKind === 'markdown' && preview.content ? (
        <div className="prose prose-sm max-w-none rounded-xl border border-border/50 bg-background/60 p-6 shadow-sm dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content}</ReactMarkdown>
        </div>
      ) : null}

      {(file.previewKind === 'json' || file.previewKind === 'text') && preview.content ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-background/80 p-5 text-sm text-foreground shadow-sm">
          {preview.content}
        </pre>
      ) : null}

      {file.previewKind === 'unsupported' ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
          {t('surveyPage.preview.unsupported')}
        </div>
      ) : null}
    </>
  );
}

export default function SurveyPage({ selectedProject, onChatFromReference }: SurveyPageProps) {
  const { t } = useTranslation('common');
  const { papers, reports, graphs, notes, tasks, loading, error, refresh } = useSurveyData(selectedProject);
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [preview, setPreview] = useState<PreviewState>({
    loading: false,
    content: null,
    pdfUrl: null,
    mermaidSvg: null,
    error: null,
  });
  const [filter, setFilter] = useState('');
  const [collapsedPanels, setCollapsedPanels] = useState({
    tasks: true,
    library: true,
    references: true,
  });
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startX - ev.clientX;
      setSidebarWidth(Math.max(240, Math.min(600, startWidth + delta)));
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);
  const [collapsedSections, setCollapsedSections] = useState({
    papers: false,
    reports: false,
    graphs: false,
    notes: false,
  });

  const togglePanel = (panel: keyof typeof collapsedPanels) => {
    setCollapsedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  };

  const toggleSection = (section: keyof typeof collapsedSections) => {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const handleSelectItem = (item: SelectedItem) => {
    setSelectedItem(item);
  };

  const handleOpenMermaidWindow = () => {
    if (!preview.content) {
      return;
    }

    const mermaidSource = extractMermaidSource(preview.content);
    if (!mermaidSource) {
      return;
    }

    const diagramId = saveSurveyDiagramSource(mermaidSource);
    const basename = window.__ROUTER_BASENAME__ || '';
    window.open(`${basename}/survey/diagram?diagramId=${encodeURIComponent(diagramId)}`, '_blank', 'noopener,noreferrer,width=1600,height=1000');
  };

  useEffect(() => {
    const availableFiles = [...papers, ...reports, ...graphs, ...notes];

    if (selectedItem?.type === 'file') {
      const stillExists = availableFiles.some((file) => file.id === selectedItem.value.id);
      if (stillExists) {
        return;
      }
    }

    if (availableFiles.length > 0) {
      setSelectedItem({ type: 'file', value: availableFiles[0] });
      return;
    }

    setSelectedItem(null);
  }, [graphs, notes, papers, reports, selectedItem]);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let isCancelled = false;

    const loadPreview = async () => {
      if (!selectedItem || selectedItem.type !== 'file') {
        setPreview({ loading: false, content: null, pdfUrl: null, mermaidSvg: null, error: null });
        return;
      }

      const file = selectedItem.value;
      if (file.previewKind === 'unsupported') {
        setPreview({ loading: false, content: null, pdfUrl: null, mermaidSvg: null, error: null });
        return;
      }

      setPreview({ loading: true, content: null, pdfUrl: null, mermaidSvg: null, error: null });

      try {
        if (file.previewKind === 'pdf') {
          const blob = await api.getFileContentBlob(selectedProject.name, file.absolutePath);
          if (isCancelled) {
            return;
          }

          revokedUrl = URL.createObjectURL(blob);
          setPreview({ loading: false, content: null, pdfUrl: revokedUrl, mermaidSvg: null, error: null });
          return;
        }

        const response = await api.readFile(selectedProject.name, file.relativePath);
        if (!response.ok) {
          throw new Error(`preview:${response.status}`);
        }

        const payload = await response.json();
        const rawContent = String(payload?.content ?? '');
        const mermaidSource = extractMermaidSource(rawContent);

        if (mermaidSource) {
          const mermaid = (await import('mermaid')).default;
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
          });

          const renderId = `survey-mermaid-${Date.now().toString(36)}`;
          const { svg } = await mermaid.render(renderId, mermaidSource);
          if (!isCancelled) {
            setPreview({
              loading: false,
              content: rawContent,
              pdfUrl: null,
              mermaidSvg: svg,
              error: null,
            });
          }
          return;
        }

        let content = rawContent;
        if (file.previewKind === 'json') {
          try {
            content = JSON.stringify(JSON.parse(rawContent), null, 2);
          } catch {
            content = rawContent;
          }
        }

        setPreview({ loading: false, content, pdfUrl: null, mermaidSvg: null, error: null });
      } catch (previewError) {
        console.error('Failed to load survey preview:', previewError);
        if (!isCancelled) {
          setPreview({ loading: false, content: null, pdfUrl: null, mermaidSvg: null, error: 'preview-failed' });
        }
      }
    };

    void loadPreview();

    return () => {
      isCancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [selectedItem, selectedProject.name]);

  const sections = [
    { key: 'papers', title: t('surveyPage.sections.papers'), files: papers },
    { key: 'reports', title: t('surveyPage.sections.reports'), files: reports },
    { key: 'graphs', title: t('surveyPage.sections.graphs'), files: graphs },
    { key: 'notes', title: t('surveyPage.sections.notes'), files: notes },
  ] as const;

  return (
    <div className="h-full flex flex-col bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_24%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.08),transparent_22%),linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.10),transparent_24%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.10),transparent_22%),linear-gradient(180deg,rgba(10,15,24,0.98),rgba(15,23,42,0.98))]">
      {/* Header */}
      <div className="border-b border-border/50 bg-background/55 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Library className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-foreground">{t('surveyPage.title')}</h2>
              <p className="text-xs text-muted-foreground">{t('surveyPage.description')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main content: left-right split */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: File Content Viewer */}
        <div className="flex-1 min-w-0 overflow-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('surveyPage.loading')}
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-destructive/30 bg-card/60 text-sm text-destructive">
              <AlertCircle className="mr-2 h-4 w-4" />
              {t('surveyPage.errors.loadFailed')}
            </div>
          ) : !selectedItem ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/60 bg-background/40 px-6 text-center text-sm text-muted-foreground">
              {t('surveyPage.empty.noSelection')}
            </div>
          ) : preview.loading ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-border/60 bg-background/40 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('surveyPage.preview.loading')}
            </div>
          ) : preview.error ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-destructive/30 bg-background/40 px-6 text-center text-sm text-destructive">
              <AlertCircle className="mr-2 h-4 w-4" />
              {t('surveyPage.preview.failed')}
            </div>
          ) : (
            <PreviewContent
              file={selectedItem.value}
              preview={preview}
              onOpenMermaidWindow={handleOpenMermaidWindow}
            />
          )}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className="w-1 shrink-0 cursor-col-resize bg-border/30 hover:bg-primary/30 transition-colors"
        />

        {/* Right: Sidebar with directory, stats, tasks, references */}
        <div style={{ width: sidebarWidth }} className="shrink-0 flex flex-col overflow-hidden bg-background/30">
          <div className="overflow-y-auto flex-1 p-3 space-y-3">
            {/* Filter */}
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('surveyPage.filterPlaceholder')}
              className="bg-background text-xs h-8"
            />

            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-2">
              <SummaryCard label={t('surveyPage.summary.papers')} value={papers.length} icon={BookOpen} tone={SECTION_META.papers.tone} />
              <SummaryCard label={t('surveyPage.summary.reports')} value={reports.length} icon={FileText} tone={SECTION_META.reports.tone} />
              <SummaryCard label={t('surveyPage.summary.graphs')} value={graphs.length} icon={Network} tone={SECTION_META.graphs.tone} />
              <SummaryCard label={t('surveyPage.summary.tasks')} value={tasks.length} icon={ClipboardList} tone="text-violet-600 dark:text-violet-400" />
            </div>

            {/* Tasks Panel */}
            <CollapsiblePanel
              title={t('surveyPage.sections.tasks')}
              badge={tasks.length}
              collapsed={collapsedPanels.tasks}
              onToggle={() => togglePanel('tasks')}
              accentClassName="bg-violet-500/70"
            >
              <div className="p-1.5">
                {tasks.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/60 px-2 py-4 text-center text-xs text-muted-foreground">
                    {t('surveyPage.empty.noTasks')}
                  </div>
                ) : (
                  tasks.map((task) => (
                      <div
                        key={task.id}
                        className="mb-1 w-full rounded-lg border border-transparent bg-background/55 px-2 py-2 text-left last:mb-0"
                      >
                        <div className="text-xs font-medium text-foreground">{task.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                          {task.description || t('surveyPage.empty.noTaskDescription')}
                        </div>
                        <Badge variant="secondary" className="mt-1.5 text-[10px] px-1.5 py-0">
                          {task.status || 'pending'}
                        </Badge>
                      </div>
                    )
                  )
                )}
              </div>
            </CollapsiblePanel>

            {/* Library Panel (categorized sections) */}
            <CollapsiblePanel
              title={t('surveyPage.labels.library')}
              badge={papers.length + reports.length + graphs.length + notes.length}
              collapsed={collapsedPanels.library}
              onToggle={() => togglePanel('library')}
              accentClassName="bg-sky-500/70"
            >
              <div className="space-y-2 p-2">
                {sections.map((section) => (
                  <SurveySection
                    key={section.key}
                    sectionKey={section.key}
                    title={section.title}
                    files={section.files}
                    selectedItem={selectedItem}
                    onSelect={handleSelectItem}
                    emptyLabel={t('surveyPage.empty.noSectionFiles', { section: section.title.toLowerCase() })}
                    filter={filter}
                    collapsed={collapsedSections[section.key]}
                    onToggle={() => toggleSection(section.key)}
                  />
                ))}
                {papers.length + reports.length + graphs.length + notes.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                    {t('surveyPage.empty.noSurveyFiles')}
                  </div>
                ) : null}
              </div>
            </CollapsiblePanel>

            {/* References Panel */}
            <CollapsiblePanel
              title={t('surveyPage.sections.references')}
              collapsed={collapsedPanels.references}
              onToggle={() => togglePanel('references')}
              accentClassName="bg-purple-500/70"
            >
              <div className="p-2">
                <ReferencesPanel projectName={selectedProject.name} onChatFromReference={onChatFromReference} />
              </div>
            </CollapsiblePanel>
          </div>
        </div>
      </div>
    </div>
  );
}

function extractMermaidSource(rawContent: string) {
  const fencedMatch = rawContent.match(/```mermaid\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]?.trim()) {
    return fencedMatch[1].trim();
  }

  if (/^\s*(graph|flowchart|mindmap|timeline|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|requirementDiagram)\b/m.test(rawContent)) {
    return rawContent.trim();
  }

  return null;
}
