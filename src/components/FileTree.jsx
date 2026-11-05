import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Folder, FolderOpen, File, FileText, FileCode, List, TableProperties, Eye, Search, X,
  ChevronRight, UploadCloud, Loader2, Trash2, Copy, Check,
  FileJson, FileType, FileSpreadsheet, FileArchive,
  Hash, Braces, Terminal, Database, Globe, Palette, Music2, Video, Archive,
  Lock, Shield, Settings, Image, BookOpen, Cpu, Box, Gem, Coffee,
  Flame, Hexagon, FileCode2, Code2, Cog, FileWarning, Binary, SquareFunction,
  Scroll, FlaskConical, NotebookPen, FileCheck, Workflow, Blocks, MessageSquarePlus
} from 'lucide-react';
import { cn } from '../lib/utils';
import ImageViewer from './ImageViewer';
import WorkbenchDialog from './ui/WorkbenchDialog';
import { api } from '../utils/api';

// ─── File Icon Registry ──────────────────────────────────────────────
// Maps file extensions and special filenames to one neutral icon family.
// Uses lucide-react icons mapped semantically to file types.

const ICON_SIZE = 'w-4 h-4 flex-shrink-0';

const FILE_ICON_MAP = {
  // ── JavaScript / TypeScript ──
  js:   { icon: FileCode },
  jsx:  { icon: FileCode },
  mjs:  { icon: FileCode },
  cjs:  { icon: FileCode },
  ts:   { icon: FileCode2 },
  tsx:  { icon: FileCode2 },
  mts:  { icon: FileCode2 },

  // ── Python ──
  py:   { icon: Code2 },
  pyw:  { icon: Code2 },
  pyi:  { icon: Code2 },
  ipynb:{ icon: NotebookPen },

  // ── Rust ──
  rs:   { icon: Cog },
  toml: { icon: Settings },

  // ── Go ──
  go:   { icon: Hexagon },

  // ── Ruby ──
  rb:   { icon: Gem },
  erb:  { icon: Gem },

  // ── PHP ──
  php:  { icon: Blocks },

  // ── Java / Kotlin ──
  java: { icon: Coffee },
  jar:  { icon: Coffee },
  kt:   { icon: Hexagon },
  kts:  { icon: Hexagon },

  // ── C / C++ ──
  c:    { icon: Cpu },
  h:    { icon: Cpu },
  cpp:  { icon: Cpu },
  hpp:  { icon: Cpu },
  cc:   { icon: Cpu },

  // ── C# ──
  cs:   { icon: Hexagon },

  // ── Swift ──
  swift:{ icon: Flame },

  // ── Lua ──
  lua:  { icon: SquareFunction },

  // ── R ──
  r:    { icon: FlaskConical },

  // ── Web ──
  html: { icon: Globe },
  htm:  { icon: Globe },
  css:  { icon: Hash },
  scss: { icon: Hash },
  sass: { icon: Hash },
  less: { icon: Hash },
  vue:  { icon: FileCode2 },
  svelte:{ icon: FileCode2 },

  // ── Data / Config ──
  json: { icon: Braces },
  jsonc:{ icon: Braces },
  json5:{ icon: Braces },
  yaml: { icon: Settings },
  yml:  { icon: Settings },
  xml:  { icon: FileCode },
  csv:  { icon: FileSpreadsheet },
  tsv:  { icon: FileSpreadsheet },
  sql:  { icon: Database },
  graphql:{ icon: Workflow },
  gql:  { icon: Workflow },
  proto:{ icon: Box },
  env:  { icon: Shield },

  // ── Documents ──
  md:   { icon: BookOpen },
  mdx:  { icon: BookOpen },
  txt:  { icon: FileText },
  doc:  { icon: FileText },
  docx: { icon: FileText },
  pdf:  { icon: FileCheck },
  rtf:  { icon: FileText },
  tex:  { icon: Scroll },
  rst:  { icon: FileText },

  // ── Shell / Scripts ──
  sh:   { icon: Terminal },
  bash: { icon: Terminal },
  zsh:  { icon: Terminal },
  fish: { icon: Terminal },
  ps1:  { icon: Terminal },
  bat:  { icon: Terminal },
  cmd:  { icon: Terminal },

  // ── Images ──
  png:  { icon: Image },
  jpg:  { icon: Image },
  jpeg: { icon: Image },
  gif:  { icon: Image },
  webp: { icon: Image },
  ico:  { icon: Image },
  bmp:  { icon: Image },
  tiff: { icon: Image },
  svg:  { icon: Palette },

  // ── Audio ──
  mp3:  { icon: Music2 },
  wav:  { icon: Music2 },
  ogg:  { icon: Music2 },
  flac: { icon: Music2 },
  aac:  { icon: Music2 },
  m4a:  { icon: Music2 },

  // ── Video ──
  mp4:  { icon: Video },
  mov:  { icon: Video },
  avi:  { icon: Video },
  webm: { icon: Video },
  mkv:  { icon: Video },

  // ── Fonts ──
  ttf:  { icon: FileType },
  otf:  { icon: FileType },
  woff: { icon: FileType },
  woff2:{ icon: FileType },
  eot:  { icon: FileType },

  // ── Archives ──
  zip:  { icon: Archive },
  tar:  { icon: Archive },
  gz:   { icon: Archive },
  bz2:  { icon: Archive },
  rar:  { icon: Archive },
  '7z': { icon: Archive },

  // ── Lock files ──
  lock: { icon: Lock },

  // ── Binary / Executable ──
  exe:  { icon: Binary },
  bin:  { icon: Binary },
  dll:  { icon: Binary },
  so:   { icon: Binary },
  dylib:{ icon: Binary },
  wasm: { icon: Binary },

  // ── Misc config ──
  ini:  { icon: Settings },
  cfg:  { icon: Settings },
  conf: { icon: Settings },
  log:  { icon: Scroll },
  map:  { icon: File },
};

// Special full-filename matches (highest priority)
const FILENAME_ICON_MAP = {
  'Dockerfile':       { icon: Box },
  'docker-compose.yml': { icon: Box },
  'docker-compose.yaml': { icon: Box },
  '.dockerignore':    { icon: Box },
  '.gitignore':       { icon: Settings },
  '.gitmodules':      { icon: Settings },
  '.gitattributes':   { icon: Settings },
  '.editorconfig':    { icon: Settings },
  '.prettierrc':      { icon: Settings },
  '.prettierignore':  { icon: Settings },
  '.eslintrc':        { icon: Settings },
  '.eslintrc.js':     { icon: Settings },
  '.eslintrc.json':   { icon: Settings },
  '.eslintrc.cjs':    { icon: Settings },
  'eslint.config.js': { icon: Settings },
  'eslint.config.mjs':{ icon: Settings },
  '.env':             { icon: Shield },
  '.env.local':       { icon: Shield },
  '.env.development': { icon: Shield },
  '.env.production':  { icon: Shield },
  '.env.example':     { icon: Shield },
  'package.json':     { icon: Braces },
  'package-lock.json':{ icon: Lock },
  'yarn.lock':        { icon: Lock },
  'pnpm-lock.yaml':   { icon: Lock },
  'bun.lockb':        { icon: Lock },
  'Cargo.toml':       { icon: Cog },
  'Cargo.lock':       { icon: Lock },
  'Gemfile':          { icon: Gem },
  'Gemfile.lock':     { icon: Lock },
  'Makefile':         { icon: Terminal },
  'CMakeLists.txt':   { icon: Cog },
  'tsconfig.json':    { icon: Braces },
  'jsconfig.json':    { icon: Braces },
  'vite.config.ts':   { icon: Flame },
  'vite.config.js':   { icon: Flame },
  'webpack.config.js':{ icon: Cog },
  'tailwind.config.js':{ icon: Hash },
  'tailwind.config.ts':{ icon: Hash },
  'postcss.config.js':{ icon: Cog },
  'babel.config.js':  { icon: Settings },
  '.babelrc':         { icon: Settings },
  'README.md':        { icon: BookOpen },
  'LICENSE':          { icon: FileCheck },
  'LICENSE.md':       { icon: FileCheck },
  'CHANGELOG.md':     { icon: Scroll },
  'requirements.txt': { icon: FileText },
  'go.mod':           { icon: Hexagon },
  'go.sum':           { icon: Lock },
};

function getFileIconData(filename) {
  // 1. Exact filename match
  if (FILENAME_ICON_MAP[filename]) {
    return FILENAME_ICON_MAP[filename];
  }

  // 2. Check for .env prefix pattern
  if (filename.startsWith('.env')) {
    return { icon: Shield };
  }

  // 3. Extension-based lookup
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && FILE_ICON_MAP[ext]) {
    return FILE_ICON_MAP[ext];
  }

  // 4. Fallback
  return { icon: File };
}


// ─── Component ───────────────────────────────────────────────────────

function FileTree({ selectedProject, onFileOpen, onStartWorkspaceQa }) {
  const { t } = useTranslation();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
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
  const searchInputRef = useRef(null);
  projectScopeRef.current = selectedProject?.name;
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [selectedImage, setSelectedImage] = useState(null);
  const [viewMode, setViewMode] = useState('detailed');
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredFiles, setFilteredFiles] = useState([]);
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

  const handleUpload = useCallback(async (fileList, targetDir = '') => {
    if (!fileList.length || !selectedProject || uploading) return;
    const scope = selectedProject.name;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const formData = new FormData();
      formData.append('targetDir', targetDir);
      fileList.forEach(f => formData.append('files', f));
      const res = await api.uploadFiles(selectedProject.name, formData);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      if (projectScopeRef.current !== scope) return;
      setUploadSuccess(t('fileTree.uploadSuccess', { count: data.files?.length ?? fileList.length }));
      setTimeout(() => setUploadSuccess(null), 3000);
      fetchFiles();
    } catch (err) {
      if (projectScopeRef.current === scope) setUploadError(t('fileTree.uploadError'));
    } finally {
      if (projectScopeRef.current === scope) setUploading(false);
    }
  }, [selectedProject, uploading, t]);

  const handleFileInputChange = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) handleUpload(files, uploadTargetDirRef.current);
    e.target.value = '';
  }, [handleUpload]);

  const handleFileDrop = useCallback((e, targetDir) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDir(null);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleUpload(files, targetDir);
  }, [handleUpload]);

  const handleCopyPath = (e, item) => {
    e.stopPropagation();
    setCopyError(false);
    navigator.clipboard.writeText(item.path).then(() => {
      setCopiedPath(item.path);
      setTimeout(() => setCopiedPath(null), 2000);
    }).catch(() => setCopyError(true));
  };

  const buildWorkspaceQaPrompt = useCallback((item) => {
    if (item.type === 'directory') {
      return t('fileTree.askAboutDirectoryPrompt', {
        name: item.name,
        path: item.path,
      });
    }

    return t('fileTree.askAboutFilePrompt', {
      name: item.name,
      path: item.path,
    });
  }, [t]);

  const handleAskAboutItem = useCallback((e, item) => {
    e.stopPropagation();
    if (!selectedProject || !onStartWorkspaceQa) {
      return;
    }

    onStartWorkspaceQa(selectedProject, buildWorkspaceQaPrompt(item));
  }, [buildWorkspaceQaPrompt, onStartWorkspaceQa, selectedProject]);

  const renderRowActions = (item, className = 'file-row-actions flex items-center gap-0.5 shrink-0') => (
    <span className={className}>
      {item.type === 'directory' && (
        <button
          className="inline-flex h-11 w-11 items-center justify-center rounded hover:bg-accent"
          title={t('fileTree.uploadToFolder')}
          onClick={(e) => { e.stopPropagation(); uploadTargetDirRef.current = item.path; fileInputRef.current?.click(); }}
        >
          <UploadCloud className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      )}
      <button
        className="inline-flex h-11 w-11 items-center justify-center rounded hover:bg-accent"
        disabled={!onStartWorkspaceQa}
        title={t(item.type === 'directory' ? 'fileTree.askAboutDirectory' : 'fileTree.askAboutFile')}
        onClick={(e) => handleAskAboutItem(e, item)}
      >
        <MessageSquarePlus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
      </button>
      <button
        className="inline-flex h-11 w-11 items-center justify-center rounded hover:bg-accent"
        title={t('fileTree.copyPath')}
        onClick={(e) => handleCopyPath(e, item)}
      >
        {copiedPath === item.path
          ? <Check className="w-3.5 h-3.5 text-green-500" />
          : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      <button
        className="inline-flex h-11 w-11 items-center justify-center rounded hover:bg-destructive/20"
        title={t('fileTree.deleteFile')}
        onClick={(e) => { e.stopPropagation(); setDeleteError(false); setPendingDelete(item); }}
      >
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
      </button>
    </span>
  );

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
    setFilteredFiles([]);
    setExpandedDirs(new Set());
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
  }, [selectedProject?.name]);

  useEffect(() => {
    const savedViewMode = localStorage.getItem('file-tree-view-mode');
    if (savedViewMode && ['simple', 'detailed', 'compact'].includes(savedViewMode)) {
      setViewMode(savedViewMode);
    }
  }, []);

  // Debounce search query by 200ms
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 200);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // When search is active, fetch full tree to ensure deep files are searchable
  useEffect(() => {
    if (!debouncedSearchQuery.trim()) {
      setSearchError(false);
      setSearchLoading(false);
      setFullTreeForSearch(null);
      setFilteredFiles(files);
      return;
    }

    let cancelled = false;
    setSearchError(false);
    setSearchLoading(true);
    const fetchAndFilter = async () => {
      let sourceTree = fullTreeForSearch || files;

      // Fetch full tree if we haven't already
      if (!fullTreeForSearch && selectedProject) {
        try {
          const response = await api.getFiles(selectedProject.name, { maxDepth: 10 });
          if (!response.ok) throw new Error('Search failed');
          const data = await response.json();
          if (!Array.isArray(data)) throw new Error('Invalid file list');
          if (!cancelled) {
            setFullTreeForSearch(data);
            sourceTree = data;
          }
        } catch (error) {
          if (!cancelled) setSearchError(true);
        }
      }

      if (cancelled) return;
      setSearchLoading(false);

      const filtered = filterFiles(sourceTree, debouncedSearchQuery.toLowerCase());
      setFilteredFiles(filtered);

      // Batch-collect all paths to expand, then update state once
      const pathsToExpand = new Set();
      const collectMatches = (items) => {
        items.forEach(item => {
          if (item.type === 'directory' && item.children && item.children.length > 0) {
            pathsToExpand.add(item.path);
            collectMatches(item.children);
          }
        });
      };
      collectMatches(filtered);
      setExpandedDirs(prev => {
        const next = new Set(prev);
        pathsToExpand.forEach(p => next.add(p));
        return next;
      });
    };

    fetchAndFilter();
    return () => { cancelled = true; };
  }, [files, debouncedSearchQuery, selectedProject?.name, searchRevision]);

  const filterFiles = (items, query) => {
    return items.reduce((filtered, item) => {
      const matchesName = item.name.toLowerCase().includes(query);
      let filteredChildren = [];

      if (item.type === 'directory' && item.children) {
        filteredChildren = filterFiles(item.children, query);
      }

      if (matchesName || filteredChildren.length > 0) {
        filtered.push({
          ...item,
          children: filteredChildren
        });
      }

      return filtered;
    }, []);
  };

  const fetchFiles = async () => {
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
        setFiles(data);
        setFullTreeForSearch(null);
      }
    } catch {
      if (isCurrent()) setLoadError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  // Recursively merge loaded children into the file tree state
  const mergeSubtree = (items, targetPath, children) => {
    return items.map(item => {
      if (item.path === targetPath) {
        return { ...item, children };
      }
      if (item.type === 'directory' && item.children && item.children.length > 0) {
        return { ...item, children: mergeSubtree(item.children, targetPath, children) };
      }
      return item;
    });
  };

  const loadDirectory = async (dirPath) => {
    if (!selectedProject || loadingDirs.has(dirPath)) return;
    const scope = selectedProject.name;
    const request = fileRequestRef.current;
    const isCurrent = () => projectScopeRef.current === scope && fileRequestRef.current === request;
    setLoadingDirs(prev => new Set(prev).add(dirPath));
    setDirectoryErrors(prev => { const next = new Set(prev); next.delete(dirPath); return next; });
    try {
      const response = await api.getFiles(scope, { path: dirPath, maxDepth: 2 });
      if (!response.ok) throw new Error('Directory load failed');
      const children = await response.json();
      if (!Array.isArray(children)) throw new Error('Invalid directory');
      if (isCurrent()) setFiles(prev => mergeSubtree(prev, dirPath, children));
    } catch {
      if (isCurrent()) setDirectoryErrors(prev => new Set(prev).add(dirPath));
    } finally {
      // Always release the loading flag for this project: a newer tree request
      // (after an upload or delete) makes the result stale, not the request
      // unfinished, and a stuck flag would block re-expanding the folder.
      if (projectScopeRef.current === scope) setLoadingDirs(prev => { const next = new Set(prev); next.delete(dirPath); return next; });
    }
  };

  const toggleDirectory = (dirPath, item) => {
    if (expandedDirs.has(dirPath)) {
      setExpandedDirs(prev => { const next = new Set(prev); next.delete(dirPath); return next; });
      return;
    }
    setExpandedDirs(prev => new Set(prev).add(dirPath));
    if (item?.children === null) void loadDirectory(dirPath);
  };

  const changeViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('file-tree-view-mode', mode);
  };

  const formatFileSize = (bytes) => {
    if (bytes == null) return '—';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatRelativeTime = (date) => {
    if (!date) return '-';
    const now = new Date();
    const past = new Date(date);
    const diffInSeconds = Math.floor((now - past) / 1000);

    if (diffInSeconds < 60) return t('fileTree.justNow');
    if (diffInSeconds < 3600) return t('fileTree.minAgo', { count: Math.floor(diffInSeconds / 60) });
    if (diffInSeconds < 86400) return t('fileTree.hoursAgo', { count: Math.floor(diffInSeconds / 3600) });
    if (diffInSeconds < 2592000) return t('fileTree.daysAgo', { count: Math.floor(diffInSeconds / 86400) });
    return past.toLocaleDateString();
  };

  const isImageFile = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];
    return imageExtensions.includes(ext);
  };

  const getFileIcon = (filename) => {
    const { icon: Icon } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE, 'text-muted-foreground')} aria-hidden="true" />;
  };

  // ── Click handler shared across all view modes ──
  const handleItemClick = (item) => {
    if (item.type === 'directory') {
      toggleDirectory(item.path, item);
    } else if (isImageFile(item.name)) {
      setSelectedImage({
        name: item.name,
        path: item.path,
        projectPath: selectedProject.path,
        projectName: selectedProject.name
      });
    } else if (onFileOpen) {
      onFileOpen(item.path);
    }
  };

  const renderItemIcons = (item) => {
    const isDir = item.type === 'directory';
    const isOpen = expandedDirs.has(item.path);

    if (isDir) {
      return (
        <span className="flex items-center gap-0.5 flex-shrink-0">
          <ChevronRight
            className={cn(
              'w-3.5 h-3.5 text-muted-foreground/70 transition-transform duration-150',
              isOpen && 'rotate-90'
            )}
          />
          {isOpen ? (
            <FolderOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
        </span>
      );
    }

    return (
      <span className="flex items-center flex-shrink-0 ml-[18px]">
        {getFileIcon(item.name)}
      </span>
    );
  };

  // A native primary button and sibling actions keep every view keyboard operable.
  // Narrow panels stack metadata instead of squeezing four columns into a phone.
  const renderFiles = (items, level = 0) => items.map(item => {
    const isDir = item.type === 'directory';
    const isOpen = isDir && expandedDirs.has(item.path);
    return (
      <div key={item.path} className="file-tree-entry" style={{ marginLeft: level ? 12 : 0 }}>
        <div className={cn('file-tree-row rounded-md hover:bg-accent/60', isDir && dragOverDir === item.path && 'bg-muted ring-1 ring-ring')}
          {...(isDir ? {
            onDragOver: e => { e.preventDefault(); e.stopPropagation(); setDragOverDir(item.path); },
            onDragLeave: e => { e.stopPropagation(); setDragOverDir(null); },
            onDrop: e => handleFileDrop(e, item.path),
          } : {})}>
          <button type="button" className="file-row-open flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-1 py-2 text-left text-sm"
            onClick={() => handleItemClick(item)} aria-expanded={isDir ? isOpen : undefined} title={item.path}>
            {renderItemIcons(item)}
            <span className={cn('min-w-0 flex-1 break-words', isDir && 'font-medium')}>{item.name}</span>
          </button>
          {!isDir && viewMode !== 'simple' && (
            <div className="file-row-metadata flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1 text-xs text-muted-foreground">
              <span className="tabular-nums">{t('fileTree.size')}: {formatFileSize(item.size)}</span>
              {viewMode === 'detailed' && <span>{t('fileTree.modified')}: {formatRelativeTime(item.modified)}</span>}
              {item.permissionsRwx && <span className="font-mono" title={t('fileTree.permissions')}>{item.permissionsRwx}</span>}
            </div>
          )}
          {renderRowActions(item)}
        </div>
        {isOpen && (
          <div className="ml-2 border-l border-border pl-1">
            {loadingDirs.has(item.path) ? <div role="status" className="px-3 py-2 text-xs text-muted-foreground">{t('fileTree.loading')}</div>
              : directoryErrors.has(item.path) ? <div role="alert" className="px-3 py-2 text-sm"><p>{t('fileTree.directoryLoadFailed')}</p><Button variant="ghost" onClick={() => loadDirectory(item.path)}>{t('buttons.retry')}</Button></div>
              : item.children?.length ? renderFiles(item.children, level + 1)
              : item.children && <p className="px-3 py-2 text-xs text-muted-foreground">{t('fileTree.emptyFolder')}</p>}
          </div>
        )}
      </div>
    );
  });

  // ─── Main render ───────────────────────────────────────────────────
  return (
    <div className="file-workspace h-full min-w-0 flex flex-col bg-background">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {t('fileTree.files')}
          </h3>
          <div className="flex gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-11 w-11 p-0"
              onClick={() => { uploadTargetDirRef.current = ''; fileInputRef.current?.click(); }}
              title={t('fileTree.uploadFiles')}
              disabled={uploading}
            >
              <UploadCloud className="w-3.5 h-3.5" />
            </Button>
            <Button
              aria-pressed={viewMode === 'simple'} variant={viewMode === 'simple' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-11 w-11 p-0"
              onClick={() => changeViewMode('simple')}
              title={t('fileTree.simpleView')}
            >
              <List className="w-3.5 h-3.5" />
            </Button>
            <Button
              aria-pressed={viewMode === 'compact'} variant={viewMode === 'compact' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-11 w-11 p-0"
              onClick={() => changeViewMode('compact')}
              title={t('fileTree.compactView')}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
            <Button
              aria-pressed={viewMode === 'detailed'} variant={viewMode === 'detailed' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-11 w-11 p-0"
              onClick={() => changeViewMode('detailed')}
              title={t('fileTree.detailedView')}
            >
              <TableProperties className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="text"
            aria-label={t('fileTree.searchPlaceholder')}
            placeholder={t('fileTree.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 pr-11 h-11 text-sm"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0.5 top-1/2 transform -translate-y-1/2 h-11 w-11 p-0 hover:bg-accent"
              onClick={() => setSearchQuery('')}
              title={t('fileTree.clearSearch')}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {loading && <div role="status" className="px-3 py-2 text-sm text-muted-foreground">{t('fileTree.loading')}</div>}
      {loadError && <div role="alert" className="border-b border-border px-3 py-2 text-sm"><p>{t('fileTree.loadFailed')}</p><Button variant="ghost" onClick={fetchFiles}>{t('buttons.retry')}</Button></div>}
      {searchLoading && <div role="status" className="px-3 py-2 text-sm text-muted-foreground">{t('fileTree.searching')}</div>}
      {searchError && <div role="alert" className="border-b border-border px-3 py-2 text-sm"><p>{t('fileTree.searchFailed')}</p><Button variant="ghost" onClick={() => setSearchRevision(value => value + 1)}>{t('buttons.retry')}</Button></div>}
      {copyError && <div role="alert" className="px-3 py-2 text-sm">{t('fileTree.copyFailed')}</div>}

      {/* Upload status bar */}
      {uploading && (
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('fileTree.uploading')}
        </div>
      )}
      {uploadError && (
        <div role="alert" className="px-3 py-2 border-b border-border text-sm text-destructive">
          {uploadError}
        </div>
      )}
      {uploadSuccess && (
        <div role="status" className="px-3 py-2 border-b border-border text-sm text-foreground">
          {uploadSuccess}
        </div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <div
        className="flex-1 relative min-h-0 overflow-hidden"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => handleFileDrop(e, '')}
      >
        <ScrollArea className="h-full px-2 py-1">
          {files.length === 0 && (loading || loadError) ? null : files.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                <Folder className="w-6 h-6 text-muted-foreground" />
              </div>
              <h4 className="font-medium text-foreground mb-1">{t('fileTree.noFilesFound')}</h4>
              <p className="text-sm text-muted-foreground">
                {t('fileTree.checkProjectPath')}
              </p>
            </div>
          ) : filteredFiles.length === 0 && searchQuery && !searchLoading && !searchError ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                <Search className="w-6 h-6 text-muted-foreground" />
              </div>
              <h4 className="font-medium text-foreground mb-1">{t('fileTree.noMatchesFound')}</h4>
              <p className="text-sm text-muted-foreground">
                {t('fileTree.tryDifferentSearch')}
              </p>
            </div>
          ) : (
            <div>
              {renderFiles(filteredFiles)}
            </div>
          )}
        </ScrollArea>
      </div>

      {pendingDelete && <WorkbenchDialog busy={deleting} onClose={() => { if (!deleting) setPendingDelete(null); }} title={t('fileTree.deleteFile')}>
        <p className="break-words text-sm">{t('fileTree.confirmDelete', { name: pendingDelete?.name })}</p>
        {deleteError && <p role="alert" className="mt-3 text-sm text-destructive">{t('fileTree.deleteFailed')}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={deleting} onClick={() => setPendingDelete(null)}>{t('buttons.cancel')}</Button>
          <Button variant="destructive" disabled={deleting} onClick={handleDelete}>{t(deleting ? 'fileTree.deleting' : 'fileTree.deleteFile')}</Button>
        </div>
      </WorkbenchDialog>}

      {/* Image Viewer Modal */}
      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </div>
  );
}

export default FileTree;
