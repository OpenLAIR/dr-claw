import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createRequestId, waitForToolApproval, matchesToolPermission } from './utils/permissions.js';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileGeminiSessionIndex } from './projects.js';
import { writeProjectTemplates } from './templates/index.js';
import { stripInternalContextPrefix } from './utils/sessionFormatting.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { splitLegacyGeminiThoughtContent } from '../shared/geminiThoughtParser.js';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeGeminiSessions = new Map(); // Track active sessions: { process, heartbeat, sessionId, options, sessionAllowedTools, sessionDisallowedTools }
const GEMINI_DEFAULT_CONTEXT_WINDOW = parseInt(process.env.GEMINI_CONTEXT_WINDOW || process.env.CONTEXT_WINDOW || '2000000', 10);

const GEMINI_TOOL_NAME_MAP = {
  // Official Gemini CLI tool names
  run_shell_command: 'Bash',
  glob: 'Glob',
  grep_search: 'Grep',
  list_directory: 'LS',
  read_file: 'Read',
  read_many_files: 'Read',
  replace: 'Edit',
  write_file: 'Write',
  ask_user: 'AskUserQuestion',
  write_todos: 'TodoWrite',
  enter_plan_mode: 'enter_plan_mode',
  exit_plan_mode: 'exit_plan_mode',
  google_web_search: 'WebSearch',
  web_fetch: 'WebFetch',

  // Backward-compatible aliases seen in older wrappers
  insert_content: 'Edit',
  todo_read: 'TodoRead',
  todo_write: 'TodoWrite',
  task_get: 'TaskGet',
  task_list: 'TaskList',
  task_create: 'TaskCreate',
  task_update: 'TaskUpdate',
  ask_user_question: 'AskUserQuestion'
};

const GEMINI_PLAN_MODE_TOOLS = [
  'read_file',
  'read_many_files',
  'list_directory',
  'glob',
  'grep_search',
  'write_todos',
  'ask_user',
  'enter_plan_mode',
  'exit_plan_mode',
  'google_web_search',
  'web_fetch',
  'activate_skill',
  'save_memory',
  'get_internal_docs'
];

const GEMINI_INTERACTIVE_TOOLS = new Set(['ask_user', 'ask_user_question', 'AskUserQuestion']);
const GEMINI_PLAN_BLOCKED_TOOLS = new Set([
  'run_shell_command',
  'write_file',
  'replace',
  'insert_content',
  'undo',
  'complete_task',
  'Bash',
  'Write',
  'Edit'
]);

async function persistGeminiSessionMetadata(sessionId, projectPath, sessionMode) {
  if (!sessionId || !projectPath) return;

  try {
    const { sessionDb } = await import('./database/db.js');
    sessionDb.upsertSession(
      sessionId,
      encodeProjectPath(projectPath),
      'gemini',
      'Untitled Session',
      new Date().toISOString(),
      0,
      { sessionMode: sessionMode || 'research' },
    );
  } catch (error) {
    console.warn('[Gemini] Failed to persist session metadata:', error.message);
  }
}

function normalizeGeminiToolName(name) {
  if (!name || typeof name !== 'string') return name;
  const normalized = name.trim();
  return GEMINI_TOOL_NAME_MAP[normalized] || normalized;
}

function ensurePlanModeAllowedTools(allowedTools = []) {
  const merged = new Set(allowedTools);
  for (const tool of GEMINI_PLAN_MODE_TOOLS) {
    merged.add(tool);
    const alias = GEMINI_TOOL_NAME_MAP[tool];
    if (alias) merged.add(alias);
  }
  return Array.from(merged);
}

function isLikelyMultiStepRequest(command) {
  const text = String(command || '').trim();
  if (!text) return false;

  const numberedSteps = (text.match(/^\s*\d+\.\s+/gm) || []).length;
  const bulletSteps = (text.match(/^\s*[-*]\s+/gm) || []).length;
  const explicitMultiStep = /\b(multi[- ]step|step by step|several tasks|task list|pipeline)\b/i.test(text);
  const transitionWords = (text.match(/\b(first|then|next|after that|finally)\b/gi) || []).length;

  return numberedSteps >= 2 || bulletSteps >= 2 || explicitMultiStep || transitionWords >= 2;
}

function isAllowedBeforeTodos(rawToolName) {
  const normalized = String(rawToolName || '').trim().toLowerCase();
  return [
    'write_todos',
    'todo_write',
    'activate_skill',
    'enter_plan_mode'
  ].includes(normalized);
}

function sanitizePersistedGeminiContent(content) {
  if (typeof content === 'string') {
    return stripInternalContextPrefix(content, false);
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part && typeof part === 'object' && typeof part.text === 'string') {
        return { ...part, text: stripInternalContextPrefix(part.text, false) };
      }
      return part;
    });
  }

  return content;
}

// Exported for testing only
export function normalizePersistedGeminiAssistantEntries(content) {
  const normalizedContent = typeof content === 'string'
    ? stripInternalContextPrefix(content, false)
    : content;
  const legacySegments = splitLegacyGeminiThoughtContent(normalizedContent);

  if (!legacySegments) {
    return [{
      role: 'assistant',
      content: normalizedContent,
      type: 'message'
    }];
  }

  return legacySegments.map((segment) => segment.isThinking
    ? { role: 'assistant', type: 'thinking', content: segment.content }
    : { role: 'assistant', content: segment.content, type: 'message' }
  );
}

function summarizeGeminiErrorOutput(rawErrorOutput, fallbackModel) {
  const text = String(rawErrorOutput || '').trim();
  if (!text) {
    return { summary: 'Gemini request failed.', details: '' };
  }

  const isCapacity429 =
    /status\s+429|Too Many Requests|RESOURCE_EXHAUSTED|MODEL_CAPACITY_EXHAUSTED|No capacity available/i.test(text);
  if (isCapacity429) {
    const modelMatch =
      text.match(/No capacity available for model ([a-zA-Z0-9._-]+)/i) ||
      text.match(/"model"\s*:\s*"([^"]+)"/i) ||
      text.match(/GeminiCLI\/[^\s/]+\/([a-zA-Z0-9._-]+)/i);
    const modelName = modelMatch?.[1] || fallbackModel || 'current model';
    return {
      summary: `Model capacity exhausted for ${modelName} (HTTP 429). Please retry in a moment or switch to a Flash/Lite model.`,
      details: text.slice(0, 12000)
    };
  }

  const concise = text.split('\n').map((line) => line.trim()).find(Boolean) || 'Gemini request failed.';
  return {
    summary: concise.slice(0, 400),
    details: text.slice(0, 12000)
  };
}

function inferProjectName(workingDir, projectPath) {
  const candidate = projectPath || workingDir;
  if (!candidate || typeof candidate !== 'string') return null;
  return path.basename(candidate.replace(/[\\/]+$/, '')) || null;
}

function shouldNotifyTaskMasterRefresh(toolName, toolInput, toolResultOutput) {
  const normalizedName = String(toolName || '').toLowerCase();
  if (
    normalizedName.startsWith('task_') ||
    normalizedName === 'todo_write' ||
    normalizedName === 'todo_read' ||
    normalizedName === 'write_todos'
  ) {
    return true;
  }

  const serializedInput = JSON.stringify(toolInput || {});
  if (normalizedName === 'write_file' || normalizedName === 'replace' || normalizedName === 'insert_content') {
    if (serializedInput.includes('.pipeline/tasks/tasks.json')) return true;
  }

  if (normalizedName === 'run_shell_command') {
    const commandText = String(toolInput?.command || toolInput?.cmd || '');
    if (/taskmaster|task-master|\.pipeline\/tasks\/tasks\.json/i.test(commandText)) return true;
    const outputText = typeof toolResultOutput === 'string' ? toolResultOutput : '';
    if (/taskmaster|task-master|tasks\.json/i.test(outputText)) return true;
  }

  return false;
}

function shouldNotifyProjectRefresh(toolName, toolInput, toolResultOutput) {
  const normalizedName = String(toolName || '').toLowerCase();
  const serializedInput = JSON.stringify(toolInput || {});
  const outputText = typeof toolResultOutput === 'string' ? toolResultOutput : '';

  if (normalizedName === 'write_file' || normalizedName === 'replace' || normalizedName === 'insert_content') {
    if (
      serializedInput.includes('.pipeline/docs/research_brief.json') ||
      serializedInput.includes('instance.json') ||
      serializedInput.includes('.pipeline/config.json')
    ) {
      return true;
    }
  }

  if (normalizedName === 'run_shell_command') {
    const commandText = String(toolInput?.command || toolInput?.cmd || '');
    if (/research_brief\.json|instance\.json|\.pipeline\/config\.json/i.test(commandText)) return true;
    if (/research_brief\.json|instance\.json|\.pipeline\/config\.json/i.test(outputText)) return true;
  }

  return false;
}

function resolveCanonicalProjectFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return filePath;
  const trimmed = filePath.trim();
  if (!trimmed) return trimmed;

  // Keep explicit absolute or already-nested paths unchanged.
  if (path.isAbsolute(trimmed) || trimmed.includes('/')) return trimmed;

  const canonicalCandidates = {
    'research_brief.json': ['.pipeline/docs/research_brief.json'],
    'tasks.json': ['.pipeline/tasks/tasks.json'],
    'pipeline_config.json': ['.pipeline/config.json']
  };

  const candidates = canonicalCandidates[trimmed];
  if (!candidates || candidates.length === 0) return trimmed;

  // Prefer canonical pipeline location even when the file is not present yet.
  // This prevents accidental writes to guessed root-level filenames.
  return candidates[0];
}

function normalizeGeminiToolInput(rawToolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return toolInput;
  const normalizedToolName = String(rawToolName || '').toLowerCase();
  const next = { ...toolInput };

  if (next.file_path && typeof next.file_path === 'string') {
    if (
      normalizedToolName === 'read_file' ||
      normalizedToolName === 'write_file' ||
      normalizedToolName === 'replace'
    ) {
      next.file_path = resolveCanonicalProjectFilePath(next.file_path);
    }
  }

  return next;
}

function parseTodosFromMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];
  const lines = markdown.split('\n');
  const todos = [];
  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[( |x|X|~|>|-)\]\s+(.+?)\s*$/);
    if (!m) continue;
    const marker = m[1];
    const description = m[2].replace(/<!--.*?-->/g, '').trim();
    if (!description) continue;
    let status = 'pending';
    if (marker.toLowerCase() === 'x') status = 'completed';
    else if (marker === '>' || marker === '~') status = 'in_progress';
    else if (marker === '-') status = 'cancelled';
    todos.push({ description, status });
  }
  return todos;
}

function extractTodosFromShellCommand(command) {
  if (!command || typeof command !== 'string') return [];
  if (!/todos\.md/.test(command)) return [];
  const heredocMatch = command.match(/cat\s*<<\s*EOF\s*>\s*[^\n]*todos\.md\s*\n([\s\S]*?)\nEOF/m);
  if (!heredocMatch) return [];
  return parseTodosFromMarkdown(heredocMatch[1]);
}

async function enrichListDirectoryResult(toolContext, outputText, workingDir) {
  if (!toolContext) return outputText;
  const rawName = String(toolContext.rawToolName || '').toLowerCase();
  if (rawName !== 'list_directory') return outputText;

  const dirInput = String(toolContext.toolInput?.dir_path || toolContext.toolInput?.path || '.');
  const resolvedDir = path.isAbsolute(dirInput)
    ? path.resolve(dirInput)
    : path.resolve(workingDir, dirInput);
  const normalizedRoot = path.resolve(workingDir) + path.sep;
  if (!resolvedDir.startsWith(normalizedRoot) && resolvedDir !== path.resolve(workingDir)) {
    return outputText;
  }

  try {
    const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
    const sortedEntries = [...entries].sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    const visibleEntries = sortedEntries
      .slice(0, 200)
      .map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory()
      }));

    const baseRel = path.relative(workingDir, resolvedDir).replace(/\\/g, '/');
    const relDir = baseRel && baseRel !== '' ? baseRel : '.';
    const items = visibleEntries.map((entry) => {
      const relPath = relDir === '.'
        ? entry.name
        : `${relDir}/${entry.name}`;
      return {
        name: entry.name,
        path: `${relPath}${entry.isDirectory ? '/' : ''}`,
        isDirectory: entry.isDirectory
      };
    });

    return JSON.stringify(
      {
        summary: outputText,
        directory: relDir,
        files: items.map((item) => item.path),
        items,
        total: entries.length,
        truncated: entries.length > visibleEntries.length
      },
      null,
      2
    );
  } catch {
    return outputText;
  }
}

async function handleGeminiAttachments(command, attachments, workingDir) {
  const tempFilePaths = [];
  let tempDir = null;
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { modifiedCommand: command, tempFilePaths, tempDir };
  }

  try {
    tempDir = path.join(workingDir || process.cwd(), '.tmp', 'attachments', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    for (const [index, item] of attachments.entries()) {
      const data = String(item?.data || '');
      const matches = data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) continue;
      const [, mimeType, base64Data] = matches;
      const ext = mimeType.includes('/') ? mimeType.split('/')[1] : 'bin';
      const originalName = item?.name ? String(item.name).replace(/[^a-zA-Z0-9._-]/g, '_') : null;
      const filename = originalName || `attachment_${index}.${ext}`;
      const filepath = path.join(tempDir, filename);
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempFilePaths.push(filepath);
    }

    if (tempFilePaths.length === 0) {
      return { modifiedCommand: command, tempFilePaths, tempDir };
    }

    const note = `\n\n[Attached files]\n${tempFilePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
    return { modifiedCommand: `${command}${note}`, tempFilePaths, tempDir };
  } catch (error) {
    console.error('[Gemini] Failed to process attachments:', error.message);
    return { modifiedCommand: command, tempFilePaths, tempDir };
  }
}

async function cleanupGeminiTempFiles(tempFilePaths, tempDir) {
  if (!Array.isArray(tempFilePaths) || tempFilePaths.length === 0) return;
  for (const filePath of tempFilePaths) {
    try { await fs.unlink(filePath); } catch {}
  }
  if (tempDir) {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Ensures a session directory exists and creates a basic JSONL metadata file if it doesn't.
 * This helps Dr. Claw discover the session even if the CLI hasn't written to it yet.
 */
async function syncSessionMetadata(sessionId, projectPath, sessionMode = 'research') {
  if (!sessionId || !projectPath) return;
  
  const geminiSessionsDir = path.join(os.homedir(), '.gemini', 'sessions');
  const sessionFile = path.join(geminiSessionsDir, `${sessionId}.jsonl`);
  
  try {
    await fs.mkdir(geminiSessionsDir, { recursive: true });
    
    // Check if file already exists
    try {
      await fs.access(sessionFile);
      // Already exists, we don't want to overwrite real history
      return;
    } catch (e) {
      // File doesn't exist, create it with metadata
      const timestamp = new Date().toISOString();
      const initialEntry = {
        type: 'session_meta',
        payload: {
          id: sessionId,
          cwd: projectPath,
          timestamp,
          sessionMode: sessionMode || 'research',
        },
        cwd: projectPath, // Compatibility
        timestamp,
      };
      
      await fs.writeFile(sessionFile, JSON.stringify(initialEntry) + '\n', 'utf8');
      console.log(`[Gemini] Synced session metadata to ${sessionFile}`);
    }
  } catch (error) {
    console.error(`[Gemini] Failed to sync session metadata: ${error.message}`);
  }
}

/**
 * Executes a Gemini CLI query
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
export async function spawnGemini(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, model, images, attachments, permissionMode, toolsSettings, sessionMode, stageTagKeys, stageTagSource = 'task_context', env } = options;
    let capturedSessionId = sessionId;
    let sessionCreatedSent = false;
    let messageStartedSent = false;
    let contentBlockStarted = false;
    let currentBlockIndex = 0;
    let messageBuffer = '';
    let tempFilePaths = [];
    let tempDir = null;
    // Default: do not hard-require native write_todos.
    // Keep compatibility with markdown/shim flows unless explicitly enabled.
    const requireWriteTodos = Boolean(toolsSettings?.enforceNativeTodos) &&
      (permissionMode === 'plan' || isLikelyMultiStepRequest(command));
    let hasNativeTodoWrite = false;
    const cleanedInitialUserCommand = stripInternalContextPrefix(String(command || ''));
    let initialUserCommandSaved = false;
    let lastSentGeminiErrorSummary = '';
    let policyViolationTriggered = false;
    
    const workingDir = cwd || projectPath || process.cwd();

    // Synchronous (better-sqlite3) — no await needed.
    if (sessionId && workingDir) {
      applyStageTagsToSession({
        sessionId,
        projectPath: workingDir,
        stageTagKeys,
        source: stageTagSource,
      });
    }

    // Keep Gemini session bootstrap parity with Claude sessions:
    // ensure skill links and instruction templates exist in project workspace.
    if (workingDir) {
      try {
        await ensureProjectSkillLinks(workingDir);
        await writeProjectTemplates(workingDir);
      } catch (err) {
        console.warn('[gemini-cli] Failed to initialize project skills/templates:', err.message);
      }
    }
    
    // Track allowed/disallowed tools locally for this session
    const sessionAllowedTools = permissionMode === 'plan'
      ? ensurePlanModeAllowedTools([...(toolsSettings?.allowedTools || [])])
      : [...(toolsSettings?.allowedTools || [])];
    const sessionDisallowedTools = [...(toolsSettings?.disallowedTools || [])];
    
    // Build Gemini CLI command
    const args = [];
    
    if (sessionId && !sessionId.startsWith('new-session-')) {
      args.push('--resume', sessionId);
    }

    if (command && command.trim()) {
      const effectiveAttachments = attachments || images;
      const attachmentResult = await handleGeminiAttachments(command, effectiveAttachments, workingDir);
      tempFilePaths = attachmentResult.tempFilePaths;
      tempDir = attachmentResult.tempDir;
      const effectivePrompt = `${attachmentResult.modifiedCommand}`;
      args.push('--prompt', effectivePrompt);

      if (model) {
        args.push('--model', model);
      }

      // Keep Gemini CLI in yolo mode internally and enforce policy in our own approval hook.
      // In non-interactive server sessions, Gemini's own policy prompts can deny tools unexpectedly.
      args.push('--approval-mode', 'yolo');

      const includeDirectories = [
        path.join(process.cwd(), 'skills'),
        path.join(workingDir, '.agents', 'skills'),
        path.join(workingDir, '.claude', 'skills'),
        path.join(workingDir, '.gemini', 'skills')
      ];
      for (const includeDir of includeDirectories) {
        try {
          await fs.access(includeDir);
          args.push('--include-directories', includeDir);
        } catch {
          // Optional include dir, skip if absent.
        }
      }

      // Request streaming JSON output
      args.push('--output-format', 'stream-json');
    }
    
    const geminiCommand = process.env.GEMINI_CLI_PATH || 'gemini';

    const cleanEnv = { ...(env || process.env) };
    // Non-interactive JSON streaming: avoid terminal renderer hard-wrap artifacts.
    cleanEnv.TERM = 'dumb';
    cleanEnv.COLUMNS = '1000';
    cleanEnv.LINES = '200';
    delete cleanEnv.TERM_PROGRAM;
    delete cleanEnv.TERM_PROGRAM_VERSION;
    delete cleanEnv.ITERM_SESSION_ID;
    
    const escapedArgs = args.map(a => a.includes(' ') ? `"${a.replace(/"/g, '\\"')}"` : a);
    console.log(`[Gemini] Spawning (YOLO-Control): ${geminiCommand} ${escapedArgs.join(' ')}`);
    console.log(`[Gemini] Working directory: ${workingDir}`);
    
    let geminiProcess;
    try {
      geminiProcess = spawnFunction(geminiCommand, args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: cleanEnv,
        detached: process.platform !== 'win32'
      });
    } catch (spawnError) {
      console.error('[Gemini] Spawn call failed:', spawnError);
      ws.send({ type: 'gemini-error', error: `Failed to start Gemini CLI: ${spawnError.message}`, sessionId: capturedSessionId || sessionId || null });
      reject(spawnError);
      return;
    }

    if (!geminiProcess || !geminiProcess.pid) {
      console.error('[Gemini] Process failed to spawn (no PID)');
      ws.send({ type: 'gemini-error', error: 'Failed to start Gemini CLI process', sessionId: capturedSessionId || sessionId || null });
      reject(new Error('Failed to start Gemini CLI process'));
      return;
    }
    
    console.log(`[Gemini] Process spawned with PID: ${geminiProcess.pid}`);
    
    const initialKey = capturedSessionId || `temp-${Date.now()}`;
    const startTimeValue = Date.now();

    const sessionData = {
      process: geminiProcess,
      sessionId: capturedSessionId,
      startTime: startTimeValue,
      options,
      sessionAllowedTools,
      sessionDisallowedTools
    };

    const statusHeartbeat = setInterval(() => {
      ws.send({
        type: 'gemini-status',
        data: { status: 'Working...', can_interrupt: true, startTime: sessionData.startTime },
        sessionId: capturedSessionId || sessionId || null
      });
    }, 2000);

    sessionData.heartbeat = statusHeartbeat;
    activeGeminiSessions.set(initialKey, sessionData);

    ws.send({
      type: 'gemini-status',
      data: { status: 'Working...', can_interrupt: true, startTime: startTimeValue },
      sessionId: capturedSessionId || sessionId || null
    });

    const sendLifecycleStart = (id) => {
      if (!messageStartedSent) {
        messageStartedSent = true;
        ws.send({
          type: 'gemini-response',
          data: {
            type: 'message_start',
            message: { id: `msg_gemini_${Date.now()}`, role: 'assistant', content: [], model: model || 'gemini' },
            startTime: sessionData.startTime
          },
          sessionId: id || capturedSessionId || sessionId || null
        });
      }
    };

    const sendContentBlockStart = (id, type = 'text', index = 0) => {
      if (type === 'text' && contentBlockStarted) return;
      if (type === 'text') contentBlockStarted = true;
      currentBlockIndex = index;
      ws.send({
        type: 'gemini-response',
        data: {
          type: 'content_block_start',
          index: index,
          content_block: type === 'text' ? { type: 'text', text: '' } : { type: 'tool_use', id: `tool_${Date.now()}`, name: '', input: {} },
          startTime: sessionData.startTime
        },
        sessionId: id || capturedSessionId || sessionId || null
      });
    };

    const sendContentBlockStop = (index) => {
      ws.send({
        type: 'gemini-response',
        data: {
          type: 'content_block_stop',
          index: index !== undefined ? index : currentBlockIndex
        },
        sessionId: capturedSessionId || sessionId || null
      });
    };

    const sendGeminiError = (error, details = undefined) => {
      const summary = String(error || '').trim();
      if (!summary || summary === lastSentGeminiErrorSummary) {
        return;
      }
      lastSentGeminiErrorSummary = summary;
      ws.send({
        type: 'gemini-error',
        error: summary,
        ...(typeof details === 'string' && details.trim() ? { details } : {}),
        sessionId: capturedSessionId || sessionId || null
      });
    };

    const handleToolApproval = async (toolName, input, allowedTools = [], disallowedTools = []) => {
      // Internal bypass if UI mode is actually bypass
      if (permissionMode === 'bypassPermissions' || toolsSettings?.skipPermissions === true) return true;

      const isDisallowed = disallowedTools.some(entry => matchesToolPermission(entry, toolName, input));
      if (isDisallowed) return false;

      if (permissionMode === 'plan') {
        const allowedInPlan = ensurePlanModeAllowedTools(allowedTools);
        return allowedInPlan.some(entry => matchesToolPermission(entry, toolName, input));
      }

      // Auto Edit Mode: Automatically approve editing tools
      if (permissionMode === 'acceptEdits') {
        const editTools = ['write_file', 'replace', 'insert_content', 'undo'];
        if (editTools.includes(toolName)) {
          console.log(`[Gemini] Auto-approving edit tool: ${toolName}`);
          return true;
        }
      }

      const isAllowed = allowedTools.some(entry => matchesToolPermission(entry, toolName, input));
      if (isAllowed) return true;

      const requestId = createRequestId();
      ws.send({
        type: 'claude-permission-request',
        requestId,
        toolName,
        input,
        sessionId: capturedSessionId || sessionId || null
      });

      const requiresInteraction = GEMINI_INTERACTIVE_TOOLS.has(String(toolName || ''));
      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        onCancel: (reason) => {
          ws.send({
            type: 'claude-permission-cancelled',
            requestId,
            reason,
            sessionId: capturedSessionId || sessionId || null
          });
        }
      });
      if (!decision || decision.cancelled || !decision.allow) return false;

      if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
        if (!allowedTools.includes(decision.rememberEntry)) allowedTools.push(decision.rememberEntry);
        const idx = disallowedTools.indexOf(decision.rememberEntry);
        if (idx !== -1) disallowedTools.splice(idx, 1);
      }
      return true;
    };
    
    let processingQueue = Promise.resolve();
    let leftOver = '';
    let hasParsedStructuredOutput = false;
    const toolCallContext = new Map();
    const inferredProjectName = inferProjectName(workingDir, projectPath);

    const appendToSessionFile = async (sid, entry) => {
      const targetSid = capturedSessionId || sid || sessionId;
      if (!targetSid || targetSid.startsWith('temp-')) return;
      
      // If it's still a new-session placeholder, we can't save yet, but we'll try again later
      // or we just rely on the fact that capturedSessionId will be set very quickly.
      if (targetSid.startsWith('new-session-')) {
        // console.log('[Gemini] Postponing save, still have new-session ID');
        return;
      }
      
      const geminiSessionsDir = path.join(os.homedir(), '.gemini', 'sessions');
      const sessionFile = path.join(geminiSessionsDir, `${targetSid}.jsonl`);
      try {
        await fs.mkdir(geminiSessionsDir, { recursive: true });
        const data = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
        await fs.appendFile(sessionFile, data, 'utf8');
        console.log(`[Gemini] Saved ${entry.role || entry.type} to ${targetSid}`);
      } catch (error) {
        console.error(`[Gemini] Failed to append to session file: ${error.message}`);
      }
    };

    const persistAssistantMessageBuffer = async (sid, content) => {
      if (!content) return;
      const normalizedEntries = normalizePersistedGeminiAssistantEntries(content);
      for (const entry of normalizedEntries) {
        await appendToSessionFile(sid, entry);
      }
    };

    const processLine = async (line) => {
      if (!line.trim()) return;
      if (policyViolationTriggered) return;
      try {
        const response = JSON.parse(line);
        hasParsedStructuredOutput = true;
        switch (response.type) {
          case 'init':
          case 'session':
            const sid = response.session_id || response.id;
            if (sid && (!capturedSessionId || capturedSessionId.startsWith('new-session-') || capturedSessionId.startsWith('temp-'))) {
              const oldKey = capturedSessionId || initialKey;
              capturedSessionId = sid;
              
              // Persist metadata to filesystem so Dr. Claw can discover it on refresh
              await syncSessionMetadata(capturedSessionId, workingDir, sessionMode);
              await persistGeminiSessionMetadata(capturedSessionId, workingDir, sessionMode);
              
              // NEW: If we have an initial command, save it now that we have a real SID
              if (cleanedInitialUserCommand) {
                await appendToSessionFile(capturedSessionId, {
                  role: 'user',
                  content: cleanedInitialUserCommand,
                  type: 'message'
                });
                initialUserCommandSaved = true;
              }

              if (oldKey !== capturedSessionId) {
                const sessionData = activeGeminiSessions.get(oldKey);
                if (sessionData) {
                  activeGeminiSessions.delete(oldKey);
                  sessionData.sessionId = capturedSessionId;
                  activeGeminiSessions.set(capturedSessionId, sessionData);
                }
              }
              if (ws.setSessionId && typeof ws.setSessionId === 'function') ws.setSessionId(capturedSessionId);
              if (!sessionCreatedSent) {
                sessionCreatedSent = true;
                recordIndexedSession({
                  sessionId: capturedSessionId,
                  provider: 'gemini',
                  projectPath: workingDir,
                  sessionMode: sessionMode || 'research',
                  stageTagKeys,
                  tagSource: stageTagSource,
                });
                ws.send({ type: 'session-created', sessionId: capturedSessionId, provider: 'gemini', mode: sessionMode || 'research' });
              }
            }
            break;
            
          case 'message':
            if (response.role && response.content) {
              const contentText = typeof response.content === 'string'
                ? response.content
                : Array.isArray(response.content)
                  ? response.content.map((part) => part?.text || (typeof part === 'string' ? part : '')).join('')
                  : '';

              if (response.role === 'assistant' && contentText) {
                sendLifecycleStart();
                sendContentBlockStart(null, 'text', 0);
                messageBuffer += contentText;
                ws.send({
                  type: 'gemini-response',
                  data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: contentText } },
                  sessionId: capturedSessionId || sessionId || null
                });
              } else {
                const sanitizedContent = response.role === 'user'
                  ? sanitizePersistedGeminiContent(response.content)
                  : response.content;
                const sanitizedContentText = typeof sanitizedContent === 'string'
                  ? sanitizedContent
                  : Array.isArray(sanitizedContent)
                    ? sanitizedContent.map((part) => part?.text || (typeof part === 'string' ? part : '')).join('')
                    : '';
                if (
                  response.role === 'user' &&
                  initialUserCommandSaved &&
                  cleanedInitialUserCommand &&
                  typeof sanitizedContentText === 'string' &&
                  sanitizedContentText.trim() === cleanedInitialUserCommand.trim()
                ) {
                  break;
                }
                await appendToSessionFile(capturedSessionId || sessionId || initialKey, {
                  role: response.role,
                  content: sanitizedContent,
                  type: 'message'
                });
              }
            }
            break;

          case 'content':
          case 'chunk':
            const text = response.text || response.content || response.delta;
            if (text && response.role !== 'user') {
              sendLifecycleStart();
              sendContentBlockStart(null, 'text', 0);
              messageBuffer += text;
              ws.send({
                type: 'gemini-response',
                data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text } },
                sessionId: capturedSessionId || sessionId || null
              });
            }
            break;
            
          case 'tool_use':
          case 'tool_call':
          case 'call':
            sendLifecycleStart();
            const toolIndex = 1; 
            const rawToolName = response.name || response.tool_name;
            const toolName = normalizeGeminiToolName(rawToolName);
            const originalToolInput = response.parameters || response.input || response.arguments;
            const toolInput = normalizeGeminiToolInput(rawToolName, originalToolInput);
            const toolCallId = response.id || `tool_${Date.now()}`;
            const parentToolUseId = response.parent_tool_use_id || response.parentToolUseId || null;
            const rawNameNormalized = String(rawToolName || '').trim();
            const policyTargetName = rawToolName || toolName;

            if (
              rawNameNormalized.toLowerCase() === 'write_todos' ||
              rawNameNormalized.toLowerCase() === 'todo_write' ||
              String(toolName || '').toLowerCase() === 'todowrite'
            ) {
              hasNativeTodoWrite = true;
            }

            if (requireWriteTodos && !hasNativeTodoWrite && !isAllowedBeforeTodos(rawToolName)) {
              policyViolationTriggered = true;
              sendGeminiError('Policy violation: multi-step tasks must call write_todos before executing other tools.');
              geminiProcess.kill('SIGKILL');
              break;
            }

            if (permissionMode === 'plan' && GEMINI_PLAN_BLOCKED_TOOLS.has(policyTargetName)) {
              policyViolationTriggered = true;
              sendGeminiError(`Tool execution denied by plan policy: ${policyTargetName}`);
              geminiProcess.kill('SIGKILL');
              break;
            }
            toolCallContext.set(toolCallId, {
              rawToolName,
              normalizedToolName: toolName,
              toolInput,
              parentToolUseId
            });

            await appendToSessionFile(capturedSessionId || sessionId || initialKey, {
              type: 'tool_use',
              toolName,
              rawToolName,
              toolInput,
              toolCallId,
              parentToolUseId
            });

            ws.send({
              type: 'gemini-response',
              data: {
                role: 'assistant',
                ...(parentToolUseId ? { parentToolUseId } : {}),
                content: [
                  {
                    type: 'tool_use',
                    id: toolCallId,
                    name: toolName,
                    input: toolInput
                  }
                ]
              },
              sessionId: capturedSessionId || sessionId || null
            });

            // Compatibility shim: when Gemini manages todo list via markdown file writes
            // rather than write_todos tool, synthesize TodoWrite card for UI parity.
            if ((rawToolName === 'write_file' || rawToolName === 'replace') && typeof toolInput?.file_path === 'string' && /(?:^|\/)\.pipeline\/tasks\/todos\.md$/.test(toolInput.file_path)) {
              const todos = parseTodosFromMarkdown(String(toolInput?.content || toolInput?.new_string || ''));
              if (todos.length > 0) {
                const syntheticId = `todo_${Date.now()}`;
                ws.send({
                  type: 'gemini-response',
                  data: {
                    role: 'assistant',
                    ...(parentToolUseId ? { parentToolUseId } : {}),
                    content: [{ type: 'tool_use', id: syntheticId, name: 'TodoWrite', input: { todos } }]
                  },
                  sessionId: capturedSessionId || sessionId || null
                });
                ws.send({
                  type: 'gemini-response',
                  data: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: syntheticId, content: 'Todo list updated', is_error: false }]
                  },
                  sessionId: capturedSessionId || sessionId || null
                });
              }
            }

            if (rawToolName === 'run_shell_command') {
              const todos = extractTodosFromShellCommand(String(toolInput?.command || toolInput?.cmd || ''));
              if (todos.length > 0) {
                const syntheticId = `todo_${Date.now()}`;
                ws.send({
                  type: 'gemini-response',
                  data: {
                    role: 'assistant',
                    ...(parentToolUseId ? { parentToolUseId } : {}),
                    content: [{ type: 'tool_use', id: syntheticId, name: 'TodoWrite', input: { todos } }]
                  },
                  sessionId: capturedSessionId || sessionId || null
                });
                ws.send({
                  type: 'gemini-response',
                  data: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: syntheticId, content: 'Todo list updated', is_error: false }]
                  },
                  sessionId: capturedSessionId || sessionId || null
                });
              }
            }
            
            ws.send({
              type: 'gemini-response',
              data: {
                type: 'content_block_start',
                index: toolIndex,
                content_block: { id: toolCallId, name: toolName, input: toolInput }
              },
              sessionId: capturedSessionId || sessionId || null
            });
            currentBlockIndex = toolIndex;

            const currentSessionData = activeGeminiSessions.get(capturedSessionId || initialKey);
            const approved = await handleToolApproval(
              rawToolName || toolName, 
              toolInput, 
              currentSessionData?.sessionAllowedTools || sessionAllowedTools,
              currentSessionData?.sessionDisallowedTools || sessionDisallowedTools
            );
            
            if (!approved) {
              ws.send({
                type: 'gemini-error',
                error: `Tool '${toolName}' was denied by user. Aborting session for safety.`,
                sessionId: capturedSessionId || sessionId || null
              });
              geminiProcess.kill('SIGKILL');
            }
            break;

          case 'tool_result':
            if (response.output || response.content) {
              const rawResult = response.output !== undefined ? response.output : response.content;
              const baseOutputText = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
              const resultToolCallId = response.id || response.tool_use_id;
              const ctx = resultToolCallId ? toolCallContext.get(resultToolCallId) : null;
              const isError = Boolean(response.is_error || response.error);
              let outputText = await enrichListDirectoryResult(ctx, baseOutputText, workingDir);

              // Guide the model when it tries to shell-execute a skill directory
              if (isError && ctx?.rawToolName === 'run_shell_command' && /is a directory|EISDIR/i.test(outputText)) {
                outputText += '\n\nThis path is a skill directory, not an executable. Use activate_skill to invoke it, or read its SKILL.md for instructions.';
              }
              
              await appendToSessionFile(capturedSessionId || sessionId || initialKey, {
                type: 'tool_result',
                output: outputText,
                toolCallId: resultToolCallId,
                parentToolUseId: ctx?.parentToolUseId || null,
                isError
              });

              if (resultToolCallId) {
                ws.send({
                  type: 'gemini-response',
                  data: {
                    role: 'user',
                    ...(ctx?.parentToolUseId ? { parentToolUseId: ctx.parentToolUseId } : {}),
                    content: [
                      {
                        type: 'tool_result',
                        tool_use_id: resultToolCallId,
                        content: outputText,
                        is_error: isError
                      }
                    ]
                  },
                  sessionId: capturedSessionId || sessionId || null
                });
              }

              if (shouldNotifyTaskMasterRefresh(ctx?.rawToolName, ctx?.toolInput, outputText) && inferredProjectName) {
                ws.send({
                  type: 'taskmaster-tasks-updated',
                  projectName: inferredProjectName,
                  provider: 'gemini',
                  source: 'gemini-tool-result',
                  timestamp: new Date().toISOString()
                });
              }

              if (shouldNotifyProjectRefresh(ctx?.rawToolName, ctx?.toolInput, outputText) && inferredProjectName) {
                ws.send({
                  type: 'taskmaster-project-updated',
                  projectName: inferredProjectName,
                  provider: 'gemini',
                  source: 'gemini-tool-result',
                  timestamp: new Date().toISOString()
                });
              }

              if (resultToolCallId) {
                toolCallContext.delete(resultToolCallId);
              }
            }
            sendContentBlockStop(1);
            currentBlockIndex = 0;
            break;

          case 'result':
            if (messageBuffer && (capturedSessionId || sessionId)) {
              await persistAssistantMessageBuffer(capturedSessionId || sessionId || initialKey, messageBuffer);
              messageBuffer = '';
            }
            break;
          case 'status':
            if (response.stats || response.status === 'completed') {
              if (response.stats) {
                await appendToSessionFile(capturedSessionId || sessionId || initialKey, {
                  type: 'status',
                  stats: response.stats
                });
              }
              if (response.stats) {
                ws.send({
                  type: 'token-budget',
                  data: {
                    used: response.stats.total_tokens || response.stats.input_tokens + response.stats.output_tokens,
                    total: GEMINI_DEFAULT_CONTEXT_WINDOW,
                    breakdown: {
                      input: response.stats.input_tokens || 0,
                      output: response.stats.output_tokens || 0,
                      cacheCreation: response.stats.cache_creation_input_tokens || 0,
                      cacheRead: response.stats.cache_read_input_tokens || 0
                    }
                  },
                  sessionId: capturedSessionId || sessionId || null
                });
              }
              sendContentBlockStop();
              ws.send({ type: 'gemini-response', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, sessionId: capturedSessionId || sessionId || null });
              ws.send({ type: 'gemini-response', data: { type: 'message_stop' }, sessionId: capturedSessionId || sessionId || null });
            }
            break;

          case 'error':
            sendGeminiError(response.message);
            break;
        }
      } catch (parseError) {
        // Gemini stream-json should be JSONL. Ignore non-JSON diagnostics to avoid
        // polluting assistant markdown with hard-wrapped or noisy lines.
        if (!hasParsedStructuredOutput && line.trim()) {
          console.log(`[Gemini] Ignoring non-JSON stdout line before structured stream: ${line}`);
        }
      }
    };

    geminiProcess.stdout.on('data', (data) => {
      const rawOutput = leftOver + data.toString();
      const lines = rawOutput.split('\n');
      leftOver = lines.pop() || '';
      for (const line of lines) {
        processingQueue = processingQueue.then(() => processLine(line));
      }
    });
    
    geminiProcess.stderr.on('data', (data) => {
      const errorOutput = data.toString();
      if (policyViolationTriggered && /Policy violation: multi-step tasks must call write_todos/i.test(errorOutput)) {
        return;
      }
      if (/error|exception|fail|invalid|denied/i.test(errorOutput) && !/cached credentials/i.test(errorOutput)) {
        console.error(`[Gemini STDERR] ${errorOutput}`);
        const parsed = summarizeGeminiErrorOutput(errorOutput, model);
        sendGeminiError(parsed.summary, parsed.details);
      }
    });
    
    geminiProcess.on('close', async (code) => {
      await processingQueue;
      if (messageBuffer && (capturedSessionId || sessionId || initialKey)) {
        await persistAssistantMessageBuffer(capturedSessionId || sessionId || initialKey, messageBuffer);
        messageBuffer = '';
      }
      const finalSessionId = capturedSessionId || sessionId || initialKey;
      const sessionData = activeGeminiSessions.get(finalSessionId);
      if (sessionData?.heartbeat) clearInterval(sessionData.heartbeat);
      await cleanupGeminiTempFiles(tempFilePaths, tempDir);
      // Send completion event immediately so the UI can settle
      ws.send({ type: 'gemini-complete', sessionId: finalSessionId, exitCode: code, isNewSession: (!sessionId || sessionId.startsWith('new-session-')) && !!command });
      activeGeminiSessions.delete(finalSessionId);
      // Post-completion housekeeping — runs after the UI receives the completion signal
      if (workingDir && finalSessionId) {
        try {
          await reconcileGeminiSessionIndex(workingDir, {
            sessionId: finalSessionId,
            projectName: encodeProjectPath(workingDir),
          });
        } catch (error) {
          console.warn(`[Gemini] Failed to reconcile indexed session ${finalSessionId}:`, error.message);
        }
      }
      if (policyViolationTriggered || code === 0 || code === null) resolve();
      else reject(new Error(`Gemini CLI exited with code ${code}`));
    });
    
    geminiProcess.on('error', (error) => {
      console.error('[Gemini] Process error:', error);
      const finalSessionId = capturedSessionId || sessionId || initialKey;
      const sessionData = activeGeminiSessions.get(finalSessionId);
      if (sessionData && sessionData.heartbeat) clearInterval(sessionData.heartbeat);
      activeGeminiSessions.delete(finalSessionId);
      cleanupGeminiTempFiles(tempFilePaths, tempDir).catch(() => {});
      sendGeminiError(error.message);
      reject(error);
    });
    geminiProcess.stdin.end();
  });
}

export function abortGeminiSession(sessionId) {
  let sessionData = activeGeminiSessions.get(sessionId);
  let targetId = sessionId;
  if (!sessionData) {
    const activeIds = Array.from(activeGeminiSessions.keys());
    if (activeIds.length === 1) {
      targetId = activeIds[0];
      sessionData = activeGeminiSessions.get(targetId);
    }
  }
  if (sessionData?.process) {
    try {
      if (sessionData.heartbeat) { clearInterval(sessionData.heartbeat); sessionData.heartbeat = null; }
      const proc = sessionData.process;
      if (process.platform !== 'win32' && proc.pid) {
        try { process.kill(-proc.pid, 'SIGINT'); } catch (e) { proc.kill('SIGINT'); }
      } else { proc.kill('SIGINT'); }
      setTimeout(() => {
        if (activeGeminiSessions.has(targetId)) {
          if (process.platform !== 'win32' && proc.pid) { try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) { proc.kill('SIGKILL'); } }
          else { proc.kill('SIGKILL'); }
          activeGeminiSessions.delete(targetId);
        }
      }, 500);
      return true;
    } catch (err) {
      activeGeminiSessions.delete(targetId);
      return false;
    }
  }
  return false;
}

export function isGeminiSessionActive(sessionId) { return activeGeminiSessions.has(sessionId); }

export function getGeminiSessionStartTime(sessionId) {
  const session = activeGeminiSessions.get(sessionId);
  return session ? session.startTime : null;
}

export function getActiveGeminiSessions() {
  return Array.from(activeGeminiSessions.keys());
}
