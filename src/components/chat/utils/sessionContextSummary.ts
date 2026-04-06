import type { ChatMessage } from '../types/types';

export type SessionReviewState = Record<string, {
  reviewedAt?: string | null;
  lastSeenAt?: string | null;
  lastReviewedSeenAt?: string | null;
}>;

export interface SessionContextFileItem {
  key: string;
  name: string;
  relativePath: string;
  absolutePath: string | null;
  reasons: string[];
  count: number;
  lastSeenAt: string;
}

export interface SessionContextTaskItem {
  key: string;
  label: string;
  detail?: string;
  kind: 'task' | 'todo' | 'skill' | 'directory';
  count: number;
  lastSeenAt: string;
}

export interface SessionContextOutputItem extends SessionContextFileItem {
  unread: boolean;
}

export interface SessionContextSummary {
  contextFiles: SessionContextFileItem[];
  outputFiles: SessionContextOutputItem[];
  tasks: SessionContextTaskItem[];
  directories: SessionContextTaskItem[];
  skills: SessionContextTaskItem[];
  unreadCount: number;
  toolCount: number;
  messageCount: number;
}

type FileAccumulator = {
  key: string;
  name: string;
  relativePath: string;
  absolutePath: string | null;
  reasons: Set<string>;
  count: number;
  lastSeenAt: string;
};

type TaskAccumulator = {
  key: string;
  label: string;
  detail?: string;
  kind: 'task' | 'todo' | 'skill' | 'directory';
  count: number;
  lastSeenAt: string;
};

const WINDOWS_ABS_PATTERN = /^[a-z]:\//i;
const MARKDOWN_FILE_LINK_PATTERN = /\]\((\/[^)\s]+)\)/g;
const ABSOLUTE_PATH_IN_TEXT_PATTERN = /(?:^|[\s("'`])((?:\/|[A-Za-z]:\/)[^)\s"'`]+)(?=$|[\s)"'`,:])/g;
const RELATIVE_PATH_IN_TEXT_PATTERN = /(?:^|[\s("'`])((?:\.\.?\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+)(?=$|[\s)"'`,:])/g;
const SHELL_TOKEN_PATTERN = /"[^"]*"|'[^']*'|`[^`]*`|\S+/g;
const SHELL_COMMAND_BREAKS = new Set(['|', '||', '&&', ';']);
const KNOWN_FILE_BASENAMES = new Set([
  '.env',
  '.env.example',
  '.gitignore',
  '.npmrc',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  'Dockerfile',
  'Makefile',
  'README',
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'index.js',
  'index.ts',
  'index.tsx',
  'index.jsx',
  'AGENTS.md',
  'SKILL.md',
  'CLAUDE.md',
]);
const KNOWN_FILE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'css',
  'csv',
  'gif',
  'go',
  'h',
  'hpp',
  'html',
  'ini',
  'ipynb',
  'java',
  'jpeg',
  'jpg',
  'js',
  'json',
  'jsonl',
  'jsx',
  'kt',
  'less',
  'lock',
  'log',
  'lua',
  'md',
  'mdx',
  'mjs',
  'pdf',
  'php',
  'png',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svg',
  'swift',
  'toml',
  'ts',
  'tsx',
  'txt',
  'tsv',
  'xml',
  'yaml',
  'yml',
]);

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+/g, '/');

const trimTrailingPathPunctuation = (value: string) => {
  let normalized = normalizePath(value).replace(/[),:;]+$/, '');

  while (normalized.endsWith('.')) {
    const candidate = normalized.slice(0, -1);
    if (!candidate || candidate === '.' || candidate === '..') {
      break;
    }

    const basename = candidate.replace(/\/$/, '').split('/').pop() || candidate;
    const extension = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() || '' : '';
    const looksLikeDirectory = candidate.includes('/') && !basename.includes('.');
    const looksLikeKnownFile = KNOWN_FILE_BASENAMES.has(basename) || (Boolean(extension) && KNOWN_FILE_EXTENSIONS.has(extension));

    if (!looksLikeDirectory && !looksLikeKnownFile) {
      break;
    }

    normalized = candidate;
  }

  return normalized;
};

const isAbsolutePath = (value: string) => value.startsWith('/') || WINDOWS_ABS_PATTERN.test(value);


const toIsoTimestamp = (value: string | number | Date | undefined): string => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[sessionContextSummary] Invalid date value, falling back to now:', value);
    }
    return new Date().toISOString();
  }
  return date.toISOString();
};

const parseJsonValue = (value: unknown): any => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const toRelativePath = (filePath: string, projectRoot: string): string | null => {
  const normalizedPath = trimTrailingPathPunctuation(String(filePath || '').trim());
  if (!normalizedPath) {
    return null;
  }

  const normalizedRoot = normalizePath(String(projectRoot || '').trim()).replace(/\/$/, '');
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath.replace(/^\.\//, '');
};


const toAbsolutePath = (filePath: string, projectRoot: string): string | null => {
  const normalizedPath = trimTrailingPathPunctuation(String(filePath || '').trim());
  if (!normalizedPath) {
    return null;
  }

  if (isAbsolutePath(normalizedPath)) {
    return normalizedPath;
  }

  const normalizedRoot = normalizePath(String(projectRoot || '').trim()).replace(/\/$/, '');
  if (!normalizedRoot) {
    return null;
  }

  return `${normalizedRoot}/${normalizedPath}`.replace(/\/+/g, '/');
};

const extractFilePathsFromResult = (toolResult: any): string[] => {
  const candidates: string[] = [];
  const toolUseResult = toolResult?.toolUseResult;
  const content = toolResult?.content;
  const parsedContent = parseJsonValue(content);
  const sources = [toolUseResult, parsedContent];

  sources.forEach((source) => {
    if (!source || typeof source !== 'object') {
      return;
    }

    if (Array.isArray(source.filenames)) {
      source.filenames.forEach((value: unknown) => {
        if (typeof value === 'string' && value.trim()) {
          candidates.push(value.trim());
        }
      });
    }

    if (Array.isArray(source.items)) {
      source.items.forEach((item: any) => {
        const nextPath = item?.path || item?.filePath || item?.file_path;
        if (typeof nextPath === 'string' && nextPath.trim()) {
          candidates.push(nextPath.trim());
        }
      });
    }

    if (source.changes && typeof source.changes === 'object') {
      Object.keys(source.changes).forEach((filePath) => {
        if (typeof filePath === 'string' && filePath.trim()) {
          candidates.push(filePath.trim());
        }
      });
    }
  });

  return Array.from(new Set(candidates));
};

const extractTodos = (toolInput: any, toolResult: any): Array<{ label: string; detail?: string }> => {
  const parsedInput = parseJsonValue(toolInput) || toolInput;
  if (Array.isArray(parsedInput?.todos)) {
    return parsedInput.todos.map((todo: any, index: number) => ({
      label: todo?.content || todo?.title || todo?.text || todo?.task || `Todo ${index + 1}`,
      detail: [todo?.status, todo?.priority].filter(Boolean).join(' · ') || undefined,
    }));
  }

  const parsedResult = parseJsonValue(toolResult?.content);
  if (Array.isArray(parsedResult)) {
    return parsedResult.map((todo: any, index: number) => ({
      label: todo?.content || todo?.title || todo?.text || todo?.task || `Todo ${index + 1}`,
      detail: [todo?.status, todo?.priority].filter(Boolean).join(' · ') || undefined,
    }));
  }

  return [];
};

const extractSkillName = (message: ChatMessage): string | null => {
  if (message.toolName === 'activate_skill' || message.toolName === 'Skill') {
    const parsedInput = parseJsonValue(message.toolInput) || {};
    const skillName = parsedInput?.name || parsedInput?.skill;
    return typeof skillName === 'string' && skillName.trim() ? skillName.trim() : null;
  }

  if (!message.isSkillContent || typeof message.content !== 'string') {
    return null;
  }

  const commandMatch = message.content.match(/<command-name>([^<]+)<\/command-name>/i);
  if (commandMatch?.[1]?.trim()) {
    return commandMatch[1].trim();
  }

  const pathMatch = message.content.match(/Base directory for this skill:\s*(\S+)/i);
  if (pathMatch?.[1]) {
    const normalized = normalizePath(pathMatch[1].trim());
    const parts = normalized.split('/');
    return parts[parts.length - 1] || normalized;
  }

  return null;
};

const extractToolInputPaths = (toolInput: any): string[] => {
  const parsedInput = parseJsonValue(toolInput) || toolInput || {};
  const candidates = new Set<string>();

  [
    parsedInput?.file_path,
    parsedInput?.path,
    parsedInput?.filePath,
    parsedInput?.absolutePath,
    parsedInput?.relativePath,
  ].forEach((value) => {
    if (typeof value === 'string' && value.trim()) {
      candidates.add(value.trim());
    }
  });

  [parsedInput?.file_paths, parsedInput?.paths].forEach((list) => {
    if (Array.isArray(list)) {
      list.forEach((value) => {
        if (typeof value === 'string' && value.trim()) {
          candidates.add(value.trim());
        }
      });
    }
  });

  return Array.from(candidates);
};

const extractPlanItems = (toolInput: any): Array<{ label: string; detail?: string }> => {
  const parsedInput = parseJsonValue(toolInput) || toolInput || {};
  if (!Array.isArray(parsedInput?.plan)) {
    return [];
  }

  return parsedInput.plan
    .map((item: any) => ({
      label: typeof item?.step === 'string' ? item.step.trim() : '',
      detail: typeof item?.status === 'string' ? item.status.trim() : undefined,
    }))
    .filter((item: { label: string }) => item.label);
};

const stripShellToken = (token: string) => token.replace(/^['"`]|['"`]$/g, '');

const isLikelyDirectoryPath = (value: string) => {
  const normalized = normalizePath(value).replace(/\/$/, '');
  const basename = normalized.split('/').pop() || normalized;
  return !basename.includes('.') && !KNOWN_FILE_BASENAMES.has(basename);
};

const isExplicitPathReference = (value: string) =>
  value.startsWith('/') || value.startsWith('./') || value.startsWith('../');

const looksLikePathToken = (value: string) => {
  const normalized = trimTrailingPathPunctuation(value);
  if (!normalized || normalized.startsWith('-') || normalized.includes('://') || SHELL_COMMAND_BREAKS.has(normalized)) {
    return false;
  }

  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) {
    return false;
  }

  const basename = normalized.split('/').pop() || normalized;
  if (KNOWN_FILE_BASENAMES.has(basename)) {
    return true;
  }

  const extension = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() || '' : '';
  if (Boolean(extension) && KNOWN_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  if (normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../') || normalized.includes('/')) {
    return !basename.includes('.');
  }

  return false;
};

const shouldTrackDirectoryCandidate = (value: string) => {
  const normalized = trimTrailingPathPunctuation(value);
  if (!normalized || !isLikelyDirectoryPath(normalized)) {
    return false;
  }

  if (isExplicitPathReference(normalized)) {
    return true;
  }

  return false;
};

const shouldTrackTextPathCandidate = (value: string) => {
  const normalized = trimTrailingPathPunctuation(value);
  if (!normalized || normalized.includes('://')) {
    return false;
  }

  if (isExplicitPathReference(normalized)) {
    return true;
  }

  const basename = normalized.split('/').pop() || normalized;
  if (KNOWN_FILE_BASENAMES.has(basename)) {
    return true;
  }

  const extension = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() || '' : '';
  return Boolean(extension) && KNOWN_FILE_EXTENSIONS.has(extension);
};

const extractPathsFromText = (value: string): string[] => {
  if (!value) return [];

  const candidates = new Set<string>();
  const pushMatch = (matchValue: string) => {
    const normalized = trimTrailingPathPunctuation(matchValue);
    if (!shouldTrackTextPathCandidate(normalized)) return;
    candidates.add(normalized);
  };

  Array.from(value.matchAll(MARKDOWN_FILE_LINK_PATTERN)).forEach((match) => {
    if (match[1]) pushMatch(match[1]);
  });

  Array.from(value.matchAll(ABSOLUTE_PATH_IN_TEXT_PATTERN)).forEach((match) => {
    if (match[1]) pushMatch(match[1]);
  });

  Array.from(value.matchAll(RELATIVE_PATH_IN_TEXT_PATTERN)).forEach((match) => {
    if (match[1]) pushMatch(match[1]);
  });

  return Array.from(candidates);
};

const extractShellContext = (
  toolInput: any,
  toolResult: any,
): { files: string[]; directories: string[] } => {
  const parsedInput = parseJsonValue(toolInput) || toolInput || {};
  const command = String(parsedInput?.command || parsedInput?.cmd || '').trim();
  const parsedCommands = Array.isArray(parsedInput?.parsed_cmd) ? parsedInput.parsed_cmd : [];
  const files = new Set<string>();
  const directories = new Set<string>();

  parsedCommands.forEach((entry: any) => {
    const nextPath = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (!nextPath) return;
    if (entry?.type === 'read') {
      files.add(nextPath);
      return;
    }
    if (entry?.type === 'list_files') {
      directories.add(nextPath);
      return;
    }
    if (entry?.type === 'search') {
      if (nextPath) directories.add(nextPath);
    }
  });

  (command.match(SHELL_TOKEN_PATTERN) || [])
    .map(stripShellToken)
    .forEach((token) => {
      if (!looksLikePathToken(token)) {
        const colonPath = token.includes(':') ? token.slice(token.indexOf(':') + 1) : '';
        if (colonPath && looksLikePathToken(colonPath)) {
          const normalized = trimTrailingPathPunctuation(colonPath);
          if (isLikelyDirectoryPath(normalized)) {
            if (shouldTrackDirectoryCandidate(normalized)) {
              directories.add(normalized);
            }
          } else {
            files.add(normalized);
          }
        }
        return;
      }

      const normalized = trimTrailingPathPunctuation(token);
      if (isLikelyDirectoryPath(normalized)) {
        if (shouldTrackDirectoryCandidate(normalized)) {
          directories.add(normalized);
        }
      } else {
        files.add(normalized);
      }
    });

  extractPathsFromText(String(toolResult?.content || '')).forEach((nextPath) => {
    if (shouldTrackDirectoryCandidate(nextPath)) {
      directories.add(nextPath);
    } else {
      files.add(nextPath);
    }
  });

  return {
    files: Array.from(files),
    directories: Array.from(directories),
  };
};

const collectProjectRootCandidate = (target: string[], candidate: unknown) => {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return;
  }

  const normalized = trimTrailingPathPunctuation(candidate).replace(/\/$/, '');
  if (!normalized || !isAbsolutePath(normalized)) {
    return;
  }

  if (isLikelyDirectoryPath(normalized)) {
    target.push(normalized);
    return;
  }

  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex > 0) {
    target.push(normalized.slice(0, lastSlashIndex));
  }
};

const longestCommonPathPrefix = (paths: string[]): string => {
  if (paths.length === 0) {
    return '';
  }

  const parts = paths
    .map((value) => normalizePath(value).replace(/\/$/, ''))
    .filter(Boolean)
    .map((value) => value.split('/'));

  if (parts.length === 0) {
    return '';
  }

  let sharedLength = parts[0].length;
  for (let index = 1; index < parts.length; index += 1) {
    sharedLength = Math.min(sharedLength, parts[index].length);
    for (let segmentIndex = 0; segmentIndex < sharedLength; segmentIndex += 1) {
      if (parts[0][segmentIndex] !== parts[index][segmentIndex]) {
        sharedLength = segmentIndex;
        break;
      }
    }
  }

  if (sharedLength === 0) {
    return '';
  }

  const prefix = parts[0].slice(0, sharedLength).join('/');
  return prefix === '/' ? '' : prefix;
};

export const resolveSessionContextProjectRoot = (messages: ChatMessage[], preferredRoot = ''): string => {
  const normalizedPreferredRoot = normalizePath(String(preferredRoot || '').trim()).replace(/\/$/, '');
  const explicitRoots: string[] = [];
  const absolutePathRoots: string[] = [];

  messages.forEach((message) => {
    collectProjectRootCandidate(explicitRoots, message.cwd);
    collectProjectRootCandidate(explicitRoots, message.workdir);
    collectProjectRootCandidate(explicitRoots, message.projectPath);

    const parsedInput = parseJsonValue(message.toolInput) || message.toolInput || {};
    collectProjectRootCandidate(explicitRoots, parsedInput?.cwd);
    collectProjectRootCandidate(explicitRoots, parsedInput?.workdir);
    collectProjectRootCandidate(explicitRoots, parsedInput?.projectPath);

    extractToolInputPaths(parsedInput).forEach((filePath) => {
      collectProjectRootCandidate(absolutePathRoots, filePath);
    });
    extractFilePathsFromResult(message.toolResult).forEach((filePath) => {
      collectProjectRootCandidate(absolutePathRoots, filePath);
    });

    if (message.toolName === 'Bash' || message.toolName === 'exec_command') {
      const shellContext = extractShellContext(parsedInput, message.toolResult);
      shellContext.files.forEach((filePath) => {
        collectProjectRootCandidate(absolutePathRoots, filePath);
      });
      shellContext.directories.forEach((directoryPath) => {
        collectProjectRootCandidate(absolutePathRoots, directoryPath);
      });
    }
  });

  const uniqueExplicitRoots = Array.from(new Set(explicitRoots));
  if (normalizedPreferredRoot && uniqueExplicitRoots.some((root) => root === normalizedPreferredRoot || root.startsWith(`${normalizedPreferredRoot}/`))) {
    return normalizedPreferredRoot;
  }

  const explicitRootPrefix = longestCommonPathPrefix(uniqueExplicitRoots);
  if (explicitRootPrefix) {
    return explicitRootPrefix;
  }

  const uniqueAbsolutePathRoots = Array.from(new Set(absolutePathRoots));
  if (normalizedPreferredRoot && uniqueAbsolutePathRoots.some((root) => root === normalizedPreferredRoot || root.startsWith(`${normalizedPreferredRoot}/`))) {
    return normalizedPreferredRoot;
  }

  const absolutePathRootPrefix = longestCommonPathPrefix(uniqueAbsolutePathRoots);
  if (absolutePathRootPrefix) {
    return absolutePathRootPrefix;
  }

  return normalizedPreferredRoot;
};

const addFile = (
  target: Map<string, FileAccumulator>,
  filePath: string,
  projectRoot: string,
  reason: string,
  timestamp: string,
) => {
  const relativePath = toRelativePath(filePath, projectRoot);
  if (!relativePath) {
    return;
  }

  const key = relativePath;
  const absolutePath = toAbsolutePath(filePath, projectRoot);
  const existing = target.get(key);
  if (existing) {
    existing.reasons.add(reason);
    existing.count += 1;
    if (timestamp > existing.lastSeenAt) {
      existing.lastSeenAt = timestamp;
      existing.absolutePath = absolutePath || existing.absolutePath;
    }
    return;
  }

  const parts = relativePath.split('/');
  target.set(key, {
    key,
    name: parts[parts.length - 1] || relativePath,
    relativePath,
    absolutePath,
    reasons: new Set([reason]),
    count: 1,
    lastSeenAt: timestamp,
  });
};

const addTask = (
  target: Map<string, TaskAccumulator>,
  kind: TaskAccumulator['kind'],
  label: string,
  detail: string | undefined,
  timestamp: string,
) => {
  const normalizedLabel = String(label || '').trim();
  if (!normalizedLabel) {
    return;
  }

  const key = `${kind}:${normalizedLabel}`;
  const existing = target.get(key);
  if (existing) {
    existing.count += 1;
    if (timestamp > existing.lastSeenAt) {
      existing.lastSeenAt = timestamp;
      existing.detail = detail || existing.detail;
    }
    return;
  }

  target.set(key, {
    key,
    label: normalizedLabel,
    detail: detail || undefined,
    kind,
    count: 1,
    lastSeenAt: timestamp,
  });
};

const parseFileChanges = (toolInput: unknown): string[] => {
  const raw = typeof toolInput === 'string' ? toolInput : '';
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        return '';
      }
      return line.slice(separatorIndex + 1).trim();
    })
    .filter(Boolean);
};

const compareByLastSeenDesc = <T extends { lastSeenAt: string; label?: string; name?: string }>(left: T, right: T) => {
  if (left.lastSeenAt !== right.lastSeenAt) {
    return right.lastSeenAt.localeCompare(left.lastSeenAt);
  }
  return String(left.label || left.name || '').localeCompare(String(right.label || right.name || ''));
};

const hasUnreadChanges = (
  relativePath: string,
  lastSeenAt: string,
  reviews: SessionReviewState,
) => {
  const review = reviews[relativePath];
  if (!review?.reviewedAt) {
    return true;
  }

  return review.reviewedAt < lastSeenAt;
};

export function mergeDistinctChatMessages(baseMessages: ChatMessage[], liveMessages: ChatMessage[]): ChatMessage[] {
  const merged = new Map<string, ChatMessage>();

  const addMessage = (message: ChatMessage) => {
    const signature = [
      message.type,
      message.timestamp ? new Date(message.timestamp).toISOString() : '',
      message.messageId || '',
      message.toolId || message.toolCallId || '',
      message.toolName || '',
      typeof message.content === 'string' ? message.content : '',
      typeof message.toolInput === 'string' ? message.toolInput : JSON.stringify(message.toolInput || ''),
    ].join('::');

    if (!merged.has(signature)) {
      merged.set(signature, message);
    }
  };

  baseMessages.forEach(addMessage);
  liveMessages.forEach(addMessage);

  return Array.from(merged.values()).sort((left, right) =>
    toIsoTimestamp(left.timestamp).localeCompare(toIsoTimestamp(right.timestamp)),
  );
}

export function deriveSessionContextSummary(
  messages: ChatMessage[],
  projectRoot: string,
  reviews: SessionReviewState = {},
): SessionContextSummary {
  const effectiveProjectRoot = resolveSessionContextProjectRoot(messages, projectRoot);
  const contextFiles = new Map<string, FileAccumulator>();
  const outputFiles = new Map<string, FileAccumulator>();
  const tasks = new Map<string, TaskAccumulator>();
  const directories = new Map<string, TaskAccumulator>();
  const skills = new Map<string, TaskAccumulator>();
  let toolCount = 0;

  messages.forEach((message) => {
    const timestamp = toIsoTimestamp(message.timestamp);
    const skillName = extractSkillName(message);
    if (skillName) {
      addTask(skills, 'skill', skillName, undefined, timestamp);
    }

    if (message.isTaskNotification && typeof message.taskOutputFile === 'string' && message.taskOutputFile.trim()) {
      addFile(outputFiles, message.taskOutputFile, effectiveProjectRoot, 'Task output', timestamp);
      if (message.taskId) {
        addTask(tasks, 'task', `Task ${message.taskId}`, message.content || undefined, timestamp);
      }
    }

    if (!message.isToolUse) {
      return;
    }

    toolCount += 1;
    const parsedInput = parseJsonValue(message.toolInput) || {};

    switch (message.toolName) {
      case 'Read': {
<<<<<<< HEAD
        extractToolInputPaths(parsedInput).forEach((filePath) => {
          addFile(contextFiles, filePath, effectiveProjectRoot, 'Read', timestamp);
        });
=======
        const filePath = parsedInput?.file_path || parsedInput?.path;
        if (typeof filePath === 'string') {
          addFile(contextFiles, filePath, projectRoot, 'Read', timestamp);
          const skillMatch = filePath.match(/\/(?:\.claude\/)?skills\/([^/]+)\/SKILL\.md$/i);
          if (skillMatch?.[1]) {
            addTask(skills, 'skill', skillMatch[1], undefined, timestamp);
          }
        }
>>>>>>> fix: shell reconnect, git panel rename, vite proxy error handling, skill detection
        break;
      }

      case 'Grep':
      case 'Glob': {
        const searchReason = message.toolName || 'Search';
        extractFilePathsFromResult(message.toolResult).forEach((filePath) => {
          addFile(contextFiles, filePath, effectiveProjectRoot, searchReason, timestamp);
        });
        break;
      }

      case 'Bash':
      case 'exec_command': {
        const shellContext = extractShellContext(parsedInput, message.toolResult);
        shellContext.files.forEach((filePath) => {
          addFile(contextFiles, filePath, effectiveProjectRoot, 'Shell', timestamp);
        });
        shellContext.directories.forEach((directoryPath) => {
          addTask(directories, 'directory', toRelativePath(directoryPath, effectiveProjectRoot) || directoryPath, 'Referenced in shell command', timestamp);
        });
        break;
      }

      case 'LS': {
        const directoryPath = parsedInput?.dir_path || parsedInput?.path || '.';
        if (typeof directoryPath === 'string' && directoryPath.trim()) {
          addTask(directories, 'directory', toRelativePath(directoryPath, effectiveProjectRoot) || directoryPath, 'Listed by LS', timestamp);
        }
        break;
      }

      case 'TaskGet':
      case 'TaskCreate':
      case 'TaskUpdate': {
        const taskId = parsedInput?.taskId ? `#${parsedInput.taskId}` : null;
        const subject = parsedInput?.subject || parsedInput?.title || parsedInput?.task || 'Task';
        const detail = [taskId, parsedInput?.status].filter(Boolean).join(' · ') || undefined;
        addTask(tasks, 'task', subject, detail, timestamp);
        break;
      }

      case 'TaskList': {
        addTask(tasks, 'task', 'Task list', 'Task list inspected', timestamp);
        break;
      }

      case 'TodoRead':
      case 'TodoWrite': {
        const todos = extractTodos(parsedInput, message.toolResult);
        if (todos.length === 0) {
          addTask(tasks, 'todo', 'Todo list', message.toolName === 'TodoRead' ? 'Todo list inspected' : 'Todo list updated', timestamp);
        } else {
          todos.forEach((todo) => {
            addTask(tasks, 'todo', todo.label, todo.detail, timestamp);
          });
        }
        break;
      }

      case 'UpdatePlan':
      case 'update_plan': {
        const planItems = extractPlanItems(parsedInput);
        if (planItems.length === 0) {
          addTask(tasks, 'task', 'Plan updated', undefined, timestamp);
        } else {
          planItems.forEach((item) => {
            addTask(tasks, 'todo', item.label, item.detail, timestamp);
          });
        }
        break;
      }

      case 'Write': {
        extractToolInputPaths(parsedInput).forEach((filePath) => {
          addFile(outputFiles, filePath, effectiveProjectRoot, 'Write', timestamp);
        });
        break;
      }

      case 'Edit':
      case 'ApplyPatch': {
        const outputPaths = new Set([
          ...extractToolInputPaths(parsedInput),
          ...extractFilePathsFromResult(message.toolResult),
        ]);
        outputPaths.forEach((filePath) => {
          addFile(outputFiles, filePath, effectiveProjectRoot, message.toolName === 'Edit' ? 'Edit' : 'Patch', timestamp);
        });
        break;
      }

      case 'FileChanges': {
        parseFileChanges(message.toolInput).forEach((filePath) => {
          addFile(outputFiles, filePath, effectiveProjectRoot, 'File change', timestamp);
        });
        break;
      }

      case 'activate_skill':
      case 'Skill': {
        const skillLabel = parsedInput?.name || parsedInput?.skill;
        if (typeof skillLabel === 'string' && skillLabel.trim()) {
          addTask(skills, 'skill', skillLabel.trim(), 'Activated in session', timestamp);
        }
        break;
      }

      case 'ViewImage': {
        extractToolInputPaths(parsedInput).forEach((filePath) => {
          addFile(contextFiles, filePath, effectiveProjectRoot, 'Image view', timestamp);
        });
        break;
      }

      case 'WebSearch': {
        const query = parsedInput?.query || parsedInput?.command;
        if (typeof query === 'string' && query.trim()) {
          addTask(tasks, 'task', query.trim(), 'Web search', timestamp);
        }
        break;
      }

      case 'OpenPage': {
        const url = parsedInput?.url;
        if (typeof url === 'string' && url.trim()) {
          addTask(tasks, 'task', url.trim(), 'Opened web page', timestamp);
        }
        break;
      }

      case 'FindInPage': {
        const pattern = parsedInput?.pattern;
        const url = parsedInput?.url;
        if (typeof pattern === 'string' && pattern.trim()) {
          addTask(tasks, 'task', pattern.trim(), typeof url === 'string' && url.trim() ? `Find in ${url.trim()}` : 'Find in page', timestamp);
        }
        break;
      }

      default:
        break;
    }
  });

  const contextFilesList = Array.from(contextFiles.values())
    .map((item) => ({
      key: item.key,
      name: item.name,
      relativePath: item.relativePath,
      absolutePath: item.absolutePath,
      reasons: Array.from(item.reasons).sort(),
      count: item.count,
      lastSeenAt: item.lastSeenAt,
    }))
    .sort(compareByLastSeenDesc);

  const outputFilesList = Array.from(outputFiles.values())
    .map((item) => ({
      key: item.key,
      name: item.name,
      relativePath: item.relativePath,
      absolutePath: item.absolutePath,
      reasons: Array.from(item.reasons).sort(),
      count: item.count,
      lastSeenAt: item.lastSeenAt,
      unread: hasUnreadChanges(item.relativePath, item.lastSeenAt, reviews),
    }))
    .sort((left, right) => {
      if (left.unread !== right.unread) {
        return left.unread ? -1 : 1;
      }
      return compareByLastSeenDesc(left, right);
    });

  const tasksList = Array.from(tasks.values()).sort(compareByLastSeenDesc);
  const directoriesList = Array.from(directories.values()).sort(compareByLastSeenDesc);
  const skillsList = Array.from(skills.values()).sort(compareByLastSeenDesc);
  const unreadCount = outputFilesList.filter((item) => item.unread).length;

  return {
    contextFiles: contextFilesList,
    outputFiles: outputFilesList,
    tasks: tasksList,
    directories: directoriesList,
    skills: skillsList,
    unreadCount,
    toolCount,
    messageCount: messages.length,
  };
}
