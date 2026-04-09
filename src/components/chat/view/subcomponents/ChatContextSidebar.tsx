import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
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
  X,
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
  type SessionReviewState,
} from '../../utils/sessionContextSummary';
import ChatContextFilePreview from './ChatContextFilePreview';
import FileThumbnail from './FileThumbnail';

type ReviewFilter = 'all' | 'unread' | 'reviewed';
type SidebarSectionKey = 'context' | 'tasks' | 'review';
type SidebarSectionState = Record<SidebarSectionKey, boolean>;
type SectionTone = 'context' | 'tasks' | 'review';

const SIDEBAR_WIDTH_STORAGE_KEY = 'chat-session-context-width';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'chat-session-context-collapsed';
const SIDEBAR_SECTIONS_STORAGE_KEY = 'chat-session-context-sections';
const DEFAULT_SIDEBAR_WIDTH = 480;
const MIN_SIDEBAR_WIDTH = 360;
const MAX_SIDEBAR_WIDTH = 840;
const SECTION_STYLES: Record<SectionTone, {
  panel: string;
  glow: string;
  icon: string;
  count: string;
}> = {
  context: {
    panel: 'border-emerald-200/70 bg-gradient-to-b from-emerald-50/40 via-background to-background dark:border-emerald-900/40 dark:from-emerald-950/10',
    glow: 'from-emerald-300/60 via-emerald-200/20 to-transparent dark:from-emerald-700/50 dark:via-emerald-900/20',
    icon: 'border-emerald-200/80 bg-emerald-50/95 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200',
    count: 'border-emerald-200/80 bg-emerald-50/95 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200',
  },
  tasks: {
    panel: 'border-sky-200/70 bg-gradient-to-b from-sky-50/35 via-background to-background dark:border-sky-900/40 dark:from-sky-950/10',
    glow: 'from-sky-300/60 via-sky-200/20 to-transparent dark:from-sky-700/50 dark:via-sky-900/20',
    icon: 'border-sky-200/80 bg-sky-50/95 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200',
    count: 'border-sky-200/80 bg-sky-50/95 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200',
  },
  review: {
    panel: 'border-amber-200/75 bg-gradient-to-b from-amber-50/35 via-background to-background dark:border-amber-900/40 dark:from-amber-950/10',
    glow: 'from-amber-300/65 via-amber-200/20 to-transparent dark:from-amber-700/55 dark:via-amber-900/20',
    icon: 'border-amber-200/80 bg-amber-50/95 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
    count: 'border-amber-200/80 bg-amber-50/95 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
  },
};

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
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm',
      tone === 'unread'
        ? 'border-amber-200/80 bg-amber-50/90 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200'
        : 'border-border/70 bg-background/90 text-muted-foreground',
    )}
  >
    {children}
  </span>
);

const OpenFileButton = ({ title }: { title: string }) => (
  <span
    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/70 bg-background/95 text-muted-foreground shadow-sm transition-colors group-hover:border-primary/30 group-hover:text-foreground"
    title={title}
  >
    <ExternalLink className="h-3 w-3" />
  </span>
);

const StatCard = ({
  label,
  value,
  accentClassName,
}: {
  label: string;
  value: ReactNode;
  accentClassName: string;
}) => (
  <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-background via-background to-muted/30 px-3 py-2.5 shadow-sm">
    <div className={cn('absolute -right-4 -top-4 h-12 w-12 rounded-full blur-2xl opacity-45', accentClassName)} />
    <div className={cn('absolute inset-x-0 top-0 h-px opacity-80', accentClassName)} />
    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
    <div className="mt-1 truncate text-[15px] font-semibold tracking-tight text-foreground">{value}</div>
  </div>
);

const SectionCountBadge = ({ count, tone }: { count: number; tone: SectionTone }) => (
  <span className={cn('inline-flex min-w-[1.75rem] items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm', SECTION_STYLES[tone].count)}>
    {count}
  </span>
);

const SectionHeader = ({
  title,
  count,
  tone,
  icon: Icon,
  collapsed,
  onToggle,
  actions,
}: {
  title: string;
  count: number;
  tone: SectionTone;
  icon: LucideIcon;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) => (
  <>
    <div className="mb-3 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border shadow-sm', SECTION_STYLES[tone].icon)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12px] font-semibold tracking-[0.08em] text-foreground">{title}</span>
            <SectionCountBadge count={count} tone={tone} />
          </div>
        </div>
        {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {actions}
    </div>
    {!collapsed ? <div className={cn('mb-3 h-px bg-gradient-to-r', SECTION_STYLES[tone].glow)} /> : null}
  </>
);

const ItemButton = ({
  label,
  secondaryLabel,
  detail,
  meta,
  unread = false,
  onClick,
  compact = false,
  action,
  thumbnail,
}: {
  label: string;
  secondaryLabel?: string;
  detail?: string;
  meta?: ReactNode;
  unread?: boolean;
  onClick?: () => void;
  compact?: boolean;
  action?: ReactNode;
  thumbnail?: ReactNode;
}) => {
  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
        className="group w-full rounded-xl border border-border/60 bg-gradient-to-r from-background via-background to-muted/20 px-2.5 py-2 text-left shadow-sm transition-all hover:border-border hover:from-accent/20 hover:to-accent/10 cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          {thumbnail || <span className={cn('h-2 w-2 flex-shrink-0 rounded-full shadow-sm', unread ? 'bg-amber-500' : 'bg-emerald-500/80')} />}
          <div className="min-w-0 flex-1 truncate text-[12px] leading-5 text-foreground">
            <span className="font-semibold">{label}</span>
            {secondaryLabel ? <span className="text-[10px] text-muted-foreground">{` · ${secondaryLabel}`}</span> : null}
          </div>
          {meta ? <div className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap pl-1">{meta}</div> : null}
          {action ? <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>{action}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      className="group w-full rounded-xl border border-border/60 bg-gradient-to-r from-background via-background to-muted/20 px-3 py-2 text-left shadow-sm transition-all hover:border-border hover:from-accent/20 hover:to-accent/10 cursor-pointer"
    >
      <div className="flex items-start gap-2">
        {thumbnail || <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${unread ? 'bg-amber-500' : 'bg-emerald-500/70'}`} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 line-clamp-1 break-all text-sm font-semibold leading-5 text-foreground">{label}</div>
            {action ? <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>{action}</div> : null}
          </div>
          {secondaryLabel && (
            <div className="mt-0.5 line-clamp-1 break-all text-[10px] text-muted-foreground">
              {secondaryLabel}
            </div>
          )}
          {detail && (
            <div className="mt-0.5 line-clamp-1 text-[10px] leading-4 text-muted-foreground">
              {detail}
            </div>
          )}
          {meta && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {meta}
            </div>
          )}
        </div>
      </div>
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
  const [reviews, setReviews] = useState<SessionReviewState>({});
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_SIDEBAR_WIDTH;
    }
    const rawValue = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = rawValue ? Number.parseInt(rawValue, 10) : NaN;
    return Number.isFinite(parsed) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed)) : DEFAULT_SIDEBAR_WIDTH;
  });
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
  const [isResizing, setIsResizing] = useState(false);
  const [previewFile, setPreviewFile] = useState<SessionContextFileItem | SessionContextOutputItem | null>(null);
  const [previewTask, setPreviewTask] = useState<SessionContextTaskItem | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const isCollapsed = controlledCollapsed ?? uncontrolledCollapsed;
  const isSidebarCollapsed = !isMobile && isCollapsed;

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
  }, [effectiveProvider, effectiveSessionId, projectName, projectPath, selectedProject]);

  useEffect(() => {
    let cancelled = false;

    const loadReviews = async () => {
      if (!selectedProject || !effectiveSessionId) {
        setReviews({});
        return;
      }

      try {
        const response = await api.sessionContextReview(projectName, effectiveSessionId);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!cancelled) {
          setReviews(data?.reviews && typeof data.reviews === 'object' ? data.reviews : {});
        }
      } catch {
        if (!cancelled) {
          setReviews({});
        }
      }
    };

    void loadReviews();

    return () => {
      cancelled = true;
    };
  }, [effectiveSessionId, projectName, selectedProject]);

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
  const contextItemCount = summary.contextFiles.length + summary.directories.length;

  const modeLabel = useMemo(() => {
    const mode = selectedSession?.mode || newSessionMode;
    return mode === 'workspace_qa' ? t('session.mode.workspaceQa') : t('session.mode.research');
  }, [newSessionMode, selectedSession?.mode, t]);
  const providerLabel = useMemo(() => {
    if (effectiveProvider === 'codex') return t('messageTypes.codex');
    if (effectiveProvider === 'cursor') return t('messageTypes.cursor');
    if (effectiveProvider === 'gemini') return t('messageTypes.gemini');
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
  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (isMobile) {
      return;
    }
    event.preventDefault();
    setIsResizing(true);
  }, [isMobile]);

  const persistReviews = useCallback(async (nextReviews: SessionReviewState) => {
    setReviews(nextReviews);

    if (!selectedProject || !effectiveSessionId) {
      return;
    }

    try {
      await api.updateSessionContextReview(projectName, effectiveSessionId, nextReviews);
    } catch {
      // Keep optimistic local state even if persistence fails.
    }
  }, [effectiveSessionId, projectName, selectedProject]);

  const markFileReviewed = useCallback(async (file: SessionContextOutputItem) => {
    const nextReviews: SessionReviewState = {
      ...reviews,
      [file.relativePath]: {
        reviewedAt: new Date().toISOString(),
        lastSeenAt: file.lastSeenAt,
        lastReviewedSeenAt: file.lastSeenAt,
      },
    };
    await persistReviews(nextReviews);
  }, [persistReviews, reviews]);
  const openContextFile = useCallback((file: SessionContextFileItem) => {
    const openPath = file.absolutePath || file.relativePath;
    onFileOpen?.(openPath);
  }, [onFileOpen]);
  const openReviewFile = useCallback(async (file: SessionContextOutputItem) => {
    const openPath = file.absolutePath || file.relativePath;
    if (file.unread) {
      await markFileReviewed(file);
    }
    onFileOpen?.(openPath);
  }, [markFileReviewed, onFileOpen]);
  const handleFilePreview = useCallback((file: SessionContextFileItem | SessionContextOutputItem) => {
    if ('unread' in file && file.unread) {
      void markFileReviewed(file as SessionContextOutputItem);
    }
    setPreviewFile(file);
  }, [markFileReviewed]);
  const handleClosePreview = useCallback(() => { setPreviewFile(null); setPreviewTask(null); setPreviewContent(null); }, []);
  const handleOpenInEditor = useCallback((filePath: string) => {
    setPreviewFile(null);
    onFileOpen?.(filePath);
  }, [onFileOpen]);
  const handleTaskPreview = useCallback((task: SessionContextTaskItem) => {
    setPreviewTask(task);
  }, []);
  const handleSkillPreview = useCallback(async (entry: SessionContextTaskItem) => {
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

  useEffect(() => {
    if (isMobile && isResizing) {
      setIsResizing(false);
    }
  }, [isMobile, isResizing]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const rightEdge = asideRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      const nextWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, rightEdge - event.clientX));
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
      } catch {
        // Ignore quota-exceeded or access-denied errors
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [sidebarWidth]);

  useEffect(() => {
    if (!previewFile && !previewTask) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setPreviewFile(null);
        setPreviewTask(null);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [previewFile, previewTask]);

  if (!selectedProject) {
    return null;
  }

  return (
    <>
      {!isSidebarCollapsed && (
        <div
          onMouseDown={handleResizeStart}
          className={isMobile ? 'hidden' : 'block w-1 flex-shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/25'}
          title={t('sessionContext.actions.resize')}
        />
      )}

      <aside
        ref={asideRef}
        className={`flex min-h-0 flex-col bg-gradient-to-b from-card via-card to-muted/20 backdrop-blur ${
          isMobile
            ? 'w-full border-t border-border/60'
            : `flex-shrink-0 border-l border-border/60 ${isSidebarCollapsed ? 'w-[56px]' : ''}`
        }`}
        style={!isMobile && !isSidebarCollapsed ? { width: `${sidebarWidth}px` } : undefined}
      >
      <div className="border-b border-border/60 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          {!isSidebarCollapsed && (
            <div className="inline-flex items-center bg-muted/60 rounded-lg p-[3px] gap-[2px]">
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
                    onClick={() => onSidebarTabChange?.(tab.id)}
                    className={`relative flex items-center gap-1.5 px-2.5 py-[5px] text-xs font-medium rounded-md transition-all duration-150 ${
                      isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <TabIcon className="w-3.5 h-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
                    <span>{t(tab.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            {isLoadingTrace && activeSidebarTab === 'context' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {!isMobile && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-background/85 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                title={isSidebarCollapsed ? t('sessionContext.actions.expand') : t('sessionContext.actions.collapse')}
              >
                {isSidebarCollapsed ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        {!isSidebarCollapsed && activeSidebarTab === 'context' && (
          <>

        <div className="mt-3 grid grid-cols-4 gap-2">
          <StatCard label={t('sessionContext.stats.mode')} value={modeLabel} accentClassName="bg-emerald-400/70" />
          <StatCard label={t('sessionContext.stats.provider')} value={providerLabel} accentClassName="bg-sky-400/70" />
          <StatCard label={t('sessionContext.stats.contextFiles')} value={summary.contextFiles.length} accentClassName="bg-violet-400/70" />
          <StatCard label={t('sessionContext.stats.unreadOutputs')} value={summary.unreadCount} accentClassName="bg-amber-400/70" />
        </div>

        {effectiveProvider === 'codex' && (
          <div className="mt-3 rounded-2xl border border-amber-200/60 bg-amber-50/80 px-3 py-2.5 text-[11px] leading-5 text-amber-800 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {t('sessionContext.codexNotice')}
          </div>
        )}

        {traceError && (
          <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[11px] leading-5 text-destructive shadow-sm">
            {t('sessionContext.traceError')}
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
                  'inline-flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm transition-colors',
                  isActive
                    ? 'border-primary/30 bg-primary/10 text-foreground'
                    : 'border-border/70 bg-background/85 text-muted-foreground hover:text-foreground',
                )}
                title={t(tab.labelKey)}
              >
                <TabIcon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      ) : activeSidebarTab === 'context' ? (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <section className={`rounded-[22px] border p-3.5 shadow-sm ${SECTION_STYLES.context.panel} ${collapsedSections.context ? '' : 'flex min-h-[220px] flex-1 flex-col overflow-hidden'}`}>
          <SectionHeader
            title={t('sessionContext.sections.injectedContext')}
            count={contextItemCount}
            tone="context"
            icon={FolderSearch}
            collapsed={collapsedSections.context}
            onToggle={() => toggleSection('context')}
          />
          {!collapsedSections.context && (
          <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
            {summary.contextFiles.length === 0 && summary.directories.length === 0 && summary.skills.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
                {t('sessionContext.empty.injectedContext')}
              </div>
            )}

            {(expandedLists.contextFiles ? summary.contextFiles : summary.contextFiles.slice(0, 6)).map((file) => (
              <ItemButton
                key={file.key}
                label={file.name}
                secondaryLabel={file.relativePath}
                compact
                onClick={() => handleFilePreview(file)}
                thumbnail={<FileThumbnail projectName={projectName} absolutePath={file.absolutePath || file.relativePath} fileName={file.name} />}
                action={<button type="button" onClick={() => openContextFile(file)}><OpenFileButton title={t('sessionContext.preview.open')} /></button>}
                meta={
                  <>
                    {file.reasons[0] ? <ItemBadge>{file.reasons[0]}</ItemBadge> : null}
                    <ItemBadge>{file.count}x</ItemBadge>
                    <ItemBadge>{formatTimeLabel(file.lastSeenAt, i18n.language)}</ItemBadge>
                  </>
                }
              />
            ))}
            {summary.contextFiles.length > 6 && (
              <button type="button" className="w-full rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('contextFiles')}>
                {expandedLists.contextFiles ? t('sessionContext.showLess') : `${summary.contextFiles.length - 6} more...`}
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
              <button type="button" className="w-full rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('directories')}>
                {expandedLists.directories ? t('sessionContext.showLess') : `${summary.directories.length - 3} more...`}
              </button>
            )}

            {summary.skills.length > 0 && (
              <>
                <div className="flex items-center gap-2 pt-2">
                  <Zap className="h-3 w-3 text-violet-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                    {t('sessionContext.sections.skillsSubheader')}
                  </span>
                  <div className="h-px flex-1 bg-border/50" />
                </div>
                {(expandedLists.skills ? summary.skills : summary.skills.slice(0, 5)).map((entry) => (
                  <button
                    type="button"
                    key={entry.key}
                    onClick={() => handleSkillPreview(entry)}
                    className="flex w-full items-center gap-2 rounded-lg border border-violet-200/60 bg-violet-50/30 px-2.5 py-1.5 text-left transition-all hover:border-violet-300 hover:bg-violet-50/50 dark:border-violet-900/40 dark:bg-violet-950/20 dark:hover:border-violet-800/60 dark:hover:bg-violet-950/30 cursor-pointer"
                  >
                    <Zap className="h-3 w-3 flex-shrink-0 text-violet-500/80" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                      {entry.label}
                    </span>
                    <ItemBadge>{formatTimeLabel(entry.lastSeenAt, i18n.language)}</ItemBadge>
                  </button>
                ))}
                {summary.skills.length > 5 && (
                  <button type="button" className="w-full rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('skills')}>
                    {expandedLists.skills ? t('sessionContext.showLess') : `${summary.skills.length - 5} more...`}
                  </button>
                )}
              </>
            )}
          </div>
          )}
        </section>

        <section className={`rounded-[22px] border p-3.5 shadow-sm ${SECTION_STYLES.tasks.panel}`}>
          <SectionHeader
            title={t('sessionContext.sections.taskContext')}
            count={summary.tasks.length}
            tone="tasks"
            icon={ClipboardList}
            collapsed={collapsedSections.tasks}
            onToggle={() => toggleSection('tasks')}
          />
          {!collapsedSections.tasks && (
          <div className="space-y-1.5">
            {summary.tasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
                {t('sessionContext.empty.taskContext')}
              </div>
            ) : (
              (expandedLists.tasks ? summary.tasks : summary.tasks.slice(0, 6)).map((entry) => (
              <button
                  type="button"
                  key={entry.key}
                  onClick={() => handleTaskPreview(entry)}
                  className="group w-full rounded-xl border border-border/60 bg-gradient-to-r from-background via-background to-sky-50/20 px-2.5 py-2 text-left shadow-sm transition-all hover:border-border hover:from-accent/20 hover:to-accent/10 dark:to-sky-950/10"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500/70" />
                    <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
                      {entry.label}
                    </div>
                    {entry.detail ? (
                      <div className="max-w-[140px] flex-shrink truncate text-[10px] text-muted-foreground">
                        {entry.detail}
                      </div>
                    ) : null}
                    <div className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap">
                      <ItemBadge>{getTaskKindLabel(entry.kind)}</ItemBadge>
                      <ItemBadge>{formatTimeLabel(entry.lastSeenAt, i18n.language)}</ItemBadge>
                    </div>
                  </div>
                </button>
              ))
            )}
            {summary.tasks.length > 6 && (
              <button type="button" className="w-full rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('tasks')}>
                {expandedLists.tasks ? t('sessionContext.showLess') : `${summary.tasks.length - 6} more...`}
              </button>
            )}
          </div>
          )}
        </section>

        <section className={`rounded-[22px] border p-3.5 shadow-sm ${SECTION_STYLES.review.panel} ${collapsedSections.review ? '' : 'flex min-h-[240px] flex-1 flex-col overflow-hidden'}`}>
          <SectionHeader
            title={t('sessionContext.sections.reviewQueue')}
            count={filteredOutputFiles.length}
            tone="review"
            icon={FileOutput}
            collapsed={collapsedSections.review}
            onToggle={() => toggleSection('review')}
            actions={!collapsedSections.review ? (
            <div className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/35 p-1 shadow-sm">
              {([
                { value: 'all', labelKey: 'sessionContext.filters.all' },
                { value: 'unread', labelKey: 'sessionContext.filters.unread' },
                { value: 'reviewed', labelKey: 'sessionContext.filters.reviewed' },
              ] as Array<{ value: ReviewFilter; labelKey: string }>).map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setReviewFilter(filter.value)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    reviewFilter === filter.value
                      ? 'bg-foreground text-background shadow-sm'
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
          <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
            {filteredOutputFiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
                {t('sessionContext.empty.reviewQueue')}
              </div>
            ) : (
              (expandedLists.outputFiles ? filteredOutputFiles : filteredOutputFiles.slice(0, 8)).map((file) => (
                <ItemButton
                  key={file.key}
                  label={file.name}
                  secondaryLabel={file.relativePath}
                  unread={file.unread}
                  compact
                  onClick={() => handleFilePreview(file)}
                  thumbnail={<FileThumbnail projectName={projectName} absolutePath={file.absolutePath || file.relativePath} fileName={file.name} />}
                  action={<button type="button" onClick={() => { void openReviewFile(file); }}><OpenFileButton title={t('sessionContext.preview.open')} /></button>}
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
              <button type="button" className="w-full rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleListExpansion('outputFiles')}>
                {expandedLists.outputFiles ? t('sessionContext.showLess') : `${filteredOutputFiles.length - 8} more...`}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={handleClosePreview}
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleClosePreview}
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              title={t('sessionContext.preview.closePreview')}
            >
              <X className="h-5 w-5" />
            </button>

            {previewFile && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ChatContextFilePreview
                  projectName={projectName}
                  file={previewFile}
                  onOpenInEditor={handleOpenInEditor}
                  preloadedContent={previewContent}
                />
              </div>
            )}

            {previewTask && !previewFile && (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mb-4 flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-sky-200/80 bg-sky-50/95 text-sky-700 shadow-sm dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200">
                    <ClipboardList className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{previewTask.label}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <ItemBadge>{getTaskKindLabel(previewTask.kind)}</ItemBadge>
                      <ItemBadge>{formatTimeLabel(previewTask.lastSeenAt, i18n.language)}</ItemBadge>
                      <ItemBadge>{previewTask.count}x</ItemBadge>
                    </div>
                  </div>
                </div>
                {previewTask.detail && (
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{previewTask.detail}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
