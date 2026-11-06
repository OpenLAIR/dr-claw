import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import {
  Folder, FolderOpen, FolderSymlink, Search, X, ChevronRight, UploadCloud, Loader2, Trash2, Copy, Check,
  MessageSquarePlus, MoreHorizontal, ChevronsDownUp, RefreshCw, ListTree, Link2, AlertCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';
import ImageViewer from './ImageViewer';
import WorkbenchDialog from './ui/WorkbenchDialog';
import FileRowMenu from './file-tree/FileRowMenu';
import MiddleTruncatedName from './file-tree/MiddleTruncatedName';
import { getFileIcon, isImageFile } from './file-tree/fileIcons';
import {
  collectExpandablePaths,
  filterTree,
  flattenTree,
  formatFileSize,
  formatShortTimestamp,
  getInitialExpandedPaths,
  isHiddenName,
  sortTree,
  toProjectRelativePath,
} from './file-tree/fileTreeModel';
import { api } from '../utils/api';

const DETAILS_STORAGE_KEY = 'file-tree-show-details';
// Row geometry: 8px gutter, 12px per level, guides centred under the parent's chevron.
const ROW_GUTTER = 8;
const INDENT = 12;
const GUIDE_OFFSET = 7;

const readShowDetails = () => {
  try {
    return localStorage.getItem(DETAILS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const mergeSubtree = (items, targetPath, children) => items.map((item) => {
  if (item.path === targetPath) return { ...item, children };
  if (item.type === 'directory' && Array.isArray(item.children) && item.children.length > 0) {
    return { ...item, children: mergeSubtree(item.children, targetPath, children) };
  }
  return item;
});

const escapeSelector = (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'));

function FileTree({ selectedProject, onFileOpen, onStartWorkspaceQa }) {
  const { t, i18n } = useTranslation();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [directoryErrors, setDirectoryErrors] = useState(new Set());
  const [searchError, setSearchError] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteError, setDeleteError] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const projectScopeRef = useRef(selectedProject?.name);
  const fileRequestRef = useRef(0);
  const initialExpandRef = useRef(null);
  const searchInputRef = useRef(null);
  const treeRef = useRef(null);
  projectScopeRef.current = selectedProject?.name;
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [searchExpandedDirs, setSearchExpandedDirs] = useState(new Set());
  const [selectedPath, setSelectedPath] = useState(null);
  const [focusedPath, setFocusedPath] = useState(null);
  const [menu, setMenu] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [showDetails, setShowDetails] = useState(readShowDetails);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [dragOverDir, setDragOverDir] = useState(null);
  const [copiedPath, setCopiedPath] = useState(null);
  const [loadingDirs, setLoadingDirs] = useState(new Set());
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [fullTreeForSearch, setFullTreeForSearch] = useState(null);
  const searchTimerRef = useRef(null);
  const uploadTargetDirRef = useRef('');
  const fileInputRef = useRef(null);

  const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';
  const isSearching = debouncedSearchQuery.trim().length > 0;

  const fetchFiles = useCallback(async () => {
    if (!selectedProject || projectScopeRef.current !== selectedProject.name) return;
    const scope = selectedProject.name;
    const request = ++fileRequestRef.current;
    const isCurrent = () => projectScopeRef.current === scope && request === fileRequestRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await api.getFiles(scope);
      if (!response.ok) throw new Error('File load failed');
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid file list');
      if (isCurrent()) {
        const sorted = sortTree(data);
        setFiles(sorted);
        setFullTreeForSearch(null);
        setHasLoaded(true);
        if (initialExpandRef.current !== scope) {
          initialExpandRef.current = scope;
          setExpandedDirs(getInitialExpandedPaths(sorted));
        }
      }
    } catch {
      if (isCurrent()) setLoadError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [selectedProject]);

  const handleUpload = useCallback(async (fileList, targetDir = '') => {
    if (!fileList.length || !selectedProject || uploading) return;
    const scope = selectedProject.name;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const formData = new FormData();
      formData.append('targetDir', targetDir);
      fileList.forEach((f) => formData.append('files', f));
      const res = await api.uploadFiles(selectedProject.name, formData);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      if (projectScopeRef.current !== scope) return;
      setUploadSuccess(t('fileTree.uploadSuccess', { count: data.files?.length ?? fileList.length }));
      setTimeout(() => setUploadSuccess(null), 3000);
      void fetchFiles();
    } catch {
      if (projectScopeRef.current === scope) setUploadError(t('fileTree.uploadError'));
    } finally {
      if (projectScopeRef.current === scope) setUploading(false);
    }
  }, [selectedProject, uploading, t, fetchFiles]);

  const handleFileInputChange = useCallback((e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) handleUpload(picked, uploadTargetDirRef.current);
    e.target.value = '';
  }, [handleUpload]);

  const handleFileDrop = useCallback((e, targetDir) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDir(null);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) handleUpload(dropped, targetDir);
  }, [handleUpload]);

  const openUploadPicker = useCallback((targetDir) => {
    uploadTargetDirRef.current = targetDir;
    fileInputRef.current?.click();
  }, []);

  const copyPath = useCallback((item) => {
    setCopyError(false);
    navigator.clipboard.writeText(item.path).then(() => {
      setCopiedPath(item.path);
      setTimeout(() => setCopiedPath(null), 2000);
    }).catch(() => setCopyError(true));
  }, []);

  const askAboutItem = useCallback((item) => {
    if (!selectedProject || !onStartWorkspaceQa) return;
    const promptKey = item.type === 'directory' ? 'fileTree.askAboutDirectoryPrompt' : 'fileTree.askAboutFilePrompt';
    onStartWorkspaceQa(selectedProject, t(promptKey, { name: item.name, path: item.path }));
  }, [onStartWorkspaceQa, selectedProject, t]);

  const handleDelete = async () => {
    if (!selectedProject || !pendingDelete || deleting) return;
    const scope = selectedProject.name;
    setDeleting(true);
    setDeleteError(false);
    try {
      const res = await api.deleteFile(scope, pendingDelete.path);
      if (!res.ok) throw new Error('Delete failed');
      if (projectScopeRef.current !== scope) return;
      setPendingDelete(null);
      void fetchFiles();
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } catch {
      if (projectScopeRef.current === scope) setDeleteError(true);
    } finally {
      if (projectScopeRef.current === scope) setDeleting(false);
    }
  };

  useEffect(() => {
    setFiles([]);
    setHasLoaded(false);
    setExpandedDirs(new Set());
    setSearchExpandedDirs(new Set());
    setSelectedPath(null);
    setFocusedPath(null);
    setMenu(null);
    setLoadingDirs(new Set());
    setDirectoryErrors(new Set());
    setFullTreeForSearch(null);
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setPendingDelete(null);
    setDeleting(false);
    setCopyError(false);
    setUploading(false);
    setUploadError(null);
    setUploadSuccess(null);
    if (selectedProject) void fetchFiles();
    return () => { fileRequestRef.current++; };
  }, [selectedProject?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search query by 200ms
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearchQuery(searchQuery), 200);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // While searching, fetch the full tree once so deep files are searchable.
  useEffect(() => {
    if (!isSearching) {
      setSearchError(false);
      setSearchLoading(false);
      setFullTreeForSearch(null);
      return undefined;
    }
    if (fullTreeForSearch || !selectedProject) return undefined;
    let cancelled = false;
    setSearchError(false);
    setSearchLoading(true);
    (async () => {
      try {
        const response = await api.getFiles(selectedProject.name, { maxDepth: 10 });
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Invalid file list');
        if (!cancelled) setFullTreeForSearch(sortTree(data));
      } catch {
        if (!cancelled) setSearchError(true);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isSearching, fullTreeForSearch, selectedProject?.name, searchRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleFiles = useMemo(
    () => (isSearching ? filterTree(fullTreeForSearch || files, debouncedSearchQuery) : files),
    [isSearching, fullTreeForSearch, files, debouncedSearchQuery],
  );

  // Search results open every folder that leads to a match; that expansion is
  // kept apart so clearing the search restores the folders the user had open.
  useEffect(() => {
    if (isSearching) setSearchExpandedDirs(collectExpandablePaths(visibleFiles));
  }, [isSearching, visibleFiles]);

  const activeExpanded = isSearching ? searchExpandedDirs : expandedDirs;
  const setActiveExpanded = isSearching ? setSearchExpandedDirs : setExpandedDirs;

  const rows = useMemo(
    () => flattenTree(visibleFiles, activeExpanded, { loading: loadingDirs, failed: directoryErrors }),
    [visibleFiles, activeExpanded, loadingDirs, directoryErrors],
  );
  const itemRows = useMemo(() => rows.filter((row) => row.kind === 'item'), [rows]);
  const rowByPath = useMemo(() => new Map(itemRows.map((row) => [row.item.path, row])), [itemRows]);
  const tabStopPath = (focusedPath && rowByPath.has(focusedPath))
    ? focusedPath
    : (selectedPath && rowByPath.has(selectedPath) ? selectedPath : itemRows[0]?.item.path);

  const loadDirectory = async (dirPath) => {
    if (!selectedProject || loadingDirs.has(dirPath)) return;
    const scope = selectedProject.name;
    const request = fileRequestRef.current;
    const isCurrent = () => projectScopeRef.current === scope && fileRequestRef.current === request;
    setLoadingDirs((prev) => new Set(prev).add(dirPath));
    setDirectoryErrors((prev) => { const next = new Set(prev); next.delete(dirPath); return next; });
    try {
      const response = await api.getFiles(scope, { path: dirPath, maxDepth: 2 });
      if (!response.ok) throw new Error('Directory load failed');
      const children = await response.json();
      if (!Array.isArray(children)) throw new Error('Invalid directory');
      if (isCurrent()) {
        const sorted = sortTree(children);
        setFiles((prev) => mergeSubtree(prev, dirPath, sorted));
        setFullTreeForSearch((prev) => (prev ? mergeSubtree(prev, dirPath, sorted) : prev));
      }
    } catch {
      if (isCurrent()) setDirectoryErrors((prev) => new Set(prev).add(dirPath));
    } finally {
      // Always release the loading flag for this project: a newer tree request
      // (after an upload or delete) makes the result stale, not the request
      // unfinished, and a stuck flag would block re-expanding the folder.
      if (projectScopeRef.current === scope) setLoadingDirs((prev) => { const next = new Set(prev); next.delete(dirPath); return next; });
    }
  };

  const setDirectoryExpanded = (item, open) => {
    setActiveExpanded((prev) => {
      if (prev.has(item.path) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(item.path); else next.delete(item.path);
      return next;
    });
    if (open && item.children == null) void loadDirectory(item.path);
  };

  const collapseAll = () => setActiveExpanded(new Set());

  const toggleShowDetails = () => {
    setShowDetails((current) => {
      try { localStorage.setItem(DETAILS_STORAGE_KEY, current ? '0' : '1'); } catch { /* storage unavailable */ }
      return !current;
    });
  };

  const formatRelativeTime = (date) => {
    if (!date) return '—';
    const past = new Date(date);
    const diffInSeconds = Math.floor((Date.now() - past.getTime()) / 1000);
    if (Number.isNaN(diffInSeconds)) return '—';
    if (diffInSeconds < 60) return t('fileTree.justNow');
    if (diffInSeconds < 3600) return t('fileTree.minAgo', { count: Math.floor(diffInSeconds / 60) });
    if (diffInSeconds < 86400) return t('fileTree.hoursAgo', { count: Math.floor(diffInSeconds / 3600) });
    if (diffInSeconds < 2592000) return t('fileTree.daysAgo', { count: Math.floor(diffInSeconds / 86400) });
    return past.toLocaleDateString();
  };

  const describeItem = (item) => {
    const lines = [toProjectRelativePath(item.path, projectRoot)];
    if (item.type === 'file') {
      lines.push(`${t('fileTree.size')}: ${formatFileSize(item.size)} · ${t('fileTree.modified')}: ${formatRelativeTime(item.modified)}`);
    }
    if (item.isSymlink) lines.push(t('fileTree.symlink'));
    return lines.join('\n');
  };

  const handleItemActivate = (item) => {
    setMenu(null);
    setSelectedPath(item.path);
    setFocusedPath(item.path);
    if (item.type === 'directory') {
      setDirectoryExpanded(item, !activeExpanded.has(item.path));
    } else if (isImageFile(item.name)) {
      setSelectedImage({
        name: item.name,
        path: item.path,
        projectPath: selectedProject.path,
        projectName: selectedProject.name,
      });
    } else if (onFileOpen) {
      onFileOpen(item.path);
    }
  };

  const focusRow = (path) => {
    if (!path) return;
    setFocusedPath(path);
    requestAnimationFrame(() => {
      treeRef.current?.querySelector(`[data-tree-path="${escapeSelector(path)}"]`)?.focus();
    });
  };

  const openMenu = (item, anchor, trigger) => {
    setFocusedPath(item.path);
    setMenu({ item, anchor, trigger });
  };

  const closeMenu = useCallback((restoreFocus) => {
    setMenu((current) => {
      if (restoreFocus && current?.trigger?.isConnected) requestAnimationFrame(() => current.trigger.focus());
      return null;
    });
  }, []);

  const handleTreeKeyDown = (event) => {
    const path = event.target?.getAttribute?.('data-tree-path');
    if (!path) return;
    const index = itemRows.findIndex((row) => row.item.path === path);
    const row = itemRows[index];
    if (!row) return;
    const isDir = row.item.type === 'directory';
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(itemRows[Math.min(index + 1, itemRows.length - 1)]?.item.path);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(itemRows[Math.max(index - 1, 0)]?.item.path);
        break;
      case 'Home':
        event.preventDefault();
        focusRow(itemRows[0]?.item.path);
        break;
      case 'End':
        event.preventDefault();
        focusRow(itemRows[itemRows.length - 1]?.item.path);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (isDir && !row.expanded) setDirectoryExpanded(row.item, true);
        else if (isDir && itemRows[index + 1]?.parentPath === row.item.path) focusRow(itemRows[index + 1].item.path);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (isDir && row.expanded) setDirectoryExpanded(row.item, false);
        else if (row.parentPath) focusRow(row.parentPath);
        break;
      case 'ContextMenu':
      case 'F10':
        if (event.key === 'F10' && !event.shiftKey) break;
        event.preventDefault();
        {
          const rect = event.target.getBoundingClientRect();
          openMenu(row.item, { x: rect.right, y: rect.bottom }, event.target);
        }
        break;
      default:
        break;
    }
  };

  const buildMenuItems = (item) => {
    const isDir = item.type === 'directory';
    return [
      ...(isDir ? [{
        key: 'upload',
        label: t('fileTree.uploadToFolder'),
        icon: <UploadCloud className="h-3.5 w-3.5" />,
        onSelect: () => openUploadPicker(item.path),
        disabled: uploading,
      }] : []),
      {
        key: 'ask',
        label: t(isDir ? 'fileTree.askAboutDirectory' : 'fileTree.askAboutFile'),
        icon: <MessageSquarePlus className="h-3.5 w-3.5" />,
        onSelect: () => askAboutItem(item),
        disabled: !onStartWorkspaceQa,
      },
      {
        key: 'copy',
        label: t('fileTree.copyPath'),
        icon: <Copy className="h-3.5 w-3.5" />,
        onSelect: () => copyPath(item),
      },
      {
        key: 'delete',
        label: t('fileTree.deleteFile'),
        icon: <Trash2 className="h-3.5 w-3.5" />,
        destructive: true,
        onSelect: () => { setDeleteError(false); setPendingDelete(item); },
      },
    ];
  };

  const renderGuides = (depth) => Array.from({ length: depth }, (_, level) => (
    <span key={level} aria-hidden="true" className="ft-guide" style={{ left: ROW_GUTTER + level * INDENT + GUIDE_OFFSET }} />
  ));

  const renderItemRow = (row) => {
    const { item, depth, expanded } = row;
    const isDir = item.type === 'directory';
    const hidden = isHiddenName(item.name);
    const isSelected = selectedPath === item.path;
    const isMenuOpen = menu?.item.path === item.path;
    const { icon: TypeIcon, className: iconTone } = isDir ? { icon: null, className: '' } : getFileIcon(item.name);
    const DirIcon = item.isSymlink ? FolderSymlink : expanded ? FolderOpen : Folder;

    return (
      <div
        key={row.key}
        role="none"
        className={cn(
          'ft-row group',
          isSelected && 'is-selected',
          isMenuOpen && 'is-menu-open',
          isDir && dragOverDir === item.path && 'is-drop-target',
        )}
        onContextMenu={(e) => { e.preventDefault(); openMenu(item, { x: e.clientX + 200, y: e.clientY }, e.currentTarget.querySelector('[data-tree-path]')); }}
        {...(isDir ? {
          onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setDragOverDir(item.path); },
          onDragLeave: (e) => { e.stopPropagation(); setDragOverDir(null); },
          onDrop: (e) => handleFileDrop(e, item.path),
        } : {})}
      >
        {renderGuides(depth)}
        <button
          type="button"
          role="treeitem"
          data-tree-path={item.path}
          aria-level={depth + 1}
          aria-expanded={isDir ? expanded : undefined}
          aria-selected={isSelected}
          tabIndex={tabStopPath === item.path ? 0 : -1}
          title={describeItem(item)}
          onClick={() => handleItemActivate(item)}
          onFocus={() => setFocusedPath(item.path)}
          className="ft-row-main"
          style={{ paddingLeft: ROW_GUTTER + depth * INDENT }}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
            {isDir && <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-150', expanded && 'rotate-90')} />}
          </span>
          {isDir
            ? <DirIcon className={cn('h-4 w-4 shrink-0', hidden ? 'text-muted-foreground/70' : 'text-sky-600/80 dark:text-sky-400/80')} aria-hidden="true" />
            : <TypeIcon className={cn('h-4 w-4 shrink-0', iconTone, hidden && 'opacity-60')} aria-hidden="true" />}
          <MiddleTruncatedName name={item.name} className={cn(hidden ? 'text-muted-foreground' : 'text-foreground', isSelected && 'font-medium')} />
          {item.isSymlink && <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t('fileTree.symlink')} />}
          {showDetails && !isDir && (
            <span className="ft-row-detail" aria-hidden="true">{formatFileSize(item.size)} · {formatShortTimestamp(item.modified, undefined, i18n.language)}</span>
          )}
        </button>
        <span className="ft-row-actions">
          <button
            type="button"
            className="ft-action ft-quick-action"
            disabled={!onStartWorkspaceQa}
            title={t(isDir ? 'fileTree.askAboutDirectory' : 'fileTree.askAboutFile')}
            aria-label={t(isDir ? 'fileTree.askAboutDirectory' : 'fileTree.askAboutFile')}
            onClick={(e) => { e.stopPropagation(); askAboutItem(item); }}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="ft-action ft-quick-action"
            title={copiedPath === item.path ? t('fileTree.pathCopied') : t('fileTree.copyPath')}
            aria-label={t('fileTree.copyPath')}
            onClick={(e) => { e.stopPropagation(); copyPath(item); }}
          >
            {copiedPath === item.path ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className="ft-action"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            title={t('fileTree.moreActions', { name: item.name })}
            aria-label={t('fileTree.moreActions', { name: item.name })}
            onClick={(e) => {
              e.stopPropagation();
              if (isMenuOpen) { closeMenu(false); return; }
              const rect = e.currentTarget.getBoundingClientRect();
              openMenu(item, { x: rect.right, y: rect.bottom }, e.currentTarget);
            }}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </span>
      </div>
    );
  };

  const renderPlaceholderRow = (row) => {
    const style = { paddingLeft: ROW_GUTTER + row.depth * INDENT + 22 };
    if (row.kind === 'loading') {
      return (
        <div key={row.key} role="status" className="ft-placeholder" style={style}>
          {renderGuides(row.depth)}
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span>{t('fileTree.loading')}</span>
        </div>
      );
    }
    if (row.kind === 'error') {
      return (
        <div key={row.key} role="alert" className="ft-placeholder text-destructive" style={style}>
          {renderGuides(row.depth)}
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{t('fileTree.directoryLoadFailed')}</span>
          <button type="button" className="ml-1 shrink-0 rounded px-1.5 font-medium text-foreground underline-offset-2 hover:underline" onClick={() => loadDirectory(row.dirPath)}>
            {t('buttons.retry')}
          </button>
        </div>
      );
    }
    return (
      <div key={row.key} className="ft-placeholder italic" style={style}>
        {renderGuides(row.depth)}
        <span>{t('fileTree.emptyFolder')}</span>
      </div>
    );
  };

  const headerButton = 'ft-icon-button';
  const showSkeleton = !hasLoaded && loading && files.length === 0;

  return (
    <div className="file-workspace flex h-full min-w-0 flex-col bg-card">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 py-1.5 pl-3 pr-1.5">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground" title={projectRoot || undefined}>
          {selectedProject?.displayName || t('fileTree.files')}
        </h3>
        <button type="button" className={headerButton} onClick={() => openUploadPicker('')} disabled={uploading}
          title={t('fileTree.uploadFiles')} aria-label={t('fileTree.uploadFiles')}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        </button>
        <button type="button" className={headerButton} onClick={toggleShowDetails} aria-pressed={showDetails}
          title={t('fileTree.showDetails')} aria-label={t('fileTree.showDetails')}>
          <ListTree className="h-4 w-4" />
        </button>
        <button type="button" className={headerButton} onClick={collapseAll} disabled={activeExpanded.size === 0}
          title={t('fileTree.collapseAll')} aria-label={t('fileTree.collapseAll')}>
          <ChevronsDownUp className="h-4 w-4" />
        </button>
        <button type="button" className={headerButton} onClick={() => void fetchFiles()} disabled={loading}
          title={t('buttons.refresh')} aria-label={t('buttons.refresh')}>
          <RefreshCw className={cn('h-4 w-4', loading && hasLoaded && 'animate-spin')} />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-2 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            aria-label={t('fileTree.searchPlaceholder')}
            placeholder={t('fileTree.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && searchQuery) { e.preventDefault(); setSearchQuery(''); }
              if (e.key === 'ArrowDown' && itemRows[0]) { e.preventDefault(); focusRow(itemRows[0].item.path); }
            }}
            className="ft-search h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {searchLoading ? (
            <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : searchQuery ? (
            <button type="button" className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }} title={t('fileTree.clearSearch')} aria-label={t('fileTree.clearSearch')}>
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Status messages */}
      {loadError && (
        <div role="alert" className="ft-banner text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t('fileTree.loadFailed')}</span>
          <button type="button" className="shrink-0 font-medium text-foreground hover:underline" onClick={() => void fetchFiles()}>{t('buttons.retry')}</button>
        </div>
      )}
      {searchError && (
        <div role="alert" className="ft-banner">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t('fileTree.searchFailed')}</span>
          <button type="button" className="shrink-0 font-medium hover:underline" onClick={() => { setFullTreeForSearch(null); setSearchRevision((value) => value + 1); }}>{t('buttons.retry')}</button>
        </div>
      )}
      {copyError && <div role="alert" className="ft-banner text-destructive">{t('fileTree.copyFailed')}</div>}
      {uploading && (
        <div role="status" className="ft-banner text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t('fileTree.uploading')}
        </div>
      )}
      {uploadError && <div role="alert" className="ft-banner text-destructive">{uploadError}</div>}
      {uploadSuccess && <div role="status" className="ft-banner text-foreground">{uploadSuccess}</div>}

      <input type="file" ref={fileInputRef} multiple className="hidden" onChange={handleFileInputChange} />

      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => handleFileDrop(e, '')}
      >
        <ScrollArea className="h-full">
          {showSkeleton ? (
            <div role="status" aria-label={t('fileTree.loading')} className="space-y-1 px-3 py-2">
              {[68, 52, 74, 46, 60, 40, 56].map((width, index) => (
                <div key={index} className="flex h-6 items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-pulse rounded bg-muted" />
                  <span className="h-3 animate-pulse rounded bg-muted" style={{ width: `${width}%` }} />
                </div>
              ))}
            </div>
          ) : files.length === 0 && (loading || loadError) ? null : files.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Folder className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <h4 className="text-sm font-medium text-foreground">{t('fileTree.noFilesFound')}</h4>
              <p className="mt-1 text-xs text-muted-foreground">{t('fileTree.checkProjectPath')}</p>
            </div>
          ) : isSearching && visibleFiles.length === 0 && !searchLoading && !searchError ? (
            <div className="px-6 py-10 text-center">
              <Search className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <h4 className="text-sm font-medium text-foreground">{t('fileTree.noMatchesFound')}</h4>
              <p className="mt-1 text-xs text-muted-foreground">{t('fileTree.tryDifferentSearch')}</p>
            </div>
          ) : (
            <div ref={treeRef} role="tree" aria-label={t('fileTree.files')} className="ft-tree" onKeyDown={handleTreeKeyDown}>
              {rows.map((row) => (row.kind === 'item' ? renderItemRow(row) : renderPlaceholderRow(row)))}
            </div>
          )}
        </ScrollArea>
      </div>

      {menu && (
        <FileRowMenu
          anchor={menu.anchor}
          label={t('fileTree.moreActions', { name: menu.item.name })}
          items={buildMenuItems(menu.item)}
          trigger={menu.trigger}
          onClose={closeMenu}
        />
      )}

      {pendingDelete && <WorkbenchDialog busy={deleting} onClose={() => { if (!deleting) setPendingDelete(null); }} title={t('fileTree.deleteFile')}>
        <p className="break-words text-sm">{t('fileTree.confirmDelete', { name: pendingDelete?.name })}</p>
        {deleteError && <p role="alert" className="mt-3 text-sm text-destructive">{t('fileTree.deleteFailed')}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={deleting} onClick={() => setPendingDelete(null)}>{t('buttons.cancel')}</Button>
          <Button variant="destructive" disabled={deleting} onClick={handleDelete}>{t(deleting ? 'fileTree.deleting' : 'fileTree.deleteFile')}</Button>
        </div>
      </WorkbenchDialog>}

      {selectedImage && (
        <ImageViewer file={selectedImage} onClose={() => setSelectedImage(null)} />
      )}
    </div>
  );
}

export default FileTree;
