/**
 * Local GPU Provider — Run open-source models via Ollama
 * =======================================================
 *
 * Connects to a local Ollama server to run models on the user's own GPU.
 * Uses the OpenAI-compatible chat completions API that Ollama exposes.
 * Reuses the same agentic tool loop as OpenRouter (file I/O, shell, search).
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileLocalGPUSessionIndex } from './projects.js';
import { writeProjectTemplates } from './templates/index.js';
import { classifyError } from '../shared/errorClassifier.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { createRequestId, waitForToolApproval, matchesToolPermission } from './utils/permissions.js';
import { buildMemoryBlock } from './utils/memoryPrompt.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const MAX_AGENT_TURNS = 30;
const BASH_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 100_000;
/** Match maxBuffer to capped output so large command output is not buffered in full. */
const MAX_TOOL_BUFFER_BYTES = Math.min(MAX_OUTPUT_CHARS * 4, 512 * 1024);
const GLOB_MAX_MATCHES = 200;
const SESSIONS_DIR_NAME = 'localgpu-sessions';

const activeLocalGPUSessions = new Map();

// ---------------------------------------------------------------------------
// GPU Detection
// ---------------------------------------------------------------------------

export async function detectGPUs() {
  const result = { gpus: [], system: {} };

  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
      { timeout: 10000 },
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const [index, name, memTotal, memUsed, util, temp] = line.split(',').map((s) => s.trim());
      result.gpus.push({
        id: `gpu-${index}`,
        index: parseInt(index, 10),
        name,
        memory: `${memUsed} / ${memTotal} MiB`,
        memoryTotal: parseInt(memTotal, 10),
        memoryUsed: parseInt(memUsed, 10),
        utilization: parseInt(util, 10),
        temperature: parseInt(temp, 10),
      });
    }

    try {
      const { stdout: driverOut } = await execAsync('nvidia-smi --query-gpu=driver_version --format=csv,noheader', { timeout: 5000 });
      result.system.driver = driverOut.trim().split('\n')[0];
    } catch {}

    try {
      const { stdout: cudaOut } = await execAsync('nvcc --version 2>/dev/null | grep release', { timeout: 5000 });
      const match = cudaOut.match(/release ([\d.]+)/);
      if (match) result.system.cuda = match[1];
    } catch {}
  } catch {
    // nvidia-smi not available — try macOS (Apple Silicon)
    try {
      const { stdout } = await execAsync('system_profiler SPDisplaysDataType -json', { timeout: 10000 });
      const data = JSON.parse(stdout);
      const displays = data?.SPDisplaysDataType || [];
      for (const [idx, gpu] of displays.entries()) {
        const name = gpu.sppci_model || gpu._name || 'Unknown GPU';
        const vram = gpu.sppci_vram || gpu.spdisplays_vram || 'N/A';
        result.gpus.push({
          id: `gpu-${idx}`,
          index: idx,
          name,
          memory: typeof vram === 'string' ? vram : `${vram} MB`,
        });
      }
      result.system.platform = 'apple_silicon';
    } catch {}
  }

  return result;
}

// ---------------------------------------------------------------------------
// Ollama helpers
// ---------------------------------------------------------------------------

function isLoopbackHostname(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  if (h === '127.0.0.1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  return [m[1], m[2], m[3]].every((oct) => {
    const n = parseInt(oct, 10);
    return n >= 0 && n <= 255;
  });
}

/**
 * Normalize and validate Ollama base URL. Only http(s) loopback hosts are allowed (SSRF hardening).
 */
export function normalizeLocalOllamaBaseUrl(input) {
  let raw = String(input ?? '').trim().replace(/\/+$/, '');
  if (!raw) raw = DEFAULT_OLLAMA_URL;
  if (!/^https?:\/\//i.test(raw)) {
    raw = `http://${raw}`;
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid Ollama server URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Ollama URL must use http or https');
  }
  if (u.username || u.password) {
    throw new Error('Ollama URL must not include credentials');
  }
  if (!isLoopbackHostname(u.hostname)) {
    throw new Error('Ollama URL must use localhost or 127.0.0.1 (loopback only)');
  }
  return u.origin;
}

function getOllamaUrl(options) {
  const raw = options?.serverUrl || process.env.LOCAL_GPU_SERVER_URL || DEFAULT_OLLAMA_URL;
  return normalizeLocalOllamaBaseUrl(raw);
}

export async function checkOllamaStatus(serverUrl) {
  let url;
  try {
    url = normalizeLocalOllamaBaseUrl(serverUrl || DEFAULT_OLLAMA_URL);
  } catch (e) {
    return { running: false, error: e.message };
  }
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { running: false, error: `Server returned ${res.status}` };
    const data = await res.json();
    return { running: true, models: (data.models || []).map(formatOllamaModel) };
  } catch (err) {
    return { running: false, error: err.message };
  }
}

function formatOllamaModel(m) {
  const sizeMatch = m.details?.parameter_size?.match(/([\d.]+)([BM])/i);
  let sizeB = null;
  if (sizeMatch) {
    sizeB = sizeMatch[2].toUpperCase() === 'B'
      ? parseFloat(sizeMatch[1])
      : parseFloat(sizeMatch[1]) / 1000;
  }
  return {
    name: m.name,
    displayName: m.name.split(':')[0],
    size: m.details?.parameter_size || null,
    sizeB,
    family: m.details?.family || null,
    quantization: m.details?.quantization_level || null,
    modifiedAt: m.modified_at,
  };
}

export async function pullOllamaModel(serverUrl, modelName) {
  const url = normalizeLocalOllamaBaseUrl(serverUrl || DEFAULT_OLLAMA_URL);
  const res = await fetch(`${url}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: false }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to pull model: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Tool schemas (same as OpenRouter — OpenAI function-calling format)
// ---------------------------------------------------------------------------

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read the contents of a file at the given path. Returns numbered lines.',
      parameters: {
        type: 'object',
        properties: {
          path:   { type: 'string', description: 'Absolute or project-relative file path' },
          offset: { type: 'integer', description: 'Start line (1-indexed). Omit to read from the beginning.' },
          limit:  { type: 'integer', description: 'Max lines to return. Omit to read the whole file.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description: 'Create or overwrite a file with the given contents.',
      parameters: {
        type: 'object',
        properties: {
          path:     { type: 'string', description: 'Absolute or project-relative file path' },
          contents: { type: 'string', description: 'Full file contents to write' },
        },
        required: ['path', 'contents'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Replace an exact string in a file with a new string.',
      parameters: {
        type: 'object',
        properties: {
          path:       { type: 'string' },
          old_string: { type: 'string', description: 'The exact text to find (must be unique in the file)' },
          new_string: { type: 'string', description: 'The replacement text' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Execute a shell command and return stdout + stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run' },
          cwd:     { type: 'string', description: 'Working directory (optional)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Find files matching a glob pattern. Returns matching file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern:   { type: 'string', description: 'Glob pattern, e.g. "**/*.py"' },
          directory: { type: 'string', description: 'Directory to search in (optional)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Search',
      description: 'Search file contents for a regex pattern using ripgrep.',
      parameters: {
        type: 'object',
        properties: {
          pattern:   { type: 'string', description: 'Regex pattern' },
          directory: { type: 'string', description: 'Directory to search in (optional)' },
          include:   { type: 'string', description: 'Glob to filter files, e.g. "*.ts"' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'LS',
      description: 'List files and directories in a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list' },
        },
        required: ['path'],
      },
    },
  },
];

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Search', 'LS']);

// ---------------------------------------------------------------------------
// WebSocket helper
// ---------------------------------------------------------------------------

function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[LocalGPU] Error sending message:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Tool execution (same as OpenRouter)
// ---------------------------------------------------------------------------

async function runBashToolCommand(command, execCwd) {
  if (typeof command !== 'string') {
    return 'Error: command must be a string';
  }
  if (command.includes('\0')) {
    return 'Error: command contains invalid characters';
  }
  const opts = {
    cwd: execCwd,
    timeout: BASH_TIMEOUT_MS,
    maxBuffer: MAX_TOOL_BUFFER_BYTES,
    windowsHide: true,
  };
  try {
    if (process.platform === 'win32') {
      const comspec = process.env.ComSpec || 'cmd.exe';
      const { stdout, stderr } = await execFileAsync(comspec, ['/d', '/s', '/c', command], opts);
      return (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(0, MAX_OUTPUT_CHARS);
    }
    const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', command], opts);
    return (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(0, MAX_OUTPUT_CHARS);
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

function isPathUnderSearchRoot(absPath, rootAbs) {
  const rootNorm = path.resolve(rootAbs);
  const fileNorm = path.resolve(absPath);
  const prefix = rootNorm.endsWith(path.sep) ? rootNorm : `${rootNorm}${path.sep}`;
  return fileNorm === rootNorm || fileNorm.startsWith(prefix);
}

async function runRipgrepSearch(pattern, dirAbs, includeGlob) {
  if (typeof pattern !== 'string' || pattern.includes('\0')) {
    return 'Error: invalid search pattern';
  }
  const rgArgs = [
    '--max-count', '50',
    '--line-number',
    '--color', 'never',
    '--no-heading',
  ];
  if (includeGlob && typeof includeGlob === 'string' && !includeGlob.includes('\0')) {
    rgArgs.push('--glob', includeGlob);
  }
  rgArgs.push('--', pattern, dirAbs);
  const opts = {
    cwd: dirAbs,
    timeout: 15_000,
    maxBuffer: MAX_TOOL_BUFFER_BYTES,
    windowsHide: true,
  };
  try {
    const { stdout, stderr } = await execFileAsync('rg', rgArgs, opts);
    const combined = (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
    const trimmed = combined.trim().slice(0, MAX_OUTPUT_CHARS);
    return trimmed || 'No results.';
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return 'Error: ripgrep (rg) is not installed or not in PATH. Install from https://github.com/BurntSushi/ripgrep';
    }
    // ripgrep exits 1 when there are zero matches (not an error).
    if (err?.code === 1 && typeof err.stdout === 'string') {
      const combined = (err.stdout || '') + (err.stderr ? `\n[stderr]\n${err.stderr}` : '');
      const trimmed = combined.trim().slice(0, MAX_OUTPUT_CHARS);
      return trimmed || 'No results.';
    }
    return `Error: ${err.message}`;
  }
}

async function executeTool(name, args, cwd) {
  try {
    if (name === 'Read') {
      const filePath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
      const raw = await fs.readFile(filePath, 'utf-8');
      const lines = raw.split('\n');
      const start = Math.max(0, (args.offset || 1) - 1);
      const end = args.limit ? start + args.limit : lines.length;
      return lines
        .slice(start, end)
        .map((l, i) => `${start + i + 1}|${l}`)
        .join('\n')
        .slice(0, MAX_OUTPUT_CHARS);
    }

    if (name === 'Write') {
      const filePath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, args.contents, 'utf-8');
      return `File written: ${filePath}`;
    }

    if (name === 'Edit') {
      const filePath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
      const raw = await fs.readFile(filePath, 'utf-8');
      if (!raw.includes(args.old_string)) return `Error: old_string not found in ${filePath}`;
      const count = raw.split(args.old_string).length - 1;
      if (count > 1) return `Error: old_string found ${count} times in ${filePath} — must be unique`;
      await fs.writeFile(filePath, raw.replace(args.old_string, args.new_string), 'utf-8');
      return `File edited: ${filePath}`;
    }

    if (name === 'Bash') {
      const execCwd = args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.resolve(cwd, args.cwd)) : cwd;
      return await runBashToolCommand(args.command, execCwd);
    }

    if (name === 'Glob') {
      const dir = args.directory
        ? (path.isAbsolute(args.directory) ? args.directory : path.resolve(cwd, args.directory))
        : cwd;
      const dirResolved = path.resolve(dir);
      if (typeof args.pattern !== 'string' || args.pattern.includes('\0')) {
        return 'Error: invalid glob pattern';
      }
      const matches = await glob(args.pattern, {
        cwd: dirResolved,
        nodir: true,
        absolute: true,
        followSymbolicLinks: false,
        maxDepth: 40,
      });
      const safe = [];
      for (const p of matches) {
        if (isPathUnderSearchRoot(p, dirResolved)) {
          safe.push(p);
        }
        if (safe.length >= GLOB_MAX_MATCHES) break;
      }
      return safe.join('\n') || 'No files matched.';
    }

    if (name === 'Search') {
      const dir = args.directory
        ? (path.isAbsolute(args.directory) ? args.directory : path.resolve(cwd, args.directory))
        : cwd;
      const dirResolved = path.resolve(dir);
      return await runRipgrepSearch(args.pattern, dirResolved, args.include);
    }

    if (name === 'LS') {
      const dir = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .map((e) => `${e.isDirectory() ? '[DIR] ' : ''}${e.name}`)
        .join('\n')
        .slice(0, MAX_OUTPUT_CHARS);
    }

    return `Error: Unknown tool "${name}"`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// ---------------------------------------------------------------------------
// Permission checking (reuse OpenRouter pattern)
// ---------------------------------------------------------------------------

async function checkToolPermission(
  toolName, args, permissionMode, allowedTools, disallowedTools, ws, sessionId, skipAll,
) {
  if (skipAll || permissionMode === 'bypassPermissions') return true;
  if (READ_ONLY_TOOLS.has(toolName)) return true;
  if (permissionMode === 'plan') return false;

  for (const pattern of disallowedTools) {
    if (matchesToolPermission(toolName, args, pattern)) return false;
  }
  for (const pattern of allowedTools) {
    if (matchesToolPermission(toolName, args, pattern)) return true;
  }

  if (permissionMode === 'acceptEdits' && (toolName === 'Write' || toolName === 'Edit')) return true;

  const requestId = createRequestId();
  sendMessage(ws, {
    type: 'claude-permission-request',
    requestId,
    sessionId,
    tool: toolName,
    input: args,
  });

  const decision = await waitForToolApproval(requestId, 300_000);
  return decision?.allow === true;
}

// ---------------------------------------------------------------------------
// Session persistence (JSONL)
// ---------------------------------------------------------------------------

async function sessionsDir() {
  const dir = path.join(os.homedir(), '.dr-claw', SESSIONS_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function appendSession(sessionId, entry) {
  if (!sessionId || sessionId.startsWith('new-session-') || sessionId.startsWith('temp-')) return;
  const dir = await sessionsDir();
  await fs.appendFile(
    path.join(dir, `${sessionId}.jsonl`),
    JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n',
    'utf-8',
  );
}

async function loadHistory(sessionId) {
  if (!sessionId) return [];
  try {
    const dir = await sessionsDir();
    const raw = await fs.readFile(path.join(dir, `${sessionId}.jsonl`), 'utf-8');
    const msgs = [];
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      const e = JSON.parse(line);
      if (e.role === 'user') msgs.push({ role: 'user', content: e.content });
      else if (e.role === 'assistant') {
        const msg = { role: 'assistant', content: e.content || null };
        if (e.tool_calls) msg.tool_calls = e.tool_calls;
        msgs.push(msg);
      } else if (e.role === 'tool') {
        msgs.push({ role: 'tool', tool_call_id: e.tool_call_id, content: e.content });
      }
    }
    return msgs;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Streaming API call (OpenAI-compatible — works with Ollama)
// ---------------------------------------------------------------------------

async function streamApiCall(baseUrl, model, messages, tools, signal) {
  const body = { model, messages, stream: true };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

async function consumeStream(response, { onText, onAbortCheck }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = {};
  let finishReason = null;
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (onAbortCheck?.()) { reader.cancel(); break; }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.usage) usage = parsed.usage;
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (delta?.content) {
          content += delta.content;
          onText?.(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls[idx]) toolCalls[idx] = { id: '', name: '', arguments: '' };
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].name = tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
          }
        }
      } catch { /* skip malformed chunks */ }
    }
  }

  return {
    content,
    toolCalls: Object.values(toolCalls).filter((tc) => tc.id && tc.name),
    finishReason,
    usage,
  };
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

async function buildSystemPrompt(workingDir) {
  const parts = [
    `You are a powerful agentic AI research assistant running on a local GPU. You operate in the project directory: ${workingDir}`,
    '',
    'You have access to tools for reading/writing files, running shell commands, and searching the codebase.',
    'Use tools proactively to accomplish tasks. Always read files before editing them.',
    'Be concise and focus on the task at hand.',
  ];

  try {
    const agentsPath = path.join(workingDir, 'AGENTS.md');
    const agentsMd = await fs.readFile(agentsPath, 'utf-8');
    if (agentsMd.trim()) {
      parts.push('', '## Project Instructions (AGENTS.md)', agentsMd.trim());
    }
  } catch {}

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function queryLocalGPU(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model = 'qwen3-32b',
    serverUrl,
    gpuId,
    env,
    sessionMode,
    stageTagKeys,
    stageTagSource = 'task_context',
    systemPrompt: customSystemPrompt,
    permissionMode = 'bypassPermissions',
    toolsSettings,
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  let ollamaUrl;
  try {
    ollamaUrl = getOllamaUrl(options);
  } catch (err) {
    sendMessage(ws, {
      type: 'localgpu-error',
      error: err.message,
      errorType: 'auth',
      isRetryable: false,
      sessionId,
    });
    return;
  }

  // Verify Ollama is reachable
  try {
    const check = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!check.ok) throw new Error(`Ollama returned ${check.status}`);
  } catch (err) {
    sendMessage(ws, {
      type: 'localgpu-error',
      error: `Cannot reach Ollama at ${ollamaUrl}. Make sure Ollama is running (ollama serve). Error: ${err.message}`,
      errorType: 'auth',
      isRetryable: false,
      sessionId,
    });
    return;
  }

  const currentSessionId = sessionId || `localgpu-${crypto.randomUUID()}`;
  const abortController = new AbortController();
  const allowedTools = [...(toolsSettings?.allowedTools || [])];
  const disallowedTools = [...(toolsSettings?.disallowedTools || [])];

  try {
    if (workingDirectory) {
      try {
        await ensureProjectSkillLinks(workingDirectory);
        await writeProjectTemplates(workingDirectory);
      } catch (err) {
        console.warn('[LocalGPU] Project template init warning:', err.message);
      }
    }

    if (sessionId && workingDirectory) {
      applyStageTagsToSession({ sessionId, projectPath: workingDirectory, stageTagKeys, source: stageTagSource });
    }

    activeLocalGPUSessions.set(currentSessionId, {
      status: 'running',
      abortController,
      startTime: Date.now(),
    });

    const userText = (command || '').replace(/\s*\[Context:[^\]]*\]\s*/gi, '').trim();
    const sessionDisplayName = userText.slice(0, 100) || null;

    if (workingDirectory) {
      recordIndexedSession({
        sessionId: currentSessionId,
        provider: 'local',
        projectPath: workingDirectory,
        sessionMode: sessionMode || 'research',
        displayName: sessionDisplayName,
        stageTagKeys,
        tagSource: stageTagSource,
      });
    }

    sendMessage(ws, {
      type: 'session-created',
      sessionId: currentSessionId,
      provider: 'local',
      mode: sessionMode || 'research',
      startTime: activeLocalGPUSessions.get(currentSessionId).startTime,
      displayName: sessionDisplayName || 'Local GPU Session',
      projectName: workingDirectory ? encodeProjectPath(workingDirectory) : undefined,
    });

    const memoryBlock = options.userId ? buildMemoryBlock(options.userId) : '';
    const systemContent = (customSystemPrompt || await buildSystemPrompt(workingDirectory)) + memoryBlock;
    const messages = [{ role: 'system', content: systemContent }];

    if (sessionId) {
      const history = await loadHistory(sessionId);
      if (history.length) {
        console.log(`[LocalGPU] Resumed session ${sessionId} with ${history.length} history messages`);
        messages.push(...history);
      }
    }

    messages.push({ role: 'user', content: command });
    await appendSession(currentSessionId, { role: 'user', content: command }).catch(() => {});

    const tools = permissionMode === 'plan'
      ? TOOL_SCHEMAS.filter((t) => READ_ONLY_TOOLS.has(t.function.name))
      : TOOL_SCHEMAS;

    // Agent loop
    let turn = 0;
    let noToolFallback = false;
    let cumulativeTokens = 0;
    const contextWindow = 32000;

    while (turn < MAX_AGENT_TURNS) {
      turn++;
      const session = activeLocalGPUSessions.get(currentSessionId);
      if (!session || session.status === 'aborted') break;

      console.log(`[LocalGPU] Turn ${turn}/${MAX_AGENT_TURNS} · model=${model} · msgs=${messages.length} · server=${ollamaUrl}`);

      const response = await streamApiCall(
        ollamaUrl, model, messages,
        noToolFallback ? [] : tools,
        abortController.signal,
      );

      if (!response.ok) {
        const body = await response.text();
        let msg = `Local GPU API error (${response.status})`;
        try { msg = JSON.parse(body).error?.message || JSON.parse(body).error || msg; } catch {}

        if (!noToolFallback && response.status === 400 && /tool|function/i.test(msg)) {
          console.log('[LocalGPU] Model may not support tools — retrying without tools');
          noToolFallback = true;
          continue;
        }

        console.error(`[LocalGPU] API error: ${msg}`);
        sendMessage(ws, {
          type: 'localgpu-error',
          error: msg,
          errorType: 'api',
          isRetryable: response.status >= 500,
          sessionId: currentSessionId,
        });
        return;
      }

      const result = await consumeStream(response, {
        onText(delta) {
          sendMessage(ws, {
            type: 'localgpu-response',
            sessionId: currentSessionId,
            data: {
              type: 'assistant_message',
              message: { role: 'assistant', content: delta },
              startTime: activeLocalGPUSessions.get(currentSessionId)?.startTime,
            },
          });
        },
        onAbortCheck() {
          const s = activeLocalGPUSessions.get(currentSessionId);
          return !s || s.status === 'aborted';
        },
      });

      if (result.usage) {
        cumulativeTokens = (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0);
      } else {
        cumulativeTokens += (result.content?.length || 0) / 4;
        for (const tc of result.toolCalls) {
          cumulativeTokens += (tc.arguments?.length || 0) / 4;
        }
      }
      sendMessage(ws, {
        type: 'token-budget',
        data: { used: Math.round(cumulativeTokens), total: contextWindow },
        sessionId: currentSessionId,
      });

      if (result.toolCalls.length === 0) {
        if (result.content) {
          await appendSession(currentSessionId, { role: 'assistant', content: result.content }).catch(() => {});
        }
        break;
      }

      console.log(`[LocalGPU] ${result.toolCalls.length} tool call(s) in turn ${turn}`);

      const assistantMsg = {
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      messages.push(assistantMsg);
      await appendSession(currentSessionId, assistantMsg).catch(() => {});

      const structuredToolUseContent = result.toolCalls.map((tc) => {
        let input;
        try { input = JSON.parse(tc.arguments); } catch { input = {}; }
        return { type: 'tool_use', id: tc.id, name: tc.name, input };
      });
      sendMessage(ws, {
        type: 'localgpu-response',
        sessionId: currentSessionId,
        data: {
          type: 'structured_turn',
          message: { role: 'assistant', content: structuredToolUseContent },
        },
      });

      for (const tc of result.toolCalls) {
        let args;
        try { args = JSON.parse(tc.arguments); } catch { args = {}; }

        console.log(`[LocalGPU]   → ${tc.name}(${JSON.stringify(args).slice(0, 120)})`);

        const allowed = await checkToolPermission(
          tc.name, args, permissionMode, allowedTools, disallowedTools, ws, currentSessionId,
          toolsSettings?.skipPermissions === true,
        );

        const output = allowed
          ? await executeTool(tc.name, args, workingDirectory)
          : `Permission denied for tool: ${tc.name}`;

        sendMessage(ws, {
          type: 'localgpu-response',
          sessionId: currentSessionId,
          data: {
            type: 'structured_result',
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: tc.id,
                content: output.slice(0, 2000),
                is_error: output.startsWith('Error'),
              }],
            },
          },
        });

        const toolMsg = { role: 'tool', tool_call_id: tc.id, content: output };
        messages.push(toolMsg);
        await appendSession(currentSessionId, toolMsg).catch(() => {});
      }
    }

    if (turn >= MAX_AGENT_TURNS) {
      console.warn(`[LocalGPU] Reached max agent turns (${MAX_AGENT_TURNS})`);
    }

    sendMessage(ws, { type: 'localgpu-complete', sessionId: currentSessionId, exitCode: 0 });
  } catch (error) {
    console.error('[LocalGPU] Error:', error.name, error.message);
    if (error.name === 'AbortError') {
      sendMessage(ws, { type: 'localgpu-complete', sessionId: currentSessionId, exitCode: 1, aborted: true });
    } else {
      const { errorType, isRetryable } = classifyError(error.message);
      sendMessage(ws, {
        type: 'localgpu-error',
        error: error.message,
        errorType,
        isRetryable,
        sessionId: currentSessionId,
      });
    }
  } finally {
    const session = activeLocalGPUSessions.get(currentSessionId);
    if (session) session.status = 'completed';

    if (workingDirectory) {
      try {
        await reconcileLocalGPUSessionIndex(workingDirectory, {
          sessionId: currentSessionId,
          projectName: encodeProjectPath(workingDirectory),
        });
      } catch (err) {
        console.warn('[LocalGPU] Failed to reconcile session index:', err.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session management exports
// ---------------------------------------------------------------------------

export function abortLocalGPUSession(sessionId) {
  const session = activeLocalGPUSessions.get(sessionId);
  if (!session) return false;
  session.status = 'aborted';
  session.abortController?.abort();
  activeLocalGPUSessions.delete(sessionId);
  return true;
}

export function isLocalGPUSessionActive(sessionId) {
  return activeLocalGPUSessions.get(sessionId)?.status === 'running';
}

export function getLocalGPUSessionStartTime(sessionId) {
  return activeLocalGPUSessions.get(sessionId)?.startTime || null;
}

export function getActiveLocalGPUSessions() {
  return Array.from(activeLocalGPUSessions.entries())
    .filter(([, s]) => s.status === 'running')
    .map(([id, s]) => ({ sessionId: id, startTime: s.startTime }));
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeLocalGPUSessions.entries()) {
    if (session.status !== 'running' && now - (session.startTime || 0) > 30 * 60 * 1000) {
      activeLocalGPUSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);
