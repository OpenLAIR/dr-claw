import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Eye,
  EyeOff,
  ExternalLink,
  File,
  FileOutput,
  FlaskConical,
  Folder,
  FolderSearch,
  GitBranch,
  Loader2,
  Terminal,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import ResearchLab from '../../../ResearchLab';
import FileTree from '../../../FileTree';
import ShellWorkspace from '../../../main-content/view/subcomponents/ShellWorkspace';
import GitPanel from '../../../GitPanel';

const AnyGitPanel = GitPanel as any;

import { cn } from '../../../../lib/utils';
import { useDeviceSettings } from '../../../../hooks/useDeviceSettings';
import { authenticatedFetch, api } from '../../../../utils/api';
import type { Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import type { ChatMessage } from '../../types/types';
import { convertCursorSessionMessages, convertSessionMessages } from '../../utils/messageTransforms';
import {
  deriveSessionContextSummary,
  mergeDistinctChatMessages,
  type SessionContextFileItem,
  type SessionContextOutputItem,
  type SessionContextTaskItem,
} from '../../utils/sessionContextSummary';
import ChatContextFilePreview from './ChatContextFilePreview';
import FileThumbnail from './FileThumbnail';
import WorkbenchDialog from '../../../ui/WorkbenchDialog';
import { useContextSidebarResize } from '../../hooks/useContextSidebarResize';
import { useSessionContextReviews } from '../../hooks/useSessionContextReviews';

type ReviewFilter = 'all' | 'unread' | 'reviewed';
type SidebarSectionKey = 'context' | 'tasks' | 'review';
type SidebarSectionState = Record<SidebarSectionKey, boolean>;
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'chat-session-context-collapsed';
const SIDEBAR_SECTIONS_STORAGE_KEY = 'chat-session-context-sections';

type SidebarTab = 'context' | 'research' | 'files' | 'shell' | 'git';

interface ChatContextSidebarProps {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  newSessionMode?: SessionMode;
  chatMessages: ChatMessage[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  activeSidebarTab?: SidebarTab;
  onSidebarTabChange?: (tab: SidebarTab) => void;
  isCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onStartWorkspaceQa?: (project: Project, prompt: string) => void;
  onStartTask?: (prompt?: string, task?: { stage?: string } | null) => void;
}

const formatTimeLabel = (value: string, locale?: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const ItemBadge = ({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'unread' }) => (
  <span
    className={cn(
      'inline-flex shrink-0 items-center whitespace-nowrap rounded px-1 py-0.5 text-xs tabular-nums ',
      tone === 'unread'
        ? 'border-amber-200/80 bg-amber-50/90 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200'
        : 'text-muted-foreground',
    )}
  >
    {children}
  </span>
);

const OpenFileButton = () => <ExternalLink className="h-4 w-4" aria-hidden="true" />;

const ContextStat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex min-w-0 items-baseline justify-between gap-3 py-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words text-right text-sm font-medium tabular-nums text-foreground">{value}</dd>
  </div>
);

const SectionHeader = ({ title, count, icon: Icon, collapsed, onToggle, actions }: {
  title: string;
  count: number;
  icon: LucideIcon;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) => (
  <div className="mb-1 flex flex-wrap items-center gap-x-2">
    <h2 className="min-w-[180px] flex-1">
      <button type="button" onClick={onToggle} aria-expanded={!collapsed}
        className="flex min-h-11 w-full items-center gap-2 rounded-md text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 break-words">{title}</span>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
        {collapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
    </h2>
    {actions}
  </div>
);

const ItemButton = ({ label, secondaryLabel, detail, meta, onClick, action, thumbnail, onRemove }: {
  label: string;
  secondaryLabel?: string;
  detail?: string;
  meta?: ReactNode;
  onClick?: () => void;
  action?: ReactNode;
  thumbnail?: ReactNode;
  onRemove?: () => void;
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => () => {
    if (buttonRef.current?.contains(document.activeElement)) onRemove?.();
  }, [onRemove]);
  const content = <>
    <span className="flex min-w-0 items-start gap-2">
      {thumbnail && <span aria-hidden="true" className="shrink-0">{thumbnail}</span>}
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium leading-5 text-foreground" title={label}>{label}</span>
        {secondaryLabel && <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={secondaryLabel}>{secondaryLabel}</span>}
        {detail && <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">{detail}</span>}
      </span>
    </span>
    {meta && <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">{meta}</span>}
  </>;
  return (
    <div className="flex min-w-0 items-start gap-1 border-b border-border/50 last:border-0">
      {onClick ? <button ref={buttonRef} type="button" onClick={onClick}
        className="min-h-11 min-w-0 flex-1 rounded-md px-1 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</button>
        : <div className="min-w-0 flex-1 px-1 py-2 text-left">{content}</div>}
      {action && <div className="shrink-0 pt-2">{action}</div>}
    </div>
  );
};

export default function ChatContextSidebar({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  newSessionMode = 'research',
  chatMessages,
  onFileOpen,
  activeSidebarTab = 'context',
  onSidebarTabChange,
  isCollapsed: controlledCollapsed,
  onCollapsedChange,
  onStartWorkspaceQa,
  onStartTask,
}: ChatContextSidebarProps) {
  const { t, i18n } = useTranslation('chat');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const [fetchedMessages, setFetchedMessages] = useState<ChatMessage[]>([]);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceRevision, setTraceRevision] = useState(0);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  });
  const [collapsedSections, setCollapsedSections] = useState<SidebarSectionState>(() => {
    if (typeof window === 'undefined') {
      return { context: false, tasks: false, review: false };
    }
    try {
      const rawValue = window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY);
      const parsed = rawValue ? JSON.parse(rawValue) : null;
      return {
        context: parsed?.context === true,
        tasks: parsed?.tasks === true,
        review: parsed?.review === true,
      };
    } catch {
      return { context: false, tasks: false, review: false };
    }
  });
  const [expandedLists, setExpandedLists] = useState<Record<string, boolean>>({});
  const [previewFile, setPreviewFile] = useState<SessionContextFileItem | SessionContextOutputItem | null>(null);
  const [previewTask, setPreviewTask] = useState<SessionContextTaskItem | null>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const isCollapsed = controlledCollapsed ?? uncontrolledCollapsed;
  const isSidebarCollapsed = !isMobile && isCollapsed;
  const { asideRef, sidebarWidth, minWidth, maxWidth, isResizing, handleResizeStart, handleResizeKeyDown, resetWidth } =
    useContextSidebarResize(Boolean(selectedProject), isMobile, isSidebarCollapsed);

  const toggleListExpansion = useCallback((key: string) => {
    setExpandedLists((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const effectiveSessionId = selectedSession?.id || currentSessionId || null;
  const effectiveProvider = (selectedSession?.__provider as SessionProvider | undefined) || provider;
  const projectName = selectedProject?.name || '';
  const sessionProjectPath =
    (typeof selectedSession?.cwd === 'string' && selectedSession.cwd.trim())
    || (typeof selectedSession?.projectPath === 'string' && selectedSession.projectPath.trim())
    || selectedProject?.fullPath
    || selectedProject?.path
    || '';
  const projectPath = selectedProject?.fullPath || selectedProject?.path || '';

  useEffect(() => {
    let cancelled = false;

    const loadFullTrace = async () => {
      if (!selectedProject || !effectiveSessionId) {
        setFetchedMessages([]);
        setIsLoadingTrace(false);
        setTraceError(null);
        return;
      }

      setIsLoadingTrace(true);
      setTraceError(null);

      try {
        if (effectiveProvider === 'cursor') {
          const response = await authenticatedFetch(
            `/api/cursor/sessions/${encodeURIComponent(effectiveSessionId)}?projectPath=${encodeURIComponent(projectPath)}`,
          );
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          const blobs = Array.isArray(data?.session?.messages) ? data.session.messages : [];
          if (!cancelled) {
            setFetchedMessages(convertCursorSessionMessages(blobs, projectPath));
          }
          return;
        }

        const response = await api.sessionMessages(projectName, effectiveSessionId, null, 0, effectiveProvider);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const rawMessages = Array.isArray(data?.messages) ? data.messages : [];
        if (!cancelled) {
          setFetchedMessages(convertSessionMessages(rawMessages));
        }
      } catch (error) {
        if (!cancelled) {
          setFetchedMessages([]);
          setTraceError(error instanceof Error ? error.message : 'Failed to load full session trace.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTrace(false);
        }
      }
    };

    void loadFullTrace();

    return () => {
      cancelled = true;
    };
  }, [effectiveProvider, effectiveSessionId, projectName, projectPath, selectedProject, traceRevision]);

  const { reviews, error: reviewError, busy: reviewBusy, retry: retryReviews, markReviewed: markFileReviewed } =
    useSessionContextReviews(projectName, effectiveSessionId);

  const mergedMessages = useMemo(
    () => mergeDistinctChatMessages(fetchedMessages, chatMessages),
    [chatMessages, fetchedMessages],
  );

  const summary = useMemo(
    () => deriveSessionContextSummary(mergedMessages, sessionProjectPath, reviews),
    [mergedMessages, reviews, sessionProjectPath],
  );

  const filteredOutputFiles = useMemo(() => {
    if (reviewFilter === 'unread') {
      return summary.outputFiles.filter((item) => item.unread);
    }
    if (reviewFilter === 'reviewed') {
      return summary.outputFiles.filter((item) => !item.unread);
    }
    return summary.outputFiles;
  }, [reviewFilter, summary.outputFiles]);
  const contextItemCount = summary.contextFiles.length + summary.directories.length + summary.skills.length;

  const modeLabel = useMemo(() => {
    const mode = selectedSession?.mode || newSessionMode;
    return mode === 'workspace_qa' ? t('session.mode.workspaceQa') : t('session.mode.research');
  }, [newSessionMode, selectedSession?.mode, t]);
  const providerLabel = useMemo(() => {
    if (effectiveProvider === 'codex') return t('messageTypes.codex');
    if (effectiveProvider === 'cursor') return t('messageTypes.cursor');
    if (effectiveProvider === 'gemini') return t('messageTypes.gemini');
    if (effectiveProvider === 'openrouter') return 'OpenRouter';
    if (effectiveProvider === 'local') return 'Local';
    if (effectiveProvider === 'nano') return 'Nano';
    return t('messageTypes.claude');
  }, [effectiveProvider, t]);
  const getTaskKindLabel = useCallback((kind: string) => {
    if (kind === 'todo') return t('sessionContext.kinds.todo');
    if (kind === 'skill') return t('sessionContext.kinds.skill');
    if (kind === 'directory') return t('sessionContext.kinds.directory');
    return t('sessionContext.kinds.task');
  }, [t]);
  const setCollapsedState = useCallback((nextValue: boolean | ((current: boolean) => boolean)) => {
    const resolvedValue = typeof nextValue === 'function'
      ? nextValue(isCollapsed)
      : nextValue;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, resolvedValue ? '1' : '0');
    }
    if (controlledCollapsed === undefined) {
      setUncontrolledCollapsed(resolvedValue);
    }
    onCollapsedChange?.(resolvedValue);
  }, [controlledCollapsed, isCollapsed, onCollapsedChange]);
  const toggleCollapsed = useCallback(() => {
    if (isMobile) {
      return;
    }
    setCollapsedState((current) => !current);
  }, [isMobile, setCollapsedState]);
  const openContextFile = useCallback((file: SessionContextFileItem) => {
    const openPath = file.absolutePath || file.relativePath;
    onFileOpen?.(openPath);
  }, [onFileOpen]);
  const openReviewFile = useCallback((file: SessionContextOutputItem) => {
    const openPath = file.absolutePath || file.relativePath;
    if (file.unread) {
      void markFileReviewed(file);
    }
    onFileOpen?.(openPath);
  }, [markFileReviewed, onFileOpen]);
  const handleFilePreview = useCallback((file: SessionContextFileItem | SessionContextOutputItem) => {
    previewTriggerRef.current = document.activeElement as HTMLElement;
    if ('unread' in file && file.unread) {
      void markFileReviewed(file as SessionContextOutputItem);
    }
    setPreviewFile(file);
  }, [markFileReviewed]);
  const focusReviewFilter = useCallback(() => {
    asideRef.current?.querySelector<HTMLButtonElement>('[data-review-filter][aria-pressed="true"]')?.focus();
  }, [asideRef]);
  const handleClosePreview = useCallback(() => {
    setPreviewFile(null); setPreviewTask(null); setPreviewContent(null);
    // Opening an unread output can remove its row from the active filter.
    const trigger = previewTriggerRef.current;
    requestAnimationFrame(() => { if (trigger && !trigger.isConnected) focusReviewFilter(); });
  }, [focusReviewFilter]);
  const handleOpenInEditor = useCallback((filePath: string) => {
    setPreviewFile(null);
    onFileOpen?.(filePath);
  }, [onFileOpen]);
  const handleTaskPreview = useCallback((task: SessionContextTaskItem) => {
    previewTriggerRef.current = document.activeElement as HTMLElement;
    setPreviewTask(task);
  }, []);
  const handleSkillPreview = useCallback(async (entry: SessionContextTaskItem) => {
    previewTriggerRef.current = document.activeElement as HTMLElement;
    // If we already have a resolved path under the project, use the file preview directly
    if (entry.path && sessionProjectPath && entry.path.startsWith(sessionProjectPath)) {
      const relativePath = entry.path.slice(sessionProjectPath.length).replace(/^\//, '');
      setPreviewContent(null);
      setPreviewFile({
        key: entry.key,
        name: 'SKILL.md',
        relativePath,
        absolutePath: entry.path,
        reasons: ['Skill'],
        count: entry.count,
        lastSeenAt: entry.lastSeenAt,
      });
      return;
    }
    // Resolve via API (handles paths outside project root and skills without stored path)
    try {
      const response = await api.resolveSkill(entry.label, sessionProjectPath);
      if (!response.ok) {
        console.warn(`[Sidebar] Failed to resolve skill "${entry.label}": ${response.status}`);
        setPreviewTask(entry);
        return;
      }
      const data = await response.json();
      setPreviewContent(data.content);
      setPreviewFile({
        key: entry.key,
        name: 'SKILL.md',
        relativePath: data.path,
        absolutePath: data.path,
        reasons: ['Skill'],
        count: entry.count,
        lastSeenAt: entry.lastSeenAt,
      });
    } catch (err) {
      console.warn('[Sidebar] Skill resolve error:', err);
      setPreviewTask(entry);
    }
  }, [sessionProjectPath]);
  const toggleSection = useCallback((key: SidebarSectionKey) => {
    setCollapsedSections((current) => {
      const nextValue = { ...current, [key]: !current[key] };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SIDEBAR_SECTIONS_STORAGE_KEY, JSON.stringify(nextValue));
      }
      return nextValue;
    });
  }, []);

  if (!selectedProject) {
    return null;
  }

  return (
    <>
      {!isMobile && !isSidebarCollapsed && (
        <div className="relative w-0 shrink-0">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('sessionContext.actions.resize')}
            aria-valuemin={Math.round(minWidth)}
            aria-valuemax={Math.round(maxWidth)}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onPointerDown={handleResizeStart}
            onKeyDown={handleResizeKeyDown}
            onDoubleClick={resetWidth}
            data-resizing={isResizing}
            className="context-sidebar-resizer electron-no-drag"
            title={t('sessionContext.actions.resizeHint')}
          />
        </div>
      )}

      <aside
        aria-label={t('sessionContext.title')}
        ref={asideRef}
        className={`flex min-h-0 flex-col bg-card ${
          isMobile
            ? 'w-full flex-1 overflow-hidden border-t border-border/60'
            : `overflow-hidden border-l border-border/60 ${isSidebarCollapsed ? 'w-[56px] flex-shrink-0' : 'min-w-0 shrink-0'}`
        }`}
        style={!isMobile && !isSidebarCollapsed ? { width: `${sidebarWidth}px` } : undefined}
      >
      <div className="border-b border-border/60 px-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          {!isSidebarCollapsed && (
            <div className="grid min-w-0 flex-1 grid-cols-5 gap-1">
              {([
                { id: 'context' as SidebarTab, icon: FolderSearch, labelKey: 'sessionContext.sidebarTabs.context' },
                { id: 'research' as SidebarTab, icon: FlaskConical, labelKey: 'sessionContext.sidebarTabs.research' },
                { id: 'files' as SidebarTab, icon: Folder, labelKey: 'sessionContext.sidebarTabs.files' },
                { id: 'shell' as SidebarTab, icon: Terminal, labelKey: 'sessionContext.sidebarTabs.shell' },
                { id: 'git' as SidebarTab, icon: GitBranch, labelKey: 'sessionContext.sidebarTabs.git' },
              ]).map((tab) => {
                const TabIcon = tab.icon;
                const isActive = tab.id === activeSidebarTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onSidebarTabChange?.(tab.id)}
                    className={`relative flex min-h-11 min-w-0 flex-col items-center justify-start gap-1 rounded-md px-1 py-2 text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-muted text-foreground '
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <TabIcon className="w-3.5 h-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
                    <span className="w-full break-words text-center leading-4">{t(tab.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-shrink-0 items-center gap-2">
            {isLoadingTrace && activeSidebarTab === 'context' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {!isMobile && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-muted-foreground  transition-colors hover:text-foreground"
                title={isSidebarCollapsed ? t('sessionContext.actions.expand') : t('sessionContext.actions.collapse')}
              >
                {isSidebarCollapsed ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        {!isSidebarCollapsed && activeSidebarTab === 'context' && (
          <>

        <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1">
          <ContextStat label={t('sessionContext.stats.mode')} value={modeLabel} />
          <ContextStat label={t('sessionContext.stats.provider')} value={providerLabel} />
          <ContextStat label={t('sessionContext.stats.contextFiles')} value={summary.contextFiles.length} />
          <ContextStat label={t('sessionContext.stats.unreadOutputs')} value={summary.unreadCount} />
        </dl>

        {effectiveProvider === 'codex' && (
          <div className="mt-3 rounded-lg border border-amber-200/60 bg-amber-50/80 px-3 py-2.5 text-xs leading-5 text-amber-800  dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {t('sessionContext.codexNotice')}
          </div>
        )}

        {traceError && (
          <div role="alert" className="mt-3 text-sm leading-5 text-destructive">
            {t('sessionContext.traceError')}
            <button type="button" className="mt-1 block min-h-11 rounded-md px-2 text-sm font-medium hover:bg-muted" onClick={() => setTraceRevision(value => value + 1)}>{t('error.retry')}</button>
          </div>
        )}
          </>
        )}
      </div>

      {isSidebarCollapsed ? (
        <div className="flex flex-1 flex-col items-center gap-2 p-3 pt-4">
          {([
            { id: 'context' as SidebarTab, icon: FolderSearch, labelKey: 'sessionContext.sidebarTabs.context' },
            { id: 'research' as SidebarTab, icon: FlaskConical, labelKey: 'sessionContext.sidebarTabs.research' },
            { id: 'files' as SidebarTab, icon: Folder, labelKey: 'sessionContext.sidebarTabs.files' },
            { id: 'shell' as SidebarTab, icon: Terminal, labelKey: 'sessionContext.sidebarTabs.shell' },
            { id: 'git' as SidebarTab, icon: GitBranch, labelKey: 'sessionContext.sidebarTabs.git' },
          ]).map((tab) => {
            const TabIcon = tab.icon;
            const isActive = tab.id === activeSidebarTab;
            return (
              <button
                key={tab.id}
                type="button"
                  onClick={() => {
                    onSidebarTabChange?.(tab.id);
                    // Use the same state setter pattern as toggleCollapsed — the
                    // setter persists to localStorage so we avoid split writes.
                  setCollapsedState((current) => {
                      if (current && typeof window !== 'undefined') {
                        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, '0');
                      }
                      return false;
                    });
                  }}
                className={cn(
                  'inline-flex h-10 w-10 items-center justify-center rounded-lg border  transition-colors',
                  isActive
                    ? 'border-primary/30 bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title={t(tab.labelKey)}
              >
                <TabIcon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      ) : activeSidebarTab === 'context' ? (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
        <section className="border-b border-border/60 pb-3 last:border-0">
          <SectionHeader
            title={t('sessionContext.sections.injectedContext')}
            count={contextItemCount}
            icon={FolderSearch}
            collapsed={collapsedSections.context}
            onToggle={() => toggleSection('context')}
          />
          {!collapsedSections.context && (
          <div className="space-y-1">
            {summary.contextFiles.length === 0 && summary.directories.length === 0 && summary.skills.length === 0 && (
              <div className="py-2 text-sm leading-6 text-muted-foreground">
                {t('sessionContext.empty.injectedContext')}
              </div>
            )}

            {(expandedLists.contextFiles ? summary.contextFiles : summary.contextFiles.slice(0, 3)).map((file) => (
              <ItemButton
                key={file.key}
                label={file.name}
                secondaryLabel={file.relativePath}
                onClick={() => handleFilePreview(file)}
                thumbnail={<FileThumbnail projectName={projectName} absolutePath={file.absolutePath || file.relativePath} fileName={file.name} />}
                action={<button type="button" aria-label={t('sessionContext.preview.openFile', { name: file.name })} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => openContextFile(file)}><OpenFileButton /></button>}
                meta={
                  <>
                    {file.reasons[0] ? <ItemBadge>{file.reasons[0]}</ItemBadge> : null}
                    <ItemBadge>{file.count}x</ItemBadge>
                    <ItemBadge>{formatTimeLabel(file.lastSeenAt, i18n.language)}</ItemBadge>
                  </>
                }
              />
            ))}
            {summary.contextFiles.length > 3 && (
              <button type="button" className="min-h-11 w-full rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('contextFiles')}>
                {expandedLists.contextFiles ? t('sessionContext.showLess') : t('sessionContext.showMore', { count: summary.contextFiles.length - 3 })}
              </button>
            )}

            {(expandedLists.directories ? summary.directories : summary.directories.slice(0, 3)).map((entry) => (
              <ItemButton
                key={entry.key}
                label={entry.label}
                detail={entry.detail}
                meta={<ItemBadge>{formatTimeLabel(entry.lastSeenAt, i18n.language)}</ItemBadge>}
              />
            ))}
            {summary.directories.length > 3 && (
              <button type="button" className="min-h-11 w-full rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('directories')}>
                {expandedLists.directories ? t('sessionContext.showLess') : t('sessionContext.showMore', { count: summary.directories.length - 3 })}
              </button>
            )}

            {summary.skills.length > 0 && (
              <>
                <div className="flex items-center gap-2 pt-2">
                  <Zap className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground dark:text-muted-foreground">
                    {t('sessionContext.sections.skillsSubheader')}
                  </span>
                  <div className="h-px flex-1 bg-border/50" />
                </div>
                {(expandedLists.skills ? summary.skills : summary.skills.slice(0, 5)).map((entry) => (
                  <button
                    type="button"
                    key={entry.key}
                    onClick={() => handleSkillPreview(entry)}
                    className="flex min-h-11 w-full flex-wrap items-center gap-2 rounded-md px-1 py-2 text-left transition-colors hover:bg-muted"
                  >
                    <Zap className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                      {entry.label}
                    </span>
                    <ItemBadge>{formatTimeLabel(entry.lastSeenAt, i18n.language)}</ItemBadge>
                  </button>
                ))}
                {summary.skills.length > 5 && (
                  <button type="button" className="min-h-11 w-full rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('skills')}>
                    {expandedLists.skills ? t('sessionContext.showLess') : t('sessionContext.showMore', { count: summary.skills.length - 5 })}
                  </button>
                )}
              </>
            )}
          </div>
          )}
        </section>

        <section className="border-b border-border/60 pb-3 last:border-0">
          <SectionHeader
            title={t('sessionContext.sections.taskContext')}
            count={summary.tasks.length}
            icon={ClipboardList}
            collapsed={collapsedSections.tasks}
            onToggle={() => toggleSection('tasks')}
          />
          {!collapsedSections.tasks && (
          <div className="space-y-1.5">
            {summary.tasks.length === 0 ? (
              <div className="py-2 text-sm leading-6 text-muted-foreground">
                {t('sessionContext.empty.taskContext')}
              </div>
            ) : (
              (expandedLists.tasks ? summary.tasks : summary.tasks.slice(0, 6)).map((entry) => (
                <ItemButton key={entry.key} label={entry.label} detail={entry.detail}
                  onClick={() => handleTaskPreview(entry)}
                  meta={<><ItemBadge>{getTaskKindLabel(entry.kind)}</ItemBadge><ItemBadge>{formatTimeLabel(entry.lastSeenAt, i18n.language)}</ItemBadge></>}
                />
              ))
            )}
            {summary.tasks.length > 6 && (
              <button type="button" className="min-h-11 w-full rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('tasks')}>
                {expandedLists.tasks ? t('sessionContext.showLess') : t('sessionContext.showMore', { count: summary.tasks.length - 6 })}
              </button>
            )}
          </div>
          )}
        </section>

        <section className="border-b border-border/60 pb-3 last:border-0">
          <SectionHeader
            title={t('sessionContext.sections.reviewQueue')}
            count={filteredOutputFiles.length}
            icon={FileOutput}
            collapsed={collapsedSections.review}
            onToggle={() => toggleSection('review')}
            actions={!collapsedSections.review ? (
            <div className="flex flex-wrap items-center gap-1">
              {([
                { value: 'all', labelKey: 'sessionContext.filters.all' },
                { value: 'unread', labelKey: 'sessionContext.filters.unread' },
                { value: 'reviewed', labelKey: 'sessionContext.filters.reviewed' },
              ] as Array<{ value: ReviewFilter; labelKey: string }>).map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  data-review-filter
                  aria-pressed={reviewFilter === filter.value}
                  onClick={() => setReviewFilter(filter.value)}
                  className={`min-h-11 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                    reviewFilter === filter.value
                      ? 'bg-muted text-foreground '
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(filter.labelKey)}
                </button>
              ))}
            </div>
            ) : undefined}
          />

          {!collapsedSections.review && (
          <div className="space-y-1">
            {reviewError && <div role="alert" className="py-2 text-sm text-destructive">
              <p>{t(reviewError === 'load' ? 'sessionContext.reviewLoadError' : 'sessionContext.reviewSaveError')}</p>
              <button type="button" disabled={reviewBusy} onClick={retryReviews} className="min-h-11 rounded-md px-2 font-medium hover:bg-muted disabled:opacity-50">{t('error.retry')}</button>
            </div>}
            {filteredOutputFiles.length === 0 ? (
              <div className="py-2 text-sm leading-6 text-muted-foreground">
                {t(reviewFilter === 'all' ? 'sessionContext.empty.reviewQueue' : 'sessionContext.empty.filteredReview')}
              </div>
            ) : (
              (expandedLists.outputFiles ? filteredOutputFiles : filteredOutputFiles.slice(0, 8)).map((file) => (
                <ItemButton
                  key={file.key}
                  onRemove={focusReviewFilter}
                  label={file.name}
                  secondaryLabel={file.relativePath}
                  onClick={() => handleFilePreview(file)}
                  thumbnail={<FileThumbnail projectName={projectName} absolutePath={file.absolutePath || file.relativePath} fileName={file.name} />}
                  action={<button type="button" aria-label={t('sessionContext.preview.openFile', { name: file.name })} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => { void openReviewFile(file); }}><OpenFileButton /></button>}
                  meta={
                    <>
                      {file.reasons[0] ? <ItemBadge>{file.reasons[0]}</ItemBadge> : null}
                      <ItemBadge>{file.count}x</ItemBadge>
                      <ItemBadge>{formatTimeLabel(file.lastSeenAt, i18n.language)}</ItemBadge>
                      <ItemBadge tone={file.unread ? 'unread' : 'default'}>{file.unread ? <><EyeOff className="mr-1 h-3 w-3" />{t('sessionContext.filters.unread')}</> : <><Eye className="mr-1 h-3 w-3" />{t('sessionContext.filters.reviewed')}</>}</ItemBadge>
                    </>
                  }
                />
              ))
            )}
            {filteredOutputFiles.length > 8 && (
              <button type="button" className="min-h-11 w-full rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('outputFiles')}>
                {expandedLists.outputFiles ? t('sessionContext.showLess') : t('sessionContext.showMore', { count: filteredOutputFiles.length - 8 })}
              </button>
            )}
          </div>
          )}
        </section>
      </div>
      ) : activeSidebarTab === 'research' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ResearchLab
            selectedProject={selectedProject}
            onNavigateToChat={() => onSidebarTabChange?.('context')}
            compact
            onFileOpen={onFileOpen}
            onStartTask={onStartTask}
          />
        </div>
      ) : activeSidebarTab === 'files' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <FileTree
            selectedProject={selectedProject}
            onFileOpen={onFileOpen}
            onStartWorkspaceQa={onStartWorkspaceQa}
          />
        </div>
      ) : activeSidebarTab === 'shell' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ShellWorkspace project={selectedProject!} session={selectedSession} />
        </div>
      ) : activeSidebarTab === 'git' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AnyGitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={onFileOpen} />
        </div>
      ) : null}
    </aside>

      {(previewFile || previewTask) && (
        <WorkbenchDialog title={previewFile?.name || previewTask?.label || t('sessionContext.preview.titleFallback')} onClose={handleClosePreview} size="wide">
          {previewFile ? (
            <ChatContextFilePreview projectName={projectName} file={previewFile} embedded
              onOpenInEditor={handleOpenInEditor} preloadedContent={previewContent} />
          ) : previewTask ? (
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <ItemBadge>{getTaskKindLabel(previewTask.kind)}</ItemBadge>
                <ItemBadge>{formatTimeLabel(previewTask.lastSeenAt, i18n.language)}</ItemBadge>
                <ItemBadge>{previewTask.count}x</ItemBadge>
              </div>
              {previewTask.detail && <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{previewTask.detail}</p>}
            </div>
          ) : null}
        </WorkbenchDialog>
      )}
    </>
  );
}
