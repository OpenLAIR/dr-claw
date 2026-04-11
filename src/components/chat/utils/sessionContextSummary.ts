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
  path?: string;
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
  path?: string;
  count: number;
  lastSeenAt: string;
};

const WINDOWS_ABS_PATTERN = /^[a-z]:\//i;

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+/g, '/');

const isAbsolutePath = (value: string) => value.startsWith('/') || WINDOWS_ABS_PATTERN.test(value);

const toIsoTimestamp = (value: string | number | Date | undefined): string => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
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
  const normalizedPath = normalizePath(String(filePath || '').trim());
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
  const normalizedPath = normalizePath(String(filePath || '').trim());
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

const extractSkillContext = (message: ChatMessage): { label: string; path?: string } | null => {
  if (message.toolName === 'activate_skill') {
    const parsedInput = parseJsonValue(message.toolInput) || {};
    const skillName = parsedInput?.name || parsedInput?.skill;
    if (typeof skillName === 'string' && skillName.trim()) {
      return { label: skillName.trim() };
    }
    return null;
  }

  if (!message.isSkillContent || typeof message.content !== 'string') {
    return null;
  }

  const commandMatch = message.content.match(/<command-name>([^<]+)<\/command-name>/i);
  const pathMatch = message.content.match(/Base directory for this skill:\s*(\S+)/i);
  const normalizedPath = pathMatch?.[1]
    ? normalizePath(pathMatch[1].trim())
    : undefined;

  if (commandMatch?.[1]?.trim()) {
    return {
      label: commandMatch[1].trim(),
      path: normalizedPath,
    };
  }

  if (normalizedPath) {
    const normalized = normalizedPath;
    const parts = normalized.split('/');
    return {
      label: parts[parts.length - 1] || normalized,
      path: normalized,
    };
  }

  return null;
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
  path?: string,
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
      existing.path = path || existing.path;
    }
    return;
  }

  target.set(key, {
    key,
    label: normalizedLabel,
    detail: detail || undefined,
    kind,
    path: path || undefined,
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
  const contextFiles = new Map<string, FileAccumulator>();
  const outputFiles = new Map<string, FileAccumulator>();
  const tasks = new Map<string, TaskAccumulator>();
  const directories = new Map<string, TaskAccumulator>();
  const skills = new Map<string, TaskAccumulator>();
  let toolCount = 0;

  messages.forEach((message) => {
    const timestamp = toIsoTimestamp(message.timestamp);
    const skill = extractSkillContext(message);
    if (skill) {
      addTask(skills, 'skill', skill.label, undefined, timestamp, skill.path);
    }

    if (message.isTaskNotification && typeof message.taskOutputFile === 'string' && message.taskOutputFile.trim()) {
      addFile(outputFiles, message.taskOutputFile, projectRoot, 'Task output', timestamp);
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
        const filePath = parsedInput?.file_path || parsedInput?.path;
        if (typeof filePath === 'string') {
          addFile(contextFiles, filePath, projectRoot, 'Read', timestamp);
        }
        break;
      }

      case 'Grep':
      case 'Glob': {
        const searchReason = message.toolName || 'Search';
        extractFilePathsFromResult(message.toolResult).forEach((filePath) => {
          addFile(contextFiles, filePath, projectRoot, searchReason, timestamp);
        });
        break;
      }

      case 'LS': {
        const directoryPath = parsedInput?.dir_path || parsedInput?.path || '.';
        if (typeof directoryPath === 'string' && directoryPath.trim()) {
          addTask(directories, 'directory', toRelativePath(directoryPath, projectRoot) || directoryPath, 'Listed by LS', timestamp);
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

      case 'Write': {
        const filePath = parsedInput?.file_path || parsedInput?.path;
        if (typeof filePath === 'string') {
          addFile(outputFiles, filePath, projectRoot, 'Write', timestamp);
        }
        break;
      }

      case 'Edit':
      case 'ApplyPatch': {
        const filePath = parsedInput?.file_path || parsedInput?.path;
        if (typeof filePath === 'string') {
          addFile(outputFiles, filePath, projectRoot, message.toolName === 'Edit' ? 'Edit' : 'Patch', timestamp);
        }
        break;
      }

      case 'FileChanges': {
        parseFileChanges(message.toolInput).forEach((filePath) => {
          addFile(outputFiles, filePath, projectRoot, 'File change', timestamp);
        });
        break;
      }

      case 'activate_skill': {
        const skillLabel = parsedInput?.name || parsedInput?.skill;
        if (typeof skillLabel === 'string' && skillLabel.trim()) {
          addTask(skills, 'skill', skillLabel.trim(), 'Activated in session', timestamp);
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
