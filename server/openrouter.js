/**
 * OpenRouter Integration — Full Agentic Provider
 * ================================================
 *
 * Routes prompts to any model on OpenRouter with the same agentic capabilities
 * as Claude, Gemini, and Codex: tool use (file I/O, shell, search), pipeline
 * initialization, conversation persistence, and auto-research support.
 *
 * Uses the OpenAI-compatible chat completions API with function calling.
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileOpenRouterSessionIndex } from './projects.js';
import { writeProjectTemplates } from './templates/index.js';
import { classifyError } from '../shared/errorClassifier.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { createRequestId, waitForToolApproval, matchesToolPermission } from './utils/permissions.js';

const execAsync = promisify(exec);

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_AGENT_TURNS = 30;
const BASH_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 100_000;
const SESSIONS_DIR_NAME = 'openrouter-sessions';

const activeOpenRouterSessions = new Map();

// ---------------------------------------------------------------------------
// Tool schemas (OpenAI function-calling format)
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
      description: 'Create or overwrite a file with the given content.',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Replace an exact substring in a file. old_str must appear exactly once.',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'File path' },
          old_str: { type: 'string', description: 'Exact text to find (including whitespace)' },
          new_str: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Execute a shell command. Use for git, npm, python, curl, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Find files matching a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.py" or "src/**/*.ts"' },
          path:    { type: 'string', description: 'Directory to search (default: project root)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description: 'Search file contents for a regex pattern. Returns matching lines.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          path:    { type: 'string', description: 'File or directory to search (default: project root)' },
          include: { type: 'string', description: 'File glob filter, e.g. "*.py"' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'LS',
      description: 'List directory contents with file types.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (default: project root)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebFetch',
      description: 'Fetch the text content of a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebSearch',
      description: 'Search the web using a query. Returns summarized results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TodoWrite',
      description: 'Create or update a structured task list for tracking progress.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id:      { type: 'string' },
                content: { type: 'string' },
                status:  { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['id', 'content', 'status'],
            },
            description: 'Array of TODO items',
          },
        },
        required: ['todos'],
      },
    },
  },
];

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite']);

// ---------------------------------------------------------------------------
// WebSocket helper — matches Codex pattern (no double-serialization)
// ---------------------------------------------------------------------------

function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[OpenRouter] Error sending message:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(name, args, workingDir) {
  const resolve = (p) => {
    if (!p) return workingDir;
    return path.isAbsolute(p) ? p : path.resolve(workingDir, p);
  };
  const trunc = (s) =>
    s.length <= MAX_OUTPUT_CHARS ? s : s.slice(0, MAX_OUTPUT_CHARS) + `\n…(truncated, ${s.length} total chars)`;

  try {
    switch (name) {
      case 'Read': {
        const content = await fs.readFile(resolve(args.path), 'utf-8');
        const lines = content.split('\n');
        const start = Math.max(0, (args.offset || 1) - 1);
        const end = args.limit ? start + args.limit : lines.length;
        return trunc(
          lines.slice(start, end).map((l, i) => `${String(start + i + 1).padStart(6)}|${l}`).join('\n'),
        );
      }

      case 'Write': {
        const fp = resolve(args.path);
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, args.content, 'utf-8');
        return `Wrote ${args.content.length} chars → ${args.path}`;
      }

      case 'Edit': {
        const fp = resolve(args.path);
        const src = await fs.readFile(fp, 'utf-8');
        const count = src.split(args.old_str).length - 1;
        if (count === 0) return `Error: old_str not found in ${args.path}`;
        if (count > 1) return `Error: old_str matches ${count} times — add more context to make it unique`;
        await fs.writeFile(fp, src.replace(args.old_str, args.new_str), 'utf-8');
        return `Edited ${args.path}`;
      }

      case 'Bash': {
        try {
          const { stdout, stderr } = await execAsync(args.command, {
            cwd: workingDir,
            timeout: BASH_TIMEOUT_MS,
            maxBuffer: 5 * 1024 * 1024,
            env: { ...process.env, HOME: os.homedir() },
          });
          let out = stdout || '';
          if (stderr) out += (out ? '\n' : '') + `STDERR:\n${stderr}`;
          return trunc(out || '(no output)');
        } catch (err) {
          return trunc(
            `Exit code ${err.code ?? 1}\n${err.stdout || ''}${err.stderr ? '\nSTDERR:\n' + err.stderr : ''}\n${err.message}`,
          );
        }
      }

      case 'Glob': {
        const dir = resolve(args.path);
        try {
          const { stdout } = await spawnAsync('rg', ['--files', '--glob', args.pattern], {
            cwd: dir, timeout: 30_000,
          });
          const lines = stdout.split('\n').filter(Boolean).slice(0, 300);
          return trunc(lines.join('\n') || '(no matches)');
        } catch {
          try {
            const { stdout } = await spawnAsync('find', ['.', '-name', args.pattern, '-type', 'f'], {
              cwd: dir, timeout: 30_000,
            });
            const lines = stdout.split('\n').filter(Boolean).slice(0, 300);
            return trunc(lines.join('\n') || '(no matches)');
          } catch {
            return '(no matches)';
          }
        }
      }

      case 'Grep': {
        const target = resolve(args.path);
        const rgArgs = ['--line-number', '--max-count', '100', '--max-columns', '200'];
        if (args.include) rgArgs.push('--glob', args.include);
        rgArgs.push(args.pattern, target);
        try {
          const { stdout } = await spawnAsync('rg', rgArgs, {
            cwd: workingDir, timeout: 30_000,
          });
          return trunc(stdout || '(no matches)');
        } catch (err) {
          if (err.code === 1) return '(no matches)';
          return `Error: ${err.message}`;
        }
      }

      case 'LS': {
        const entries = await fs.readdir(resolve(args.path), { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n') || '(empty)';
      }

      case 'WebFetch': {
        const resp = await fetch(args.url, {
          headers: { 'User-Agent': 'Dr. Claw Research Agent' },
          signal: AbortSignal.timeout(30_000),
        });
        return trunc(await resp.text());
      }

      case 'WebSearch': {
        const encoded = encodeURIComponent(args.query);
        try {
          const resp = await fetch(
            `https://html.duckduckgo.com/html/?q=${encoded}`,
            { headers: { 'User-Agent': 'Dr. Claw Research Agent' }, signal: AbortSignal.timeout(15_000) },
          );
          const html = await resp.text();
          const results = [];
          const regex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
          let m;
          while ((m = regex.exec(html)) !== null && results.length < 8) {
            results.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() });
          }
          const snippetRe = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
          let idx = 0;
          while ((m = snippetRe.exec(html)) !== null && idx < results.length) {
            results[idx].snippet = m[1].replace(/<[^>]+>/g, '').trim();
            idx++;
          }
          return results.length
            ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ''}`).join('\n\n')
            : '(no results found)';
        } catch (err) {
          return `Search error: ${err.message}`;
        }
      }

      case 'TodoWrite': {
        return `TODO list updated:\n${(args.todos || []).map((t) => `- [${t.status}] ${t.content}`).join('\n')}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error executing ${name}: ${error.message}`;
  }
}

// ---------------------------------------------------------------------------
// Tool permission checking (mirrors Gemini/Claude pattern)
// ---------------------------------------------------------------------------

async function checkToolPermission(toolName, toolArgs, permissionMode, allowedTools, disallowedTools, ws, sessionId, skipPermissions = false) {
  if (permissionMode === 'bypassPermissions' || skipPermissions) return true;

  if (disallowedTools.some((e) => matchesToolPermission(e, toolName, toolArgs))) return false;

  if (permissionMode === 'plan') return READ_ONLY_TOOLS.has(toolName);

  if (permissionMode === 'acceptEdits' && ['Write', 'Edit'].includes(toolName)) return true;

  if (allowedTools.some((e) => matchesToolPermission(e, toolName, toolArgs))) return true;

  if (READ_ONLY_TOOLS.has(toolName)) return true;

  const requestId = createRequestId();
  sendMessage(ws, {
    type: 'claude-permission-request',
    requestId,
    toolName,
    input: toolArgs,
    sessionId,
  });

  const decision = await waitForToolApproval(requestId);
  if (!decision || decision.cancelled || !decision.allow) return false;
  if (decision.rememberEntry) allowedTools.push(decision.rememberEntry);
  return true;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

async function buildSystemPrompt(workingDir) {
  const parts = [
    `You are a powerful agentic AI research assistant. You operate in the project directory: ${workingDir}`,
    '',
    'You have tools to read/write files, run shell commands, search code, and browse the web.',
    'Use them proactively to explore the project, gather information, and produce high-quality output.',
    'Always prefer using tools over guessing about file contents or project structure.',
    '',
  ];

  try {
    const agentsMd = await fs.readFile(path.join(workingDir, 'AGENTS.md'), 'utf-8');
    if (agentsMd.trim()) parts.push('# Project Instructions (AGENTS.md)\n', agentsMd, '');
  } catch {}

  try {
    const raw = await fs.readFile(path.join(workingDir, 'instance.json'), 'utf-8');
    const inst = JSON.parse(raw);
    if (inst.research_topic || inst.stages) {
      parts.push('# Project Metadata (instance.json)\n', JSON.stringify(inst, null, 2), '');
    }
  } catch {}

  try {
    const skillsDir = path.join(workingDir, '.agents', 'skills');
    const entries = await fs.readdir(skillsDir).catch(() => []);
    if (entries.length > 0) {
      parts.push(`# Available Skills (${entries.length})\n`);
      for (const entry of entries.slice(0, 10)) {
        try {
          const md = await fs.readFile(path.join(skillsDir, entry, 'SKILL.md'), 'utf-8');
          if (md.trim()) parts.push(`## Skill: ${entry}\n${md.slice(0, 3000)}\n`);
        } catch {
          parts.push(`- ${entry}`);
        }
      }
      parts.push('');
    }
  } catch {}

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Session persistence (JSONL — mirrors Gemini pattern)
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
// Streaming API call + response parser
// ---------------------------------------------------------------------------

async function streamApiCall(apiKey, model, messages, tools, signal) {
  const body = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  return fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/OpenLAIR/dr-claw',
      'X-Title': 'Dr. Claw',
    },
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
// Main entry point
// ---------------------------------------------------------------------------

export async function queryOpenRouter(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model = 'anthropic/claude-sonnet-4',
    env,
    sessionMode,
    stageTagKeys,
    stageTagSource = 'task_context',
    systemPrompt: customSystemPrompt,
    permissionMode = 'bypassPermissions',
    toolsSettings,
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const apiKey = env?.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    sendMessage(ws, {
      type: 'openrouter-error',
      error: 'OPENROUTER_API_KEY is not set. Add it to your .env file or configure it in Settings.',
      errorType: 'auth',
      isRetryable: false,
      sessionId,
    });
    return;
  }

  const currentSessionId = sessionId || `openrouter-${crypto.randomUUID()}`;
  const abortController = new AbortController();
  const allowedTools = [...(toolsSettings?.allowedTools || [])];
  const disallowedTools = [...(toolsSettings?.disallowedTools || [])];

  try {
    // ── Pipeline initialization (same as Claude / Gemini) ──────────────
    if (workingDirectory) {
      try {
        await ensureProjectSkillLinks(workingDirectory);
        await writeProjectTemplates(workingDirectory);
      } catch (err) {
        console.warn('[OpenRouter] Project template init warning:', err.message);
      }
    }

    // ── Session tracking ───────────────────────────────────────────────
    if (sessionId && workingDirectory) {
      applyStageTagsToSession({ sessionId, projectPath: workingDirectory, stageTagKeys, source: stageTagSource });
    }

    activeOpenRouterSessions.set(currentSessionId, {
      status: 'running',
      abortController,
      startTime: Date.now(),
    });

    // Strip [Context: ...] prefixes to extract the user's actual text for the display name
    const userText = (command || '').replace(/\s*\[Context:[^\]]*\]\s*/gi, '').trim();
    const sessionDisplayName = userText.slice(0, 100) || null;

    if (workingDirectory) {
      recordIndexedSession({
        sessionId: currentSessionId,
        provider: 'openrouter',
        projectPath: workingDirectory,
        sessionMode: sessionMode || 'research',
        displayName: sessionDisplayName,
        stageTagKeys,
        tagSource: stageTagSource,
      });
    }

    // ── Notify frontend ────────────────────────────────────────────────
    sendMessage(ws, {
      type: 'session-created',
      sessionId: currentSessionId,
      provider: 'openrouter',
      mode: sessionMode || 'research',
      startTime: activeOpenRouterSessions.get(currentSessionId).startTime,
      displayName: sessionDisplayName || 'OpenRouter Session',
      projectName: workingDirectory ? encodeProjectPath(workingDirectory) : undefined,
    });

    // ── Build conversation ─────────────────────────────────────────────
    const systemContent = customSystemPrompt || await buildSystemPrompt(workingDirectory);
    const messages = [{ role: 'system', content: systemContent }];

    if (sessionId) {
      const history = await loadHistory(sessionId);
      if (history.length) {
        console.log(`[OpenRouter] Resumed session ${sessionId} with ${history.length} history messages`);
        messages.push(...history);
      }
    }

    messages.push({ role: 'user', content: command });
    await appendSession(currentSessionId, { role: 'user', content: command }).catch(() => {});

    const tools = permissionMode === 'plan'
      ? TOOL_SCHEMAS.filter((t) => READ_ONLY_TOOLS.has(t.function.name))
      : TOOL_SCHEMAS;

    // ── Agent loop ─────────────────────────────────────────────────────
    let turn = 0;
    let noToolFallback = false;
    let cumulativeTokens = 0;
    const contextWindow = 200000;

    while (turn < MAX_AGENT_TURNS) {
      turn++;
      const session = activeOpenRouterSessions.get(currentSessionId);
      if (!session || session.status === 'aborted') break;

      console.log(`[OpenRouter] Turn ${turn}/${MAX_AGENT_TURNS} · model=${model} · msgs=${messages.length}`);

      const response = await streamApiCall(
        apiKey, model, messages,
        noToolFallback ? [] : tools,
        abortController.signal,
      );

      if (!response.ok) {
        const body = await response.text();
        let msg = `OpenRouter API error (${response.status})`;
        try { msg = JSON.parse(body).error?.message || msg; } catch {}

        if (!noToolFallback && response.status === 400 && /tool|function/i.test(msg)) {
          console.log('[OpenRouter] Model may not support tools — retrying without tools');
          noToolFallback = true;
          continue;
        }

        console.error(`[OpenRouter] API error: ${msg}`);
        sendMessage(ws, {
          type: 'openrouter-error',
          error: msg,
          errorType: response.status === 401 ? 'auth' : 'api',
          isRetryable: response.status >= 500,
          sessionId: currentSessionId,
        });
        return;
      }

      const result = await consumeStream(response, {
        onText(delta) {
          sendMessage(ws, {
            type: 'openrouter-response',
            sessionId: currentSessionId,
            data: {
              type: 'assistant_message',
              message: { role: 'assistant', content: delta },
              startTime: activeOpenRouterSessions.get(currentSessionId)?.startTime,
            },
          });
        },
        onAbortCheck() {
          const s = activeOpenRouterSessions.get(currentSessionId);
          return !s || s.status === 'aborted';
        },
      });

      // ── Update token budget ───────────────────────────────────────────
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

      // ── No tool calls → final answer, done ─────────────────────────
      if (result.toolCalls.length === 0) {
        if (result.content) {
          await appendSession(currentSessionId, { role: 'assistant', content: result.content }).catch(() => {});
        }
        break;
      }

      // ── Tool calls → execute, add results, continue loop ───────────
      console.log(`[OpenRouter] ${result.toolCalls.length} tool call(s) in turn ${turn}`);

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

      // Send ALL tool calls in a single structured message (Claude-compatible format)
      // so the frontend can render them using the same proven code path as Claude.
      const structuredToolUseContent = result.toolCalls.map((tc) => {
        let input;
        try { input = JSON.parse(tc.arguments); } catch { input = {}; }
        return { type: 'tool_use', id: tc.id, name: tc.name, input };
      });
      sendMessage(ws, {
        type: 'openrouter-response',
        sessionId: currentSessionId,
        data: {
          type: 'structured_turn',
          message: { role: 'assistant', content: structuredToolUseContent },
        },
      });

      // Execute each tool and send results as structured tool_result messages
      for (const tc of result.toolCalls) {
        let args;
        try { args = JSON.parse(tc.arguments); } catch { args = {}; }

        console.log(`[OpenRouter]   → ${tc.name}(${JSON.stringify(args).slice(0, 120)})`);

        const allowed = await checkToolPermission(
          tc.name, args, permissionMode, allowedTools, disallowedTools, ws, currentSessionId,
          toolsSettings?.skipPermissions === true,
        );

        const output = allowed
          ? await executeTool(tc.name, args, workingDirectory)
          : `Permission denied for tool: ${tc.name}`;

        sendMessage(ws, {
          type: 'openrouter-response',
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
      console.warn(`[OpenRouter] Reached max agent turns (${MAX_AGENT_TURNS})`);
    }

    if (workingDirectory) {
      try {
        await reconcileOpenRouterSessionIndex(workingDirectory, {
          sessionId: currentSessionId,
          projectName: encodeProjectPath(workingDirectory),
        });
      } catch (err) {
        console.warn('[OpenRouter] Session reconciliation warning:', err.message);
      }
    }

    sendMessage(ws, { type: 'openrouter-complete', sessionId: currentSessionId, exitCode: 0 });
  } catch (error) {
    console.error('[OpenRouter] Error:', error.name, error.message);
    if (error.name === 'AbortError') {
      sendMessage(ws, { type: 'openrouter-complete', sessionId: currentSessionId, exitCode: 1, aborted: true });
    } else {
      const { errorType, isRetryable } = classifyError(error.message);
      sendMessage(ws, {
        type: 'openrouter-error',
        error: error.message,
        errorType,
        isRetryable,
        sessionId: currentSessionId,
      });
    }
  } finally {
    const session = activeOpenRouterSessions.get(currentSessionId);
    if (session) session.status = 'completed';
  }
}

// ---------------------------------------------------------------------------
// Session management exports
// ---------------------------------------------------------------------------

export function abortOpenRouterSession(sessionId) {
  const session = activeOpenRouterSessions.get(sessionId);
  if (!session) return false;
  session.status = 'aborted';
  session.abortController?.abort();
  activeOpenRouterSessions.delete(sessionId);
  return true;
}

export function isOpenRouterSessionActive(sessionId) {
  return activeOpenRouterSessions.get(sessionId)?.status === 'running';
}

export function getOpenRouterSessionStartTime(sessionId) {
  return activeOpenRouterSessions.get(sessionId)?.startTime || null;
}

export function getActiveOpenRouterSessions() {
  return Array.from(activeOpenRouterSessions.entries())
    .filter(([, s]) => s.status === 'running')
    .map(([id, s]) => ({ sessionId: id, startTime: s.startTime }));
}

// Periodic cleanup (mirrors Codex pattern)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeOpenRouterSessions.entries()) {
    if (session.status !== 'running' && now - (session.startTime || 0) > 30 * 60 * 1000) {
      activeOpenRouterSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);
