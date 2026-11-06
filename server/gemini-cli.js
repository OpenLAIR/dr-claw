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
import { buildTempAttachmentFilename, toPortableAtPath } from './utils/imageAttachmentFiles.js';
import { splitLegacyGeminiThoughtContent } from '../shared/geminiThoughtParser.js';
import { classifyError } from '../shared/errorClassifier.js';
import { buildMemoryBlock } from './utils/memoryPrompt.js';
import { COMPUTE_GUARD_BLOCK } from './utils/computeGuardPrompt.js';
import { expandSkillCommand } from './utils/skillExpander.js';
import { createAcpConnection } from './utils/acpConnection.js';
import {
  acpModeForPermission,
  permissionNamesForCard,
  pickPermissionOptionId,
  resolveAcpModelId,
  resolveAntigravityBinary,
  shouldSkipPermissions,
  todosFromAcpPlan,
  tokenBudgetFromAcpUsage,
  toolCardForAcpCall,
  toolResultTextForAcpCall,
} from './utils/antigravityAcp.js';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeGeminiSessions = new Map(); // Track active sessions: { process, heartbeat, sessionId, options, sessionAllowedTools, sessionDisallowedTools }
const GEMINI_DEFAULT_CONTEXT_WINDOW = parseInt(process.env.GEMINI_CONTEXT_WINDOW || process.env.CONTEXT_WINDOW || '2000000', 10);

const GEMINI_INTERACTIVE_TOOLS = new Set(['ask_user', 'ask_user_question', 'AskUserQuestion']);

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
      const filename = buildTempAttachmentFilename(index, item?.name, mimeType);
      const filepath = path.join(tempDir, filename);
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempFilePaths.push(filepath);
    }

    if (tempFilePaths.length === 0) {
      return { modifiedCommand: command, tempFilePaths, tempDir };
    }

    const referencedPaths = tempFilePaths.map((filePath) => {
      return toPortableAtPath(filePath, workingDir || process.cwd());
    });
    const note = `\n\nAttached files:\n${referencedPaths.join('\n')}`;
    return { modifiedCommand: `${command}${note}`, tempFilePaths, tempDir };
  } catch (error) {
    console.error('[Gemini] Failed to process attachments:', error.message);
    return { modifiedCommand: command, tempFilePaths, tempDir };
  }
}

async function cleanupGeminiTempFiles(tempFilePaths, tempDirs) {
  if (!Array.isArray(tempFilePaths) || tempFilePaths.length === 0) return;
  for (const filePath of tempFilePaths) {
    try { await fs.unlink(filePath); } catch {}
  }

  if (!Array.isArray(tempDirs)) return;
  for (const tempDir of new Set(tempDirs.filter(Boolean))) {
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
 * Runs one chat turn with the Antigravity CLI (`agy acp`, Agent Client
 * Protocol). The Gemini CLI was retired in favour of Antigravity; the
 * provider id stays `gemini` so existing sessions, settings and UI keep working.
 *
 * Each turn starts `agy acp`, opens or loads the conversation, sends the
 * prompt, and streams ACP session updates to the chat as `gemini-*` messages.
 * Tool permission requests arrive before a tool runs and are answered from
 * Dr. Claw's permission settings or by asking the user.
 *
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
export async function spawnGemini(command, options = {}, ws) {
  const { sessionId, projectPath, cwd, model, images, attachments, permissionMode, toolsSettings, sessionMode, stageTagKeys, stageTagSource = 'task_context', env } = options;
  const workingDir = cwd || projectPath || process.cwd();
  const isResume = Boolean(sessionId) && !String(sessionId).startsWith('new-session-');
  const skipPermissions = shouldSkipPermissions(permissionMode, toolsSettings);
  const cleanedInitialUserCommand = stripInternalContextPrefix(String(command || ''));
  const tempFilePaths = [];
  const tempDirs = [];

  if (isResume && workingDir) {
    applyStageTagsToSession({ sessionId, projectPath: workingDir, stageTagKeys, source: stageTagSource });
  }

  if (workingDir) {
    try {
      await ensureProjectSkillLinks(workingDir);
      await writeProjectTemplates(workingDir);
    } catch (err) {
      console.warn('[Antigravity] Failed to initialize project skills/templates:', err.message);
    }
  }

  const sessionAllowedTools = [...(toolsSettings?.allowedTools || [])];
  const sessionDisallowedTools = [...(toolsSettings?.disallowedTools || [])];

  // Build the prompt: expand /skill-name, attach files, prepend memory and the compute guard.
  let effectivePrompt = '';
  if (command && command.trim()) {
    const expandedCommand = await expandSkillCommand(command.trim(), workingDir);
    const attachmentResult = await handleGeminiAttachments(expandedCommand, attachments || images, workingDir);
    tempFilePaths.push(...attachmentResult.tempFilePaths);
    if (attachmentResult.tempDir) tempDirs.push(attachmentResult.tempDir);
    const memoryBlock = options.userId ? buildMemoryBlock(options.userId) : '';
    const guardedMemory = [memoryBlock, COMPUTE_GUARD_BLOCK].filter(Boolean).join('\n\n').trim();
    effectivePrompt = guardedMemory ? `${guardedMemory}\n\n${attachmentResult.modifiedCommand}` : attachmentResult.modifiedCommand;
  }

  const cleanEnv = { ...(env || process.env) };
  cleanEnv.TERM = 'dumb';
  delete cleanEnv.TERM_PROGRAM;
  delete cleanEnv.TERM_PROGRAM_VERSION;
  delete cleanEnv.ITERM_SESSION_ID;

  const agyBinary = resolveAntigravityBinary({ env: cleanEnv });
  // Skills reach the agent through the project's .agents/skills links. Do not
  // pass the skill folders with --add-dir: agy may then run commands and write
  // files there instead of in the project.
  const args = ['acp'];
  if (skipPermissions) args.push('--dangerously-skip-permissions');

  console.log(`[Antigravity] Spawning: ${agyBinary} ${args.join(' ')} (cwd: ${workingDir})`);

  const initialKey = isResume ? sessionId : `temp-${Date.now()}`;
  const startTime = Date.now();
  let capturedSessionId = isResume ? sessionId : null;
  let lastSentErrorSummary = '';
  let stderrTail = '';

  const sendError = (error, details = undefined) => {
    const summary = String(error || '').trim();
    if (!summary || summary === lastSentErrorSummary) return;
    lastSentErrorSummary = summary;
    const { errorType, isRetryable } = classifyError(summary);
    ws.send({
      type: 'gemini-error',
      error: summary,
      errorType,
      isRetryable,
      ...(typeof details === 'string' && details.trim() ? { details } : {}),
      sessionId: capturedSessionId || sessionId || null,
    });
  };

  let agentProcess;
  try {
    agentProcess = spawnFunction(agyBinary, args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
      detached: process.platform !== 'win32',
    });
  } catch (spawnError) {
    sendError(`Failed to start the Antigravity CLI: ${spawnError.message}`);
    await cleanupGeminiTempFiles(tempFilePaths, tempDirs);
    throw spawnError;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let messageStartedSent = false;
    let textBlockOpen = false;
    let messageBuffer = '';
    let thoughtBuffer = '';
    let loadingHistory = false;
    let acpSessionId = null;
    const toolCalls = new Map();
    const inferredProjectName = inferProjectName(workingDir, projectPath);
    const sid = () => capturedSessionId || sessionId || null;

    const sessionData = {
      process: agentProcess,
      sessionId: capturedSessionId,
      startTime,
      options,
      sessionAllowedTools,
      sessionDisallowedTools,
      connection: null,
      acpSessionId: null,
    };
    sessionData.heartbeat = setInterval(() => {
      ws.send({ type: 'gemini-status', data: { status: 'Working...', can_interrupt: true, startTime }, sessionId: sid() });
    }, 2000);
    activeGeminiSessions.set(initialKey, sessionData);
    ws.send({ type: 'gemini-status', data: { status: 'Working...', can_interrupt: true, startTime }, sessionId: sid() });

    const appendToSessionFile = async (entry) => {
      const targetSid = capturedSessionId;
      if (!targetSid) return;
      const sessionsDir = path.join(os.homedir(), '.gemini', 'sessions');
      try {
        await fs.mkdir(sessionsDir, { recursive: true });
        await fs.appendFile(path.join(sessionsDir, `${targetSid}.jsonl`), `${JSON.stringify({ ...entry, timestamp: new Date().toISOString() })}\n`, 'utf8');
      } catch (error) {
        console.error(`[Antigravity] Failed to append to session file: ${error.message}`);
      }
    };

    const sendLifecycleStart = () => {
      if (messageStartedSent) return;
      messageStartedSent = true;
      ws.send({
        type: 'gemini-response',
        data: { type: 'message_start', message: { id: `msg_gemini_${Date.now()}`, role: 'assistant', content: [], model: model || 'antigravity' }, startTime },
        sessionId: sid(),
      });
    };

    const closeTextBlock = async () => {
      if (textBlockOpen) {
        textBlockOpen = false;
        ws.send({ type: 'gemini-response', data: { type: 'content_block_stop', index: 0 }, sessionId: sid() });
      }
      if (messageBuffer) {
        const text = messageBuffer;
        messageBuffer = '';
        for (const entry of normalizePersistedGeminiAssistantEntries(text)) {
          await appendToSessionFile(entry);
        }
      }
    };

    const flushThoughts = async () => {
      const thought = thoughtBuffer.trim();
      thoughtBuffer = '';
      if (!thought) return;
      sendLifecycleStart();
      ws.send({ type: 'gemini-response', data: { role: 'assistant', content: [{ type: 'thinking', thinking: thought }] }, sessionId: sid() });
      await appendToSessionFile({ role: 'assistant', type: 'thinking', content: thought });
    };

    const legacyToolName = (cardName) => ({ Write: 'write_file', Edit: 'replace', Bash: 'run_shell_command' }[cardName] || cardName);

    const announceTool = async (toolCallId, card) => {
      await flushThoughts();
      await closeTextBlock();
      sendLifecycleStart();
      await appendToSessionFile({ type: 'tool_use', toolName: card.name, rawToolName: card.rawName, toolInput: card.input, toolCallId, parentToolUseId: null });
      ws.send({ type: 'gemini-response', data: { role: 'assistant', content: [{ type: 'tool_use', id: toolCallId, name: card.name, input: card.input }] }, sessionId: sid() });
    };

    const finishTool = async (toolCallId, card, update) => {
      const outputText = toolResultTextForAcpCall(update);
      const isError = update.status === 'failed';
      await appendToSessionFile({ type: 'tool_result', output: outputText, toolCallId, parentToolUseId: null, isError });
      ws.send({
        type: 'gemini-response',
        data: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolCallId, content: outputText, is_error: isError }] },
        sessionId: sid(),
      });
      const legacyName = legacyToolName(card.name);
      if (inferredProjectName && shouldNotifyTaskMasterRefresh(legacyName, card.input, outputText)) {
        ws.send({ type: 'taskmaster-tasks-updated', projectName: inferredProjectName, provider: 'gemini', source: 'gemini-tool-result', timestamp: new Date().toISOString() });
      }
      if (inferredProjectName && shouldNotifyProjectRefresh(legacyName, card.input, outputText)) {
        ws.send({ type: 'taskmaster-project-updated', projectName: inferredProjectName, provider: 'gemini', source: 'gemini-tool-result', timestamp: new Date().toISOString() });
      }
    };

    const handleUpdate = async (update) => {
      if (!update || loadingHistory) return;
      switch (update.sessionUpdate) {
        case 'agent_message_chunk': {
          const text = update.content?.type === 'text' ? update.content.text : '';
          if (!text) return;
          await flushThoughts();
          sendLifecycleStart();
          if (!textBlockOpen) {
            textBlockOpen = true;
            ws.send({ type: 'gemini-response', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' }, startTime }, sessionId: sid() });
          }
          messageBuffer += text;
          ws.send({ type: 'gemini-response', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, sessionId: sid() });
          return;
        }
        case 'agent_thought_chunk': {
          const text = update.content?.type === 'text' ? update.content.text : '';
          if (text) thoughtBuffer += text;
          return;
        }
        case 'tool_call':
        case 'tool_call_update': {
          const toolCallId = update.toolCallId;
          if (!toolCallId) return;
          let entry = toolCalls.get(toolCallId);
          if (!entry) {
            const card = { ...toolCardForAcpCall(update), rawName: update.name || update.title || 'tool' };
            entry = { card, finished: false };
            toolCalls.set(toolCallId, entry);
            await announceTool(toolCallId, card);
          }
          if (!entry.finished && (update.status === 'completed' || update.status === 'failed')) {
            entry.finished = true;
            await finishTool(toolCallId, entry.card, update);
          }
          return;
        }
        case 'plan': {
          const todos = todosFromAcpPlan(update.entries);
          if (todos.length === 0) return;
          const syntheticId = `todo_${Date.now()}`;
          sendLifecycleStart();
          ws.send({ type: 'gemini-response', data: { role: 'assistant', content: [{ type: 'tool_use', id: syntheticId, name: 'TodoWrite', input: { todos } }] }, sessionId: sid() });
          ws.send({ type: 'gemini-response', data: { role: 'user', content: [{ type: 'tool_result', tool_use_id: syntheticId, content: 'Todo list updated', is_error: false }] }, sessionId: sid() });
          return;
        }
        default:
          // available_commands_update, current_mode_update, session_info_update,
          // user_message_chunk: nothing to show.
          return;
      }
    };

    let updateQueue = Promise.resolve();
    const onNotification = (method, params) => {
      if (method !== 'session/update') return;
      updateQueue = updateQueue.then(() => handleUpdate(params.update)).catch((error) => {
        console.error('[Antigravity] Failed to handle session update:', error.message);
      });
    };

    const askUserForPermission = async (card) => {
      if (skipPermissions) return { allow: true };
      const names = permissionNamesForCard(card.name);
      const matches = (entry) => names.some((name) => matchesToolPermission(entry, name, card.input));
      if (sessionDisallowedTools.some(matches)) return { allow: false };
      if (permissionMode === 'acceptEdits' && (card.name === 'Write' || card.name === 'Edit')) return { allow: true };
      if (sessionAllowedTools.some(matches)) return { allow: true };

      const requestId = createRequestId();
      ws.send({ type: 'claude-permission-request', requestId, toolName: card.name, input: card.input, sessionId: sid() });
      const decision = await waitForToolApproval(requestId, {
        timeoutMs: GEMINI_INTERACTIVE_TOOLS.has(card.name) ? 0 : undefined,
        onCancel: (reason) => {
          ws.send({ type: 'claude-permission-cancelled', requestId, reason, sessionId: sid() });
        },
      });
      if (!decision || decision.cancelled || !decision.allow) return { allow: false };
      if (decision.rememberEntry && typeof decision.rememberEntry === 'string' && !sessionAllowedTools.includes(decision.rememberEntry)) {
        sessionAllowedTools.push(decision.rememberEntry);
      }
      return { allow: true, remember: Boolean(decision.rememberEntry) };
    };

    const onRequest = async (method, params) => {
      if (method !== 'session/request_permission') {
        const error = new Error(`Method not supported: ${method}`);
        error.code = -32601;
        throw error;
      }
      await updateQueue;
      const card = toolCardForAcpCall(params.toolCall || {});
      const { allow, remember } = await askUserForPermission(card);
      const optionId = pickPermissionOptionId(params.options, { allow, remember });
      if (!optionId) return { outcome: { outcome: 'cancelled' } };
      if (!allow) sendError(`Tool '${card.name}' was not allowed.`);
      return { outcome: { outcome: 'selected', optionId } };
    };

    const connection = createAcpConnection({
      stdin: agentProcess.stdin,
      stdout: agentProcess.stdout,
      onNotification,
      onRequest,
      onInvalidLine: (line) => console.log(`[Antigravity] Ignoring non-JSON stdout line: ${line.slice(0, 200)}`),
    });
    sessionData.connection = connection;

    agentProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrTail = `${stderrTail}${text}`.slice(-8000);
    });

    const startSession = async (newSessionId) => {
      capturedSessionId = newSessionId;
      acpSessionId = newSessionId;
      sessionData.acpSessionId = newSessionId;
      sessionData.sessionId = newSessionId;
      if (initialKey !== newSessionId) {
        activeGeminiSessions.delete(initialKey);
        activeGeminiSessions.set(newSessionId, sessionData);
      }
      if (ws.setSessionId && typeof ws.setSessionId === 'function') ws.setSessionId(newSessionId);
      await syncSessionMetadata(newSessionId, workingDir, sessionMode);
      if (!isResume || newSessionId !== sessionId) {
        await persistGeminiSessionMetadata(newSessionId, workingDir, sessionMode);
        applyStageTagsToSession({ sessionId: newSessionId, projectPath: workingDir, stageTagKeys, source: stageTagSource });
        recordIndexedSession({ sessionId: newSessionId, provider: 'gemini', projectPath: workingDir, sessionMode: sessionMode || 'research', stageTagKeys, tagSource: stageTagSource });
        ws.send({ type: 'session-created', sessionId: newSessionId, provider: 'gemini', mode: sessionMode || 'research' });
      }
      if (cleanedInitialUserCommand) {
        await appendToSessionFile({ role: 'user', content: cleanedInitialUserCommand, type: 'message' });
      }
    };

    const describeFailure = (error) => {
      const text = `${error?.message || ''}\n${stderrTail}`;
      if (error?.code === 'ENOENT' || /ENOENT|not found/i.test(error?.message || '')) {
        return 'Antigravity CLI (agy) was not found. Install it with `curl -fsSL https://antigravity.google/cli/install.sh | bash`, or set ANTIGRAVITY_CLI_PATH.';
      }
      if (/auth|sign in|log in|login|credential/i.test(text)) {
        return 'Antigravity CLI is not signed in. Run `agy` in a terminal once to sign in with Google, then try again.';
      }
      return summarizeGeminiErrorOutput(error?.message || stderrTail, model).summary;
    };

    const finish = async (error) => {
      if (settled) return;
      settled = true;
      try {
        await updateQueue;
        await flushThoughts();
        await closeTextBlock();
      } catch {
        // best effort
      }
      clearInterval(sessionData.heartbeat);
      connection.close('turn finished');
      try { agentProcess.stdin.end(); } catch { /* already closed */ }
      try { agentProcess.kill('SIGTERM'); } catch { /* already exited */ }
      await cleanupGeminiTempFiles(tempFilePaths, tempDirs);
      const finalSessionId = capturedSessionId || initialKey;
      ws.send({ type: 'gemini-complete', sessionId: finalSessionId, exitCode: error ? 1 : 0, isNewSession: !isResume && !!command });
      activeGeminiSessions.delete(finalSessionId);
      activeGeminiSessions.delete(initialKey);
      if (workingDir && capturedSessionId) {
        try {
          await reconcileGeminiSessionIndex(workingDir, { sessionId: capturedSessionId, projectName: encodeProjectPath(workingDir) });
        } catch (reconcileError) {
          console.warn(`[Antigravity] Failed to reconcile indexed session ${capturedSessionId}:`, reconcileError.message);
        }
      }
      if (error) reject(error);
      else resolve();
    };

    agentProcess.on('error', (error) => {
      sendError(describeFailure(error), stderrTail);
      connection.close(error.message);
      finish(error);
    });

    agentProcess.on('close', (code) => {
      connection.close(`agy exited with code ${code}`);
      if (!settled && code && code !== 0) {
        sendError(describeFailure(new Error(`Antigravity CLI exited with code ${code}`)), stderrTail);
        finish(new Error(`Antigravity CLI exited with code ${code}`));
      }
    });

    const runTurn = async () => {
      const init = await connection.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });

      let session = null;
      if (isResume && init?.agentCapabilities?.loadSession !== false) {
        loadingHistory = true;
        try {
          session = await connection.request('session/load', { sessionId, cwd: workingDir, mcpServers: [] });
          session = { ...(session || {}), sessionId };
        } catch (loadError) {
          console.warn(`[Antigravity] Could not load conversation ${sessionId}: ${loadError.message}`);
          session = null;
        } finally {
          await updateQueue;
          loadingHistory = false;
        }
      }
      if (!session) {
        session = await connection.request('session/new', { cwd: workingDir, mcpServers: [] });
        if (isResume) {
          sendError('This conversation could not be continued in Antigravity, so a new conversation was started.');
        }
      }
      await startSession(session.sessionId);

      const modelId = resolveAcpModelId(model, session.models?.availableModels);
      if (modelId && modelId !== session.models?.currentModelId) {
        try {
          await connection.request('session/set_model', { sessionId: acpSessionId, modelId });
        } catch (modelError) {
          console.warn(`[Antigravity] Could not switch to model ${modelId}: ${modelError.message}`);
        }
      }
      const modeId = acpModeForPermission(permissionMode);
      if (!skipPermissions && modeId !== session.modes?.currentModeId) {
        try {
          await connection.request('session/set_mode', { sessionId: acpSessionId, modeId });
        } catch (modeError) {
          console.warn(`[Antigravity] Could not switch to mode ${modeId}: ${modeError.message}`);
        }
      }

      if (!effectivePrompt) return;
      const result = await connection.request('session/prompt', {
        sessionId: acpSessionId,
        prompt: [{ type: 'text', text: effectivePrompt }],
      });
      await updateQueue;
      await flushThoughts();
      await closeTextBlock();

      const budget = tokenBudgetFromAcpUsage(result?.usage, GEMINI_DEFAULT_CONTEXT_WINDOW);
      if (budget) {
        await appendToSessionFile({ type: 'status', stats: { input_tokens: budget.breakdown.input, output_tokens: budget.breakdown.output, total_tokens: budget.used } });
        ws.send({ type: 'token-budget', data: budget, sessionId: sid() });
      }
      if (result?.stopReason === 'max_tokens' || result?.stopReason === 'max_turn_requests') {
        sendError(`Antigravity stopped early (${result.stopReason}).`);
      } else if (result?.stopReason === 'refusal') {
        sendError('Antigravity declined to continue this request.');
      }
      ws.send({ type: 'gemini-response', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, sessionId: sid() });
      ws.send({ type: 'gemini-response', data: { type: 'message_stop' }, sessionId: sid() });
    };

    runTurn()
      .then(() => finish(null))
      .catch((error) => {
        if (sessionData.cancelled) {
          finish(null);
          return;
        }
        sendError(describeFailure(error), stderrTail);
        finish(error);
      });
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
      // Ask Antigravity to stop the turn cleanly before the process is signalled.
      if (sessionData.connection && sessionData.acpSessionId) {
        sessionData.cancelled = true;
        sessionData.connection.notify('session/cancel', { sessionId: sessionData.acpSessionId });
      }
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
