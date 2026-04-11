import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileGeminiSessionIndex } from './projects.js';
import { writeProjectTemplates } from './templates/index.js';
import { classifyError } from '../shared/errorClassifier.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { createRequestId, waitForToolApproval, matchesToolPermission } from './utils/permissions.js';
import { getGeminiAuthHeaders } from './utils/geminiOAuth.js';
import { buildGeminiThinkingConfig } from '../shared/geminiThinkingSupport.js';
import { spawnGemini } from './gemini-cli.js';
import { BTW_SYSTEM_PROMPT, buildBtwUserMessage } from './utils/btw.js';
import { GEMINI_MODELS } from '../shared/modelConstants.js';
import { COMPUTE_GUARD_BLOCK } from './utils/computeGuardPrompt.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';
const MAX_AGENT_TURNS = 30;
const BASH_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 100_000;
const DEFAULT_CONTEXT_WINDOW = parseInt(process.env.GEMINI_CONTEXT_WINDOW || process.env.CONTEXT_WINDOW || '2000000', 10);
export const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const GEMINI_PROJECT_ROOT_MARKER = '.project_root';
const GEMINI_CLI_SESSION_FILE_PREFIX = 'session-';
const GEMINI_MODEL_FALLBACK_CHAIN = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

const activeGeminiApiSessions = new Map();
const codeAssistProjectCache = new Map();
const CODE_ASSIST_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const GEMINI_TOOL_DECLARATIONS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path. Returns numbered lines.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Absolute or project-relative file path.' },
        file_path: { type: 'STRING', description: 'Alias for path.' },
        offset: { type: 'INTEGER', description: 'Start line (1-indexed).' },
        limit: { type: 'INTEGER', description: 'Max lines to return.' },
      },
    },
  },
  {
    name: 'read_many_files',
    description: 'Read multiple files and return their contents in a single response.',
    parameters: {
      type: 'OBJECT',
      properties: {
        paths: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Absolute or project-relative file paths.',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'File path.' },
        file_path: { type: 'STRING', description: 'Alias for path.' },
        content: { type: 'STRING', description: 'Full file content to write.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'replace',
    description: 'Replace an exact substring in a file. old_string must appear exactly once.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'File path.' },
        file_path: { type: 'STRING', description: 'Alias for path.' },
        old_str: { type: 'STRING', description: 'Exact text to find.' },
        new_str: { type: 'STRING', description: 'Replacement text.' },
        old_string: { type: 'STRING', description: 'Alias for old_str.' },
        new_string: { type: 'STRING', description: 'Alias for new_str.' },
      },
    },
  },
  {
    name: 'run_shell_command',
    description: 'Execute a shell command. Use for git, npm, python, curl, etc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Shell command to run.' },
        cmd: { type: 'STRING', description: 'Alias for command.' },
      },
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern.',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING', description: 'Glob pattern, e.g. "**/*.ts".' },
        path: { type: 'STRING', description: 'Directory to search.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_search',
    description: 'Search file contents for a regex pattern. Returns matching lines.',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING', description: 'Regex pattern.' },
        path: { type: 'STRING', description: 'File or directory to search.' },
        include: { type: 'STRING', description: 'Optional file glob filter.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_directory',
    description: 'List directory contents with file types.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Directory path.' },
        dir_path: { type: 'STRING', description: 'Alias for path.' },
      },
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch the text content of a URL.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'URL to fetch.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'google_web_search',
    description: 'Search the web using a query. Returns summarized results.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search query.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_todos',
    description: 'Create or update a structured task list for tracking progress.',
    parameters: {
      type: 'OBJECT',
      properties: {
        todos: {
          type: 'ARRAY',
          description: 'Array of TODO items.',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              content: { type: 'STRING' },
              status: { type: 'STRING', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
];

export const TOOL_NAME_MAP = {
  read_file: 'Read',
  read_many_files: 'Read',
  write_file: 'Write',
  replace: 'Edit',
  run_shell_command: 'Bash',
  glob: 'Glob',
  grep_search: 'Grep',
  list_directory: 'LS',
  web_fetch: 'WebFetch',
  google_web_search: 'WebSearch',
  write_todos: 'TodoWrite',
};

export const READ_ONLY_TOOLS = new Set([
  'read_file',
  'read_many_files',
  'glob',
  'grep_search',
  'list_directory',
  'google_web_search',
]);

function sendMessage(ws, data) {
  try {
    if (ws?.isSSEStreamWriter || ws?.isWebSocketWriter) {
      ws.send(data);
    } else if (typeof ws?.send === 'function') {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[GeminiAPI] Error sending message:', error.message);
  }
}

function truncateOutput(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated, ${text.length} total chars)`;
}

function resolveToolPath(workingDir, candidate) {
  if (!candidate) return workingDir;
  const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(workingDir, candidate);
  if (!resolved.startsWith(workingDir + path.sep) && resolved !== workingDir) {
    throw new Error(`Path "${candidate}" resolves outside project directory`);
  }
  return resolved;
}

function getFileArg(args = {}) {
  return args.path || args.file_path;
}

function getDirectoryArg(args = {}) {
  return args.path || args.dir_path;
}

function getCommandArg(args = {}) {
  return args.command || args.cmd || '';
}

function normalizeToolArgs(args) {
  if (!args || typeof args !== 'object') return {};
  return args;
}

async function executeTool(name, rawArgs, workingDir) {
  const args = normalizeToolArgs(rawArgs);

  try {
    switch (name) {
      case 'read_file': {
        const content = await fs.readFile(resolveToolPath(workingDir, getFileArg(args)), 'utf-8');
        const lines = content.split('\n');
        const start = Math.max(0, (args.offset || 1) - 1);
        const end = args.limit ? start + args.limit : lines.length;
        return truncateOutput(
          lines
            .slice(start, end)
            .map((line, index) => `${String(start + index + 1).padStart(6)}|${line}`)
            .join('\n'),
        );
      }

      case 'read_many_files': {
        const paths = Array.isArray(args.paths) ? args.paths : [];
        if (paths.length === 0) {
          return 'Error: paths must be a non-empty array';
        }

        const results = await Promise.all(paths.slice(0, 20).map(async (candidate) => {
          try {
            const resolved = resolveToolPath(workingDir, candidate);
            const content = await fs.readFile(resolved, 'utf-8');
            return `==> ${candidate} <==\n${content}`;
          } catch (fileError) {
            return `==> ${candidate} <==\nError: ${fileError.message}`;
          }
        }));
        return truncateOutput(results.join('\n\n'));
      }

      case 'write_file': {
        const filePath = resolveToolPath(workingDir, getFileArg(args));
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content || '', 'utf-8');
        return `Wrote ${(args.content || '').length} chars → ${getFileArg(args)}`;
      }

      case 'replace': {
        const filePath = resolveToolPath(workingDir, getFileArg(args));
        const oldString = args.old_str ?? args.old_string;
        const newString = args.new_str ?? args.new_string ?? '';
        if (!oldString) {
          return 'Error: replace requires old_str or old_string';
        }

        const source = await fs.readFile(filePath, 'utf-8');
        const count = source.split(oldString).length - 1;
        if (count === 0) return `Error: old_str not found in ${getFileArg(args)}`;
        if (count > 1) return `Error: old_str matches ${count} times — add more context to make it unique`;
        await fs.writeFile(filePath, source.replace(oldString, newString), 'utf-8');
        return `Edited ${getFileArg(args)}`;
      }

      case 'run_shell_command': {
        try {
          const { stdout, stderr } = await execAsync(getCommandArg(args), {
            cwd: workingDir,
            timeout: BASH_TIMEOUT_MS,
            maxBuffer: 5 * 1024 * 1024,
            env: { ...process.env, HOME: os.homedir() },
          });
          let output = stdout || '';
          if (stderr) output += `${output ? '\n' : ''}STDERR:\n${stderr}`;
          return truncateOutput(output || '(no output)');
        } catch (error) {
          return truncateOutput(
            `Exit code ${error.code ?? 1}\n${error.stdout || ''}${error.stderr ? `\nSTDERR:\n${error.stderr}` : ''}\n${error.message}`,
          );
        }
      }

      case 'glob': {
        const searchDir = resolveToolPath(workingDir, args.path);
        const pattern = String(args.pattern || '');
        try {
          const { stdout } = await execFileAsync(
            'rg', ['--files', '--glob', pattern],
            { cwd: searchDir, timeout: 30_000, maxBuffer: 1024 * 1024 },
          );
          const lines = stdout.split('\n').filter(Boolean).slice(0, 300);
          return truncateOutput(lines.join('\n') || '(no matches)');
        } catch {
          try {
            const { stdout } = await execFileAsync(
              'find', ['.', '-name', pattern, '-type', 'f'],
              { cwd: searchDir, timeout: 30_000, maxBuffer: 1024 * 1024 },
            );
            const lines = stdout.split('\n').filter(Boolean).slice(0, 300);
            return truncateOutput(lines.join('\n') || '(no matches)');
          } catch {
            return '(no matches)';
          }
        }
      }

      case 'grep_search': {
        const target = resolveToolPath(workingDir, args.path);
        const rgArgs = ['--line-number', '--max-count', '100', '--max-columns', '200'];
        if (args.include) rgArgs.push('--glob', String(args.include));
        rgArgs.push(String(args.pattern || ''), target);
        try {
          const { stdout } = await execFileAsync('rg', rgArgs, {
            cwd: workingDir,
            timeout: 30_000,
            maxBuffer: 2 * 1024 * 1024,
          });
          return truncateOutput(stdout || '(no matches)');
        } catch (error) {
          if (error.code === 1) return '(no matches)';
          return `Error: ${error.message}`;
        }
      }

      case 'list_directory': {
        const entries = await fs.readdir(resolveToolPath(workingDir, getDirectoryArg(args)), { withFileTypes: true });
        return entries.map((entry) => `${entry.isDirectory() ? 'd' : 'f'} ${entry.name}`).join('\n') || '(empty)';
      }

      case 'web_fetch': {
        const fetchUrl = new URL(String(args.url || ''));
        const hostname = fetchUrl.hostname.toLowerCase();
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          hostname === '0.0.0.0' ||
          hostname.endsWith('.local') ||
          hostname.startsWith('169.254.') ||
          hostname.startsWith('10.') ||
          hostname.startsWith('192.168.') ||
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
          fetchUrl.protocol === 'file:'
        ) {
          return 'Error: URL points to a private/internal network address (blocked)';
        }
        const response = await fetch(fetchUrl.href, {
          headers: { 'User-Agent': 'Dr. Claw Gemini API Agent' },
          signal: AbortSignal.timeout(30_000),
          redirect: 'manual',
        });
        return truncateOutput(await response.text());
      }

      case 'google_web_search': {
        const encodedQuery = encodeURIComponent(String(args.query || ''));
        try {
          const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodedQuery}`, {
            headers: { 'User-Agent': 'Dr. Claw Gemini API Agent' },
            signal: AbortSignal.timeout(15_000),
          });
          const html = await response.text();
          const results = [];
          const titleRegex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
          let match;
          while ((match = titleRegex.exec(html)) !== null && results.length < 8) {
            results.push({
              url: match[1],
              title: match[2].replace(/<[^>]+>/g, '').trim(),
            });
          }
          const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
          let index = 0;
          while ((match = snippetRegex.exec(html)) !== null && index < results.length) {
            results[index].snippet = match[1].replace(/<[^>]+>/g, '').trim();
            index += 1;
          }
          if (results.length === 0) return '(no results found)';
          return results
            .map((result, resultIndex) => `${resultIndex + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet || ''}`)
            .join('\n\n');
        } catch (error) {
          return `Search error: ${error.message}`;
        }
      }

      case 'write_todos': {
        const todos = Array.isArray(args.todos) ? args.todos : [];
        return `TODO list updated:\n${todos.map((todo) => `- [${todo.status}] ${todo.content}`).join('\n')}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error executing ${name}: ${error.message}`;
  }
}

function permissionMatches(entry, toolName, toolArgs) {
  const mappedName = TOOL_NAME_MAP[toolName] || toolName;
  return matchesToolPermission(entry, toolName, toolArgs) || matchesToolPermission(entry, mappedName, toolArgs);
}

async function checkToolPermission(toolName, toolArgs, permissionMode, allowedTools, disallowedTools, ws, sessionId, skipPermissions = false) {
  if (permissionMode === 'bypassPermissions' || skipPermissions) return true;

  if (disallowedTools.some((entry) => permissionMatches(entry, toolName, toolArgs))) return false;

  if (permissionMode === 'plan') return READ_ONLY_TOOLS.has(toolName);

  if (permissionMode === 'acceptEdits' && ['write_file', 'replace'].includes(toolName)) return true;

  if (allowedTools.some((entry) => permissionMatches(entry, toolName, toolArgs))) return true;

  if (READ_ONLY_TOOLS.has(toolName)) return true;

  const requestId = createRequestId();
  sendMessage(ws, {
    type: 'claude-permission-request',
    requestId,
    toolName: TOOL_NAME_MAP[toolName] || toolName,
    input: toolArgs,
    sessionId,
  });

  const decision = await waitForToolApproval(requestId);
  if (!decision || decision.cancelled || !decision.allow) return false;
  if (decision.rememberEntry) allowedTools.push(decision.rememberEntry);
  return true;
}

async function buildSystemPrompt(workingDir) {
  const parts = [
    `You are a powerful agentic AI research assistant. You operate in the project directory: ${workingDir}`,
    '',
    'You have tools to read and write files, run shell commands, search code, and browse the web.',
    'Use them proactively to explore the project, gather information, and produce high-quality output.',
    'Always prefer using tools over guessing about file contents or project structure.',
    '',
  ];

  try {
    const agentsMd = await fs.readFile(path.join(workingDir, 'AGENTS.md'), 'utf-8');
    if (agentsMd.trim()) parts.push('# Project Instructions (AGENTS.md)\n', agentsMd, '');
  } catch {}

  try {
    const geminiMd = await fs.readFile(path.join(workingDir, 'GEMINI.md'), 'utf-8');
    if (geminiMd.trim()) parts.push('# Project Instructions (GEMINI.md)\n', geminiMd, '');
  } catch {}

  try {
    const raw = await fs.readFile(path.join(workingDir, 'instance.json'), 'utf-8');
    const instanceData = JSON.parse(raw);
    if (instanceData.research_topic || instanceData.stages) {
      parts.push('# Project Metadata (instance.json)\n', JSON.stringify(instanceData, null, 2), '');
    }
  } catch {}

  try {
    const skillsDir = path.join(workingDir, '.agents', 'skills');
    const entries = await fs.readdir(skillsDir).catch(() => []);
    if (entries.length > 0) {
      parts.push(`# Available Skills (${entries.length})\n`);
      for (const entry of entries.slice(0, 10)) {
        try {
          const skillMd = await fs.readFile(path.join(skillsDir, entry, 'SKILL.md'), 'utf-8');
          if (skillMd.trim()) parts.push(`## Skill: ${entry}\n${skillMd.slice(0, 3000)}\n`);
        } catch {
          parts.push(`- ${entry}`);
        }
      }
      parts.push('');
    }
  } catch {}

  return parts.join('\n');
}

async function sessionsDir() {
  const dir = path.join(os.homedir(), '.gemini', 'sessions');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function sanitizeSessionId(sessionId) {
  return String(sessionId || '').replace(/[/\\]/g, '_').replace(/\.\./g, '_');
}

async function sessionFilePath(sessionId) {
  const dir = await sessionsDir();
  return path.join(dir, `${sanitizeSessionId(sessionId)}.jsonl`);
}

async function ensureSessionMetadata(sessionId, { cwd, sessionMode = 'research', summary = null }) {
  if (!sessionId || sessionId.startsWith('new-session-') || sessionId.startsWith('temp-')) return;

  const filePath = await sessionFilePath(sessionId);
  try {
    await fs.access(filePath);
    return;
  } catch {}

  const timestamp = new Date().toISOString();
  const entry = {
    type: 'session_meta',
    payload: {
      id: sessionId,
      cwd,
      timestamp,
      sessionMode,
      ...(summary ? { summary, title: summary } : {}),
    },
    cwd,
    timestamp,
    ...(summary ? { summary, title: summary } : {}),
  };
  await fs.writeFile(filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

async function appendSession(sessionId, entry) {
  if (!sessionId || sessionId.startsWith('new-session-') || sessionId.startsWith('temp-')) return;
  const filePath = await sessionFilePath(sessionId);
  await fs.appendFile(
    filePath,
    `${JSON.stringify({ ...entry, timestamp: entry.timestamp || new Date().toISOString() })}\n`,
    'utf-8',
  );
}

async function loadHistory(sessionId) {
  if (!sessionId) return [];

  try {
    const filePath = await sessionFilePath(sessionId);
    const raw = await fs.readFile(filePath, 'utf-8');
    const contents = [];
    const toolNamesById = new Map();

    for (const line of raw.trim().split('\n').filter(Boolean)) {
      const entry = JSON.parse(line);
      if (entry.type === 'session_meta') continue;

      if (entry.type === 'tool_use') {
        const toolName = entry.rawToolName || entry.toolName;
        const toolArgs = entry.toolInput || {};
        const toolCallId = entry.toolCallId || entry.tool_call_id;
        if (toolCallId && toolName) {
          toolNamesById.set(toolCallId, toolName);
        }
        if (toolName) {
          contents.push({
            role: 'model',
            parts: [{ functionCall: { name: toolName, args: toolArgs } }],
          });
        }
        continue;
      }

      if (entry.type === 'tool_result') {
        const toolCallId = entry.toolCallId || entry.tool_call_id;
        const toolName = entry.toolName || toolNamesById.get(toolCallId);
        if (toolName) {
          contents.push({
            role: 'user',
            parts: [{
              functionResponse: {
                name: toolName,
                response: { result: entry.output || entry.content || '' },
              },
            }],
          });
        }
        continue;
      }

      const role = entry.role || entry.message?.role;
      const content = entry.content || entry.message?.content;
      if (!role || !content) continue;

      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => part?.text || (typeof part === 'string' ? part : '')).join('\n')
          : '';

      if (!text.trim()) continue;

      contents.push({
        role: role === 'assistant' ? 'model' : 'user',
        parts: [{ text }],
      });
    }

    return contents;
  } catch {
    return [];
  }
}

function slugifyGeminiProjectName(text) {
  return (String(text || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'project');
}

function normalizeGeminiProjectPath(projectPath) {
  return path.resolve(projectPath || process.cwd());
}

async function ensureGeminiCliProjectOwnership(projectIdentifier, projectPath) {
  const normalizedProjectPath = normalizeGeminiProjectPath(projectPath);
  const baseDirs = [
    path.join(os.homedir(), '.gemini', 'tmp'),
    path.join(os.homedir(), '.gemini', 'history'),
  ];

  for (const baseDir of baseDirs) {
    const projectDir = path.join(baseDir, projectIdentifier);
    const markerPath = path.join(projectDir, GEMINI_PROJECT_ROOT_MARKER);

    await fs.mkdir(projectDir, { recursive: true });

    try {
      const owner = (await fs.readFile(markerPath, 'utf8')).trim();
      if (normalizeGeminiProjectPath(owner) !== normalizedProjectPath) {
        throw new Error(`Gemini project identifier ${projectIdentifier} is already owned by ${owner}`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        await fs.writeFile(markerPath, normalizedProjectPath, { encoding: 'utf8', flag: 'wx' });
        continue;
      }
      throw error;
    }
  }
}

async function ensureGeminiCliProjectIdentifier(projectPath) {
  const normalizedProjectPath = normalizeGeminiProjectPath(projectPath);
  const geminiDir = path.join(os.homedir(), '.gemini');
  const registryPath = path.join(geminiDir, 'projects.json');

  await fs.mkdir(geminiDir, { recursive: true });

  let registry = { projects: {} };
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.projects && typeof parsed.projects === 'object') {
      registry = { projects: parsed.projects };
    }
  } catch {}

  const existingIdentifier = registry.projects[normalizedProjectPath];
  if (existingIdentifier) {
    await ensureGeminiCliProjectOwnership(existingIdentifier, normalizedProjectPath);
    return existingIdentifier;
  }

  const baseSlug = slugifyGeminiProjectName(path.basename(normalizedProjectPath) || 'project');
  const usedIdentifiers = new Map(Object.entries(registry.projects || {}));

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? baseSlug : `${baseSlug}-${suffix}`;
    const mappedOwner = Array.from(usedIdentifiers.entries()).find(([, value]) => value === candidate)?.[0];
    if (mappedOwner && normalizeGeminiProjectPath(mappedOwner) !== normalizedProjectPath) {
      continue;
    }

    try {
      await ensureGeminiCliProjectOwnership(candidate, normalizedProjectPath);
      registry.projects[normalizedProjectPath] = candidate;
      await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
      return candidate;
    } catch (error) {
      if (String(error?.message || '').includes('already owned by')) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Unable to claim a Gemini project identifier for ${normalizedProjectPath}`);
}

async function readGeminiSessionEntries(sessionId) {
  if (!sessionId) return [];

  try {
    const filePath = await sessionFilePath(sessionId);
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function findGeminiCliConversationFile(chatsDir, sessionId) {
  try {
    const files = await fs.readdir(chatsDir);
    for (const fileName of files) {
      if (!fileName.startsWith(GEMINI_CLI_SESSION_FILE_PREFIX) || !fileName.endsWith('.json')) continue;
      const filePath = path.join(chatsDir, fileName);
      try {
        const conversation = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (conversation?.sessionId === sessionId) {
          return { filePath, conversation };
        }
      } catch {}
    }
  } catch {}

  return null;
}

function buildGeminiCliConversation(entries, sessionId, projectIdentifier, model) {
  const conversationMessages = [];
  let firstTimestamp = null;
  let lastTimestamp = null;
  const pendingToolUses = new Map();

  const rememberTimestamp = (timestamp) => {
    if (!timestamp) return;
    if (!firstTimestamp || timestamp < firstTimestamp) firstTimestamp = timestamp;
    if (!lastTimestamp || timestamp > lastTimestamp) lastTimestamp = timestamp;
  };

  for (const entry of entries) {
    if (!entry || entry.type === 'session_meta') continue;

    const timestamp = entry.timestamp || new Date().toISOString();
    rememberTimestamp(timestamp);

    if (entry.type === 'message') {
      const role = entry.role || entry.message?.role;
      const content = entry.content || entry.message?.content;
      if (!role || content == null) continue;

      if (role === 'user') {
        conversationMessages.push({
          id: crypto.randomUUID(),
          timestamp,
          type: 'user',
          content,
        });
      } else if (role === 'assistant' || role === 'model') {
        conversationMessages.push({
          id: crypto.randomUUID(),
          timestamp,
          type: 'gemini',
          content,
          thoughts: [],
          model,
        });
      }
      continue;
    }

    if (entry.type === 'tool_use') {
      const toolCallId = entry.toolCallId || entry.tool_call_id || crypto.randomUUID();
      pendingToolUses.set(toolCallId, entry);
      continue;
    }

    if (entry.type === 'tool_result') {
      const toolCallId = entry.toolCallId || entry.tool_call_id || crypto.randomUUID();
      const toolUse = pendingToolUses.get(toolCallId) || {};
      pendingToolUses.delete(toolCallId);

      conversationMessages.push({
        id: crypto.randomUUID(),
        timestamp,
        type: 'gemini',
        content: '',
        thoughts: [],
        model,
        toolCalls: [{
          id: toolCallId,
          name: entry.toolName || toolUse.toolName || toolUse.rawToolName || 'unknown_tool',
          args: toolUse.toolInput || {},
          result: entry.output || entry.content || '',
          status: entry.isError ? 'error' : 'success',
          timestamp,
        }],
      });
    }
  }

  if (conversationMessages.length === 0) {
    return null;
  }

  return {
    sessionId,
    projectHash: projectIdentifier,
    startTime: firstTimestamp || new Date().toISOString(),
    lastUpdated: lastTimestamp || firstTimestamp || new Date().toISOString(),
    messages: conversationMessages,
    kind: 'main',
  };
}

function formatGeminiCliSessionFileName(sessionId, startTime) {
  const safeTimestamp = new Date(startTime || Date.now())
    .toISOString()
    .slice(0, 16)
    .replace(/:/g, '-');
  return `${GEMINI_CLI_SESSION_FILE_PREFIX}${safeTimestamp}-${String(sessionId).slice(0, 8)}.json`;
}

async function bridgeGeminiSessionToCli(sessionId, projectPath, { model } = {}) {
  if (!sessionId || !projectPath) {
    return { ready: false, hasConversationContext: false };
  }

  const projectIdentifier = await ensureGeminiCliProjectIdentifier(projectPath);
  const chatsDir = path.join(os.homedir(), '.gemini', 'tmp', projectIdentifier, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });

  const existingConversation = await findGeminiCliConversationFile(chatsDir, sessionId);
  const entries = await readGeminiSessionEntries(sessionId);
  const conversation = buildGeminiCliConversation(entries, sessionId, projectIdentifier, model);
  if (!conversation && existingConversation) {
    return {
      ready: true,
      sessionId,
      chatFilePath: existingConversation.filePath,
      hasConversationContext: Array.isArray(existingConversation.conversation?.messages)
        && existingConversation.conversation.messages.some((message) => message?.type === 'gemini'),
    };
  }

  if (!conversation) {
    return { ready: false, hasConversationContext: false };
  }

  const filePath = existingConversation?.filePath
    || path.join(chatsDir, formatGeminiCliSessionFileName(sessionId, conversation.startTime));
  await fs.writeFile(filePath, `${JSON.stringify(conversation, null, 2)}\n`, 'utf8');

  return {
    ready: true,
    sessionId,
    chatFilePath: filePath,
    hasConversationContext: conversation.messages.some((message) => message?.type === 'gemini'),
  };
}

function buildGeminiCliFallbackPrompt(command, { hasConversationContext = false } = {}) {
  const normalizedCommand = String(command || '').trim();

  if (hasConversationContext) {
    const prefix = 'Continue the current task from the existing session context. The previous direct API request hit a transient capacity error. Do not restart from scratch or repeat completed work unless necessary.';
    return normalizedCommand
      ? `${prefix}\n\nOriginal user request:\n${normalizedCommand}`
      : prefix;
  }

  return normalizedCommand || 'Continue the current task.';
}

async function fallbackToGeminiCli(command, options, ws, currentSessionId, requestError) {
  const workingDirectory = options.cwd || options.projectPath || process.cwd();
  const fallbackOptions = {
    ...options,
    cwd: workingDirectory,
    projectPath: workingDirectory,
  };

  let bridgedSession = { ready: false, hasConversationContext: false };
  try {
    bridgedSession = await bridgeGeminiSessionToCli(currentSessionId, workingDirectory, {
      model: options.model,
    });
  } catch (error) {
    console.warn('[GeminiAPI] Failed to bridge session into Gemini CLI storage:', error.message);
  }

  const fallbackPrompt = buildGeminiCliFallbackPrompt(command, {
    hasConversationContext: bridgedSession.hasConversationContext,
  });

  if (bridgedSession.ready) {
    fallbackOptions.sessionId = currentSessionId;
  } else {
    fallbackOptions.sessionId = null;
  }

  activeGeminiApiSessions.delete(currentSessionId);

  try {
    console.warn(`[GeminiAPI] ${requestError.errorMessage}. Falling back to Gemini CLI harness.`);
    await spawnGemini(fallbackPrompt, fallbackOptions, ws);
    return true;
  } catch (error) {
    console.error('[GeminiAPI] Gemini CLI fallback failed:', error);
    return false;
  }
}

export function buildRequestBody(model, contents, systemInstruction, thinkingMode, toolDeclarations) {
  const requestBody = {
    systemInstruction,
    contents,
  };

  if (Array.isArray(toolDeclarations) && toolDeclarations.length > 0) {
    requestBody.tools = [{ functionDeclarations: toolDeclarations }];
    requestBody.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }

  const thinkingConfig = buildGeminiThinkingConfig(model, thinkingMode);
  if (thinkingConfig) {
    requestBody.generationConfig = { thinkingConfig };
  }

  return requestBody;
}

export function buildModelTurnParts(text, functionCalls, { requireSyntheticThoughtSignatures = false } = {}) {
  const parts = [];
  if (text) {
    parts.push({ text });
  }

  for (const [index, functionCall] of (functionCalls || []).entries()) {
    const part = {
      functionCall: {
        name: functionCall.name,
        args: functionCall.args || {},
      },
    };

    const thoughtSignature = functionCall.thoughtSignature
      || (requireSyntheticThoughtSignatures && index === 0 ? SYNTHETIC_THOUGHT_SIGNATURE : null);
    if (thoughtSignature) {
      part.thoughtSignature = thoughtSignature;
    }

    parts.push(part);
  }

  return parts;
}

function getCodeAssistCacheKey(authHeaders) {
  return authHeaders?.Authorization || JSON.stringify(authHeaders || {});
}

function getGeminiApiMaxAttempts() {
  const parsed = parseInt(process.env.GEMINI_API_MAX_ATTEMPTS || '3', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function getGeminiApiRetryBaseMs() {
  const parsed = parseInt(process.env.GEMINI_API_RETRY_BASE_MS || '750', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 750;
}

function getGeminiApiRetryMaxMs() {
  const parsed = parseInt(process.env.GEMINI_API_RETRY_MAX_MS || '4000', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 4000;
}

function isRetryableGeminiStatus(status) {
  return RETRYABLE_HTTP_STATUS.has(status);
}

function parseRetryAfterMs(headers) {
  if (!headers || typeof headers.get !== 'function') return null;

  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const when = Date.parse(retryAfter);
  if (Number.isFinite(when)) {
    return Math.max(0, when - Date.now());
  }

  return null;
}

function resolveRetryDelayMs(attemptIndex, headers) {
  const retryAfterMs = parseRetryAfterMs(headers);
  if (retryAfterMs !== null) return retryAfterMs;

  const baseMs = getGeminiApiRetryBaseMs();
  if (baseMs <= 0) return 0;

  return Math.min(getGeminiApiRetryMaxMs(), baseMs * (2 ** attemptIndex));
}

async function waitForRetryDelay(delayMs, signal) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, delayMs);

    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function executeGeminiRequestWithRetry(requestFn, {
  signal,
  operationName,
  errorFormatter,
} = {}) {
  const maxAttempts = getGeminiApiMaxAttempts();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await requestFn();
      if (response.ok) {
        return { response };
      }

      const bodyText = await response.text();
      const errorMessage = errorFormatter
        ? errorFormatter(response.status, bodyText)
        : summarizeGeminiApiError(response.status, bodyText);
      const classified = classifyError(`${response.status} ${errorMessage} ${bodyText}`);
      const isRetryable = classified.isRetryable || isRetryableGeminiStatus(response.status);
      const error = {
        status: response.status,
        bodyText,
        errorMessage,
        errorType: classified.errorType,
        isRetryable,
      };

      if (!isRetryable || attempt === maxAttempts - 1) {
        return { error };
      }

      const delayMs = resolveRetryDelayMs(attempt, response.headers);
      console.warn(
        `[GeminiAPI] ${operationName || 'request'} failed (${response.status}) ` +
        `attempt ${attempt + 1}/${maxAttempts}; retrying in ${delayMs}ms`,
      );
      await waitForRetryDelay(delayMs, signal);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }

      const errorMessage = error?.message || 'Network error';
      const classified = classifyError(errorMessage);
      const normalizedError = {
        status: null,
        bodyText: '',
        errorMessage,
        errorType: classified.errorType,
        isRetryable: classified.isRetryable,
      };

      if (!normalizedError.isRetryable || attempt === maxAttempts - 1) {
        return { error: normalizedError };
      }

      const delayMs = resolveRetryDelayMs(attempt);
      console.warn(
        `[GeminiAPI] ${operationName || 'request'} threw before completion ` +
        `attempt ${attempt + 1}/${maxAttempts}; retrying in ${delayMs}ms: ${errorMessage}`,
      );
      await waitForRetryDelay(delayMs, signal);
    }
  }

  return {
    error: {
      status: null,
      bodyText: '',
      errorMessage: `${operationName || 'Request'} failed after retries`,
      errorType: 'unknown',
      isRetryable: true,
    },
  };
}

function sendGeminiApiError(ws, sessionId, error) {
  sendMessage(ws, {
    type: 'gemini-error',
    error: error.errorMessage,
    errorType: error.errorType || 'unknown',
    isRetryable: Boolean(error.isRetryable),
    details: error.bodyText ? error.bodyText.slice(0, 12000) : undefined,
    sessionId,
  });
}

function summarizeCodeAssistBootstrapError(status, bodyText) {
  try {
    const parsed = JSON.parse(String(bodyText || '').trim());
    const message = parsed.error?.message || parsed.message;
    if (message) return `Code Assist onboarding failed (${status}): ${message}`;
  } catch {}

  const text = String(bodyText || '').trim();
  return text
    ? `Code Assist onboarding failed (${status}): ${text}`
    : `Code Assist onboarding failed (${status})`;
}

async function loadCodeAssistProject(authHeaders, signal) {
  const cacheKey = getCodeAssistCacheKey(authHeaders);
  const cachedEntry = codeAssistProjectCache.get(cacheKey);
  if (cachedEntry && (Date.now() - cachedEntry.ts) < CODE_ASSIST_CACHE_TTL_MS) {
    return cachedEntry.projectId;
  }

  const configuredProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || undefined;
  const body = {
    cloudaicompanionProject: configuredProject,
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
      ...(configuredProject ? { duetProject: configuredProject } : {}),
    },
  };

  const request = await executeGeminiRequestWithRetry(() => fetch(`${CODE_ASSIST_BASE}:loadCodeAssist`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  }), {
    signal,
    operationName: 'Code Assist bootstrap',
    errorFormatter: summarizeCodeAssistBootstrapError,
  });

  if (request.error) {
    const error = new Error(request.error.errorMessage);
    Object.assign(error, request.error);
    throw error;
  }

  const data = await request.response.json();
  const projectId = data?.cloudaicompanionProject || configuredProject;
  if (!projectId) {
    throw new Error('Code Assist onboarding succeeded but no project ID was returned.');
  }

  codeAssistProjectCache.set(cacheKey, { projectId, ts: Date.now() });
  return projectId;
}

async function streamGenerateContent(model, body, authHeaders, signal, options = {}) {
  const { authMethod, sessionId, codeAssistProjectId } = options;

  if (authMethod === 'oauth') {
    const requestBody = {
      model,
      project: codeAssistProjectId,
      user_prompt_id: sessionId || crypto.randomUUID(),
      request: {
        ...body,
        session_id: sessionId,
      },
    };

    return fetch(`${CODE_ASSIST_BASE}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
    });
  }

  return fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
}

function collectUsageTokens(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== 'object') return 0;
  if (Number.isFinite(usageMetadata.totalTokenCount)) return usageMetadata.totalTokenCount;

  return [
    usageMetadata.promptTokenCount,
    usageMetadata.cachedContentTokenCount,
    usageMetadata.candidatesTokenCount,
    usageMetadata.toolUsePromptTokenCount,
    usageMetadata.thoughtsTokenCount,
  ].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

export async function consumeGeminiStream(response, { onText, onAbortCheck } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const functionCalls = [];
  let finishReason = null;
  let usageMetadata = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (onAbortCheck?.()) {
      await reader.cancel();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data: ')) continue;

      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      const normalizedPayload = parsed.response || parsed;

      if (normalizedPayload.usageMetadata) {
        usageMetadata = normalizedPayload.usageMetadata;
      }

      const candidate = normalizedPayload.candidates?.[0];
      if (!candidate) continue;
      if (candidate.finishReason) finishReason = candidate.finishReason;

      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          content += part.text;
          onText?.(part.text);
        }
        if (part.functionCall?.name) {
          functionCalls.push({
            name: part.functionCall.name,
            args: part.functionCall.args || {},
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
          });
        }
      }
    }
  }

  if (buffer.trim().startsWith('data: ')) {
    const payload = buffer.trim().slice(6).trim();
    if (payload && payload !== '[DONE]') {
      try {
        const parsed = JSON.parse(payload);
        const normalizedPayload = parsed.response || parsed;
        if (normalizedPayload.usageMetadata) usageMetadata = normalizedPayload.usageMetadata;
        const candidate = normalizedPayload.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          if (typeof part.text === 'string' && part.text.length > 0) {
            content += part.text;
            onText?.(part.text);
          }
          if (part.functionCall?.name) {
            functionCalls.push({
              name: part.functionCall.name,
              args: part.functionCall.args || {},
              ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
            });
          }
        }
      } catch {}
    }
  }

  return { content, functionCalls, finishReason, usageMetadata };
}

function summarizeGeminiApiError(status, bodyText, fallbackModel) {
  const text = String(bodyText || '').trim();
  const isCapacity429 = status === 429 || /RESOURCE_EXHAUSTED|MODEL_CAPACITY_EXHAUSTED|No capacity available/i.test(text);
  if (isCapacity429) {
    const modelMatch =
      text.match(/No capacity available for model ([a-zA-Z0-9._-]+)/i) ||
      text.match(/"model"\s*:\s*"([^"]+)"/i);
    const modelName = modelMatch?.[1] || fallbackModel || 'current model';
    return `Model capacity exhausted for ${modelName} (HTTP 429). Please retry in a moment or switch to a Flash/Lite model.`;
  }

  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.message || `Gemini API error (${status})`;
  } catch {
    return text || `Gemini API error (${status})`;
  }
}

function isCapacityExhaustedError(error) {
  if (!error) return false;
  if (error.status === 429) return true;
  const combinedText = `${error.errorMessage || ''} ${error.bodyText || ''}`;
  return /RESOURCE_EXHAUSTED|MODEL_CAPACITY_EXHAUSTED|No capacity available|capacity exhausted/i.test(combinedText);
}

function getNextGeminiFallbackModel(model) {
  const currentIndex = GEMINI_MODEL_FALLBACK_CHAIN.indexOf(model);
  if (currentIndex === -1) return null;
  return GEMINI_MODEL_FALLBACK_CHAIN[currentIndex + 1] || null;
}

export async function queryGeminiApi(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model: requestedModel = 'gemini-2.5-flash',
    env,
    sessionMode,
    stageTagKeys,
    stageTagSource = 'task_context',
    systemPrompt: customSystemPrompt,
    permissionMode = 'bypassPermissions',
    toolsSettings,
    thinkingMode,
    userId,
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const currentSessionId = sessionId || `gemini-${crypto.randomUUID()}`;
  const abortController = new AbortController();
  const allowedTools = [...(toolsSettings?.allowedTools || [])];
  const disallowedTools = [...(toolsSettings?.disallowedTools || [])];
  const sessionStartTime = Date.now();
  let activeModel = requestedModel;

  let auth = null;
  if (env?.GEMINI_API_KEY) {
    auth = { headers: { 'x-goog-api-key': env.GEMINI_API_KEY }, authMethod: 'api-key' };
  } else if (env?.GOOGLE_API_KEY) {
    auth = { headers: { 'x-goog-api-key': env.GOOGLE_API_KEY }, authMethod: 'api-key' };
  } else {
    auth = await getGeminiAuthHeaders(userId);
  }

  if (!auth?.headers) {
    return { authFailed: true };
  }

  let codeAssistProjectId = null;
  if (auth.authMethod === 'oauth') {
    try {
      codeAssistProjectId = await loadCodeAssistProject(auth.headers, abortController.signal);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403 || error?.errorType === 'auth') {
        console.warn('[GeminiAPI] Code Assist auth bootstrap failed:', error.message);
        return { authFailed: true };
      }
      if (error?.isRetryable) {
        const fellBackToCli = await fallbackToGeminiCli(command, {
          ...options,
          cwd: workingDirectory,
          projectPath: workingDirectory,
          model: activeModel,
          sessionId: currentSessionId,
        }, ws, currentSessionId, {
          errorMessage: error?.message || 'Code Assist bootstrap failed',
          errorType: error?.errorType || 'unknown',
          isRetryable: Boolean(error?.isRetryable),
          bodyText: error?.bodyText || '',
        });
        if (fellBackToCli) {
          return { cliFallback: true };
        }
      }
      sendGeminiApiError(ws, currentSessionId, {
        errorMessage: error?.message || 'Code Assist bootstrap failed',
        errorType: error?.errorType || 'unknown',
        isRetryable: Boolean(error?.isRetryable),
        bodyText: error?.bodyText || '',
      });
      return;
    }
  }

  try {
    if (workingDirectory) {
      try {
        await ensureProjectSkillLinks(workingDirectory);
        await writeProjectTemplates(workingDirectory);
      } catch (error) {
        console.warn('[GeminiAPI] Project template init warning:', error.message);
      }
    }

    if (currentSessionId && workingDirectory) {
      applyStageTagsToSession({
        sessionId: currentSessionId,
        projectPath: workingDirectory,
        stageTagKeys,
        source: stageTagSource,
      });
    }

    activeGeminiApiSessions.set(currentSessionId, {
      status: 'running',
      abortController,
      startTime: sessionStartTime,
    });

    const userText = String(command || '').replace(/\s*\[Context:[^\]]*\]\s*/gi, '').trim();
    const sessionDisplayName = userText.slice(0, 100) || 'Gemini Session';

    if (workingDirectory) {
      recordIndexedSession({
        sessionId: currentSessionId,
        provider: 'gemini',
        projectPath: workingDirectory,
        sessionMode: sessionMode || 'research',
        displayName: sessionDisplayName,
        stageTagKeys,
        tagSource: stageTagSource,
      });
    }

    await ensureSessionMetadata(currentSessionId, {
      cwd: workingDirectory,
      sessionMode: sessionMode || 'research',
      summary: sessionDisplayName,
    });

    sendMessage(ws, {
      type: 'session-created',
      sessionId: currentSessionId,
      provider: 'gemini',
      mode: sessionMode || 'research',
      startTime: sessionStartTime,
      displayName: sessionDisplayName,
      projectName: workingDirectory ? encodeProjectPath(workingDirectory) : undefined,
    });

    const systemText = (customSystemPrompt || await buildSystemPrompt(workingDirectory)) + COMPUTE_GUARD_BLOCK;
    const systemInstruction = { parts: [{ text: systemText }] };
    const contents = [];

    if (sessionId) {
      const history = await loadHistory(sessionId);
      if (history.length > 0) {
        console.log(`[GeminiAPI] Resumed session ${sessionId} with ${history.length} history entries`);
        contents.push(...history);
      }
    }

    contents.push({ role: 'user', parts: [{ text: String(command || '') }] });
    await appendSession(currentSessionId, {
      type: 'message',
      role: 'user',
      content: String(command || ''),
      cwd: workingDirectory,
    }).catch(() => {});

    const toolDeclarations = permissionMode === 'plan'
      ? GEMINI_TOOL_DECLARATIONS.filter((tool) => READ_ONLY_TOOLS.has(tool.name))
      : GEMINI_TOOL_DECLARATIONS;

    let turn = 0;
    while (turn < MAX_AGENT_TURNS) {
      turn += 1;
      const currentSession = activeGeminiApiSessions.get(currentSessionId);
      if (!currentSession || currentSession.status === 'aborted') break;

      const requestBody = buildRequestBody(
        activeModel,
        contents,
        systemInstruction,
        thinkingMode,
        toolDeclarations,
      );

      const request = await executeGeminiRequestWithRetry(
        () => streamGenerateContent(activeModel, requestBody, auth.headers, abortController.signal, {
          authMethod: auth.authMethod,
          sessionId: currentSessionId,
          codeAssistProjectId,
        }),
        {
          signal: abortController.signal,
          operationName: `Gemini turn ${turn}`,
          errorFormatter: (status, bodyText) => summarizeGeminiApiError(status, bodyText, activeModel),
        },
      );

      if (request.error) {
        if (request.error.status === 401 || request.error.status === 403) {
          sendGeminiApiError(ws, currentSessionId, request.error);
          sendMessage(ws, { type: 'gemini-complete', sessionId: currentSessionId, exitCode: 1 });
          return { authFailed: true };
        }
        if (request.error.isRetryable && isCapacityExhaustedError(request.error)) {
          const fallbackModel = getNextGeminiFallbackModel(activeModel);
          if (fallbackModel) {
            sendMessage(ws, {
              type: 'gemini-status',
              sessionId: currentSessionId,
              data: {
                status: `Model busy, retrying with ${fallbackModel}...`,
                can_interrupt: true,
                startTime: sessionStartTime,
              },
            });
            activeModel = fallbackModel;
            turn -= 1;
            continue;
          }
        }
        if (request.error.isRetryable) {
          const fellBackToCli = await fallbackToGeminiCli(command, {
            ...options,
            cwd: workingDirectory,
            projectPath: workingDirectory,
            model: activeModel,
            sessionId: currentSessionId,
          }, ws, currentSessionId, request.error);
          if (fellBackToCli) {
            return { cliFallback: true };
          }
        }
        sendGeminiApiError(ws, currentSessionId, request.error);
        return;
      }

      const result = await consumeGeminiStream(request.response, {
        onText(delta) {
          sendMessage(ws, {
            type: 'gemini-response',
            sessionId: currentSessionId,
            data: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: delta },
            },
          });
        },
        onAbortCheck() {
          const session = activeGeminiApiSessions.get(currentSessionId);
          return !session || session.status === 'aborted';
        },
      });

      sendMessage(ws, {
        type: 'token-budget',
        sessionId: currentSessionId,
        data: {
          used: Math.round(collectUsageTokens(result.usageMetadata)),
          total: DEFAULT_CONTEXT_WINDOW,
        },
      });

      if (result.content) {
        sendMessage(ws, {
          type: 'gemini-response',
          sessionId: currentSessionId,
          data: { type: 'content_block_stop', index: 0 },
        });
      }

      if (result.functionCalls.length === 0) {
        if (result.content) {
          await appendSession(currentSessionId, {
            type: 'message',
            role: 'assistant',
            content: result.content,
          }).catch(() => {});
        }
        break;
      }

      const allFunctionCallMeta = [];
      const functionResponses = [];

      if (result.content) {
        await appendSession(currentSessionId, {
          type: 'message',
          role: 'assistant',
          content: result.content,
        }).catch(() => {});
      }

      for (let index = 0; index < result.functionCalls.length; index += 1) {
        const functionCall = result.functionCalls[index];
        const toolCallId = `tool_${crypto.randomUUID()}`;
        const toolArgs = normalizeToolArgs(functionCall.args);

        sendMessage(ws, {
          type: 'gemini-response',
          sessionId: currentSessionId,
          data: {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: toolCallId,
              name: functionCall.name,
              input: toolArgs,
            }],
          },
        });

        await appendSession(currentSessionId, {
          type: 'tool_use',
          toolName: functionCall.name,
          rawToolName: functionCall.name,
          toolInput: toolArgs,
          toolCallId,
        }).catch(() => {});

        allFunctionCallMeta.push({
          name: functionCall.name,
          args: toolArgs,
          thoughtSignature: functionCall.thoughtSignature,
        });

        const allowed = await checkToolPermission(
          functionCall.name,
          toolArgs,
          permissionMode,
          allowedTools,
          disallowedTools,
          ws,
          currentSessionId,
          toolsSettings?.skipPermissions === true,
        );

        const output = allowed
          ? await executeTool(functionCall.name, toolArgs, workingDirectory)
          : `Permission denied for tool: ${functionCall.name}`;
        const isError = !allowed || (typeof output === 'string' && output.startsWith('Error'));

        sendMessage(ws, {
          type: 'gemini-response',
          sessionId: currentSessionId,
          data: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolCallId,
              content: output.slice(0, 2000),
              is_error: isError,
            }],
          },
        });

        await appendSession(currentSessionId, {
          type: 'tool_result',
          toolName: functionCall.name,
          toolCallId,
          output,
          isError,
        }).catch(() => {});

        functionResponses.push({
          functionResponse: {
            name: functionCall.name,
            id: toolCallId,
            response: { result: output },
          },
        });
      }

      // Push model turn with ALL function calls once, then ALL responses once
      contents.push({
        role: 'model',
        parts: buildModelTurnParts(result.content, allFunctionCallMeta, {
          requireSyntheticThoughtSignatures: auth.authMethod === 'oauth',
        }),
      });
      contents.push({
        role: 'user',
        parts: functionResponses,
      });
    }

    if (workingDirectory) {
      try {
        await reconcileGeminiSessionIndex(workingDirectory, {
          sessionId: currentSessionId,
          projectName: encodeProjectPath(workingDirectory),
        });
      } catch (error) {
        console.warn('[GeminiAPI] Session reconciliation warning:', error.message);
      }
    }

    sendMessage(ws, { type: 'gemini-complete', sessionId: currentSessionId, exitCode: 0 });
  } catch (error) {
    if (error.name === 'AbortError') {
      sendMessage(ws, {
        type: 'gemini-complete',
        sessionId: currentSessionId,
        exitCode: 1,
        aborted: true,
      });
      return;
    }

    console.error('[GeminiAPI] Unexpected error:', error);
    throw error;
  } finally {
    const session = activeGeminiApiSessions.get(currentSessionId);
    if (session) {
      session.status = 'completed';
    }
  }
}

export function abortGeminiApiSession(sessionId) {
  const session = activeGeminiApiSessions.get(sessionId);
  if (!session) return false;
  session.status = 'aborted';
  session.abortController?.abort();
  activeGeminiApiSessions.delete(sessionId);
  return true;
}

export function isGeminiApiSessionActive(sessionId) {
  return activeGeminiApiSessions.get(sessionId)?.status === 'running';
}

export function getGeminiApiSessionStartTime(sessionId) {
  return activeGeminiApiSessions.get(sessionId)?.startTime || null;
}

export function getActiveGeminiApiSessions() {
  return Array.from(activeGeminiApiSessions.entries())
    .filter(([, session]) => session.status === 'running')
    .map(([sessionId, session]) => ({
      sessionId,
      startTime: session.startTime,
    }));
}

/**
 * One-shot, tool-free side question for the /btw overlay.
 * Uses the non-streaming generateContent endpoint for simplicity.
 */
export async function runGeminiBtw({ question, transcript, model, env, userId, signal }) {
  const userBlock = buildBtwUserMessage(question, transcript);
  const effectiveModel = model || GEMINI_MODELS.DEFAULT;

  let auth = null;
  if (env?.GEMINI_API_KEY) {
    auth = { headers: { 'x-goog-api-key': env.GEMINI_API_KEY }, authMethod: 'api-key' };
  } else if (env?.GOOGLE_API_KEY) {
    auth = { headers: { 'x-goog-api-key': env.GOOGLE_API_KEY }, authMethod: 'api-key' };
  } else {
    auth = await getGeminiAuthHeaders(userId);
  }

  if (!auth?.headers) {
    throw new Error('No Gemini API credentials available');
  }

  const requestBody = {
    systemInstruction: { parts: [{ text: BTW_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userBlock }] }],
  };

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(effectiveModel)}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  const data = await response.json();
  const answer = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join('') || '';

  return { answer };
}

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of activeGeminiApiSessions.entries()) {
    if (session.status !== 'running' && now - (session.startTime || 0) > 30 * 60 * 1000) {
      activeGeminiApiSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000);
