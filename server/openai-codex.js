/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { Codex } from '@openai/codex-sdk';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { encodeProjectPath, reconcileCodexSessionIndex } from './projects.js';
import { sessionDb } from './database/db.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { classifyError, classifySDKError } from '../shared/errorClassifier.js';
import { buildTempAttachmentFilename } from './utils/imageAttachmentFiles.js';
import { buildCodexRealtimeTokenBudget } from './utils/sessionTokenUsage.js';
import { expandSkillCommand } from './utils/skillExpander.js';
import { buildCodexSessionCreatedEvent } from './utils/codexSessionEvents.js';
import { CODEX_MODELS } from '../shared/modelConstants.js';
import { BTW_SYSTEM_PROMPT, buildBtwUserMessage } from './utils/btw.js';

// Track active sessions
const activeCodexSessions = new Map();

function moveActiveCodexSession(oldSessionId, newSessionId) {
  if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) {
    return;
  }

  const session = activeCodexSessions.get(oldSessionId);
  if (!session) {
    return;
  }

  activeCodexSessions.set(newSessionId, session);
  activeCodexSessions.delete(oldSessionId);
}

/**
 * Check if an agent_message item contains system prompt / instruction content
 * that should be collapsed rather than displayed as a normal message.
 * @param {string} text - The message text
 * @returns {boolean}
 */
function isSystemPromptContent(text) {
  if (!text || text.length < 200) return false;
  // AGENTS.md / SKILL.md / INSTRUCTIONS headers
  if (/^#\s+(AGENTS|SKILL|INSTRUCTIONS)/m.test(text)) return true;
  // XML instruction tags
  if (text.includes('<INSTRUCTIONS>') || text.includes('</INSTRUCTIONS>')) return true;
  // "instructions for /path" pattern in a heading
  if (/^#+\s+.*instructions\s+for\s+\//im.test(text)) return true;
  // Skill content markers
  if (text.includes('Base directory for this skill:') && text.length > 500) return true;
  // Long text with numbered-list instruction patterns
  if (text.length > 2000 && /^\d+\)\s/m.test(text) && /\bskill\b/i.test(text)) return true;
  // Repeated SKILL.md file paths (skill listing content)
  const skillPathCount = (text.match(/SKILL\.md\)/g) || []).length;
  if (skillPathCount >= 3) return true;
  // "How to use skills" section
  if (text.includes('### How to use skills') || text.includes('## How to use skills')) return true;
  // Skill discovery/trigger rules pattern
  if (text.includes('Trigger rules:') && text.includes('skill') && text.length > 500) return true;
  return false;
}

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object|null} - Transformed event for WebSocket, or null to skip
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return null;
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message': {
          const text = item.text || '';
          if (!text.trim()) return null;

          // Detect and mark system prompt content
          const isSysPrompt = isSystemPromptContent(text);
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: text
            },
            isSystemPrompt: isSysPrompt
          };
        }

        case 'reasoning': {
          // Codex reasoning items are brief status notes with no real value to display
          // Skip them entirely to avoid "💭 Thinking..." spam in the UI
          return null;
        }

        case 'command_execution': {
          // Codex may wrap commands in JSON: {"cmd":"...", "workdir":"...", "max_output_tokens":...}
          // Extract just the command string for display
          let command = item.command || '';
          try {
            const parsed = JSON.parse(command);
            if (parsed.cmd) command = parsed.cmd;
          } catch {
            // Not JSON, use as-is
          }
          return {
            type: 'item',
            itemType: 'command_execution',
            command,
            output: item.aggregated_output || '',
            exitCode: item.exit_code,
            status: item.status
          };
        }

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query || ''
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Map permission mode to Codex SDK options
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'untrusted'
      };
  }
}

function buildCodexInput(command, attachments) {
  const imagePaths = Array.isArray(attachments?.imagePaths)
    ? attachments.imagePaths.filter((value) => typeof value === 'string' && value.trim())
    : [];
  const documentPaths = Array.isArray(attachments?.documentPaths)
    ? attachments.documentPaths.filter((value) => typeof value === 'string' && value.trim())
    : [];

  if (imagePaths.length === 0 && documentPaths.length === 0) {
    return command;
  }

  const textSections = [command];

  if (documentPaths.length > 0) {
    textSections.push(
      `Attached workspace PDF path(s):\n${documentPaths
        .map((filePath) => `- ${filePath}`)
        .join('\n')}`,
    );
  }

  if (imagePaths.length > 0) {
    textSections.push(
      imagePaths.length === 1
        ? 'An image is attached below.'
        : `There are ${imagePaths.length} attached images below.`,
    );
  }

  return [
    { type: 'text', text: textSections.join('\n\n') },
    ...imagePaths.map((filePath) => ({ type: 'local_image', path: filePath })),
  ];
}

async function prepareCodexInput(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!Array.isArray(images) || images.length === 0) {
    return { input: command, tempImagePaths, tempDir };
  }

  try {
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    const input = [{ type: 'text', text: command }];

    for (const [index, image] of images.entries()) {
      const data = String(image?.data || '');
      const matches = data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const filename = buildTempAttachmentFilename(index, image?.name, mimeType);
      const filepath = path.join(tempDir, filename);

      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
      input.push({ type: 'local_image', path: filepath });
    }

    return {
      input: input.length > 1 ? input : command,
      tempImagePaths,
      tempDir,
    };
  } catch (error) {
    console.error('[Codex] Failed to prepare image inputs:', error);
    return { input: command, tempImagePaths, tempDir };
  }
}

async function cleanupCodexTempFiles(tempImagePaths, tempDir) {
  if (!Array.isArray(tempImagePaths) || tempImagePaths.length === 0) {
    return;
  }

  for (const filePath of tempImagePaths) {
    try {
      await fs.unlink(filePath);
    } catch {}
  }

  if (tempDir) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode, modelReasoningEffort
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryCodex(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model,
    env,
    attachments,
    images,
    permissionMode = 'default',
    modelReasoningEffort,
    sessionMode,
    stageTagKeys,
    stageTagSource = 'task_context',
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);

  let codex;
  let thread;
  let currentSessionId = sessionId || null;
  let provisionalSessionId = null;
  const abortController = new AbortController();
  let tempImagePaths = [];
  let tempDir = null;

  try {
    // Synchronous (better-sqlite3) — no await needed.
    if (sessionId && workingDirectory) {
      applyStageTagsToSession({
        sessionId,
        projectPath: workingDirectory,
        stageTagKeys,
        source: stageTagSource,
      });
    }

    // Initialize Codex SDK
    codex = new Codex(env ? { env } : undefined);

    // Thread options with sandbox and approval settings
    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model,
      modelReasoningEffort,
    };

    // Start or resume thread
    if (sessionId) {
      thread = codex.resumeThread(sessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    provisionalSessionId = currentSessionId || `codex-${Date.now()}`;
    activeCodexSessions.set(provisionalSessionId, {
      thread,
      codex,
      status: 'running',
      abortController,
      startTime: Date.now(),
      writer: ws,
    });

    const publishSessionId = (resolvedSessionId) => {
      if (!resolvedSessionId || resolvedSessionId === currentSessionId) {
        return;
      }

      const previousSessionId = currentSessionId || provisionalSessionId;
      currentSessionId = resolvedSessionId;

      if (previousSessionId && previousSessionId !== currentSessionId) {
        moveActiveCodexSession(previousSessionId, currentSessionId);
      }

      if (workingDirectory) {
        recordIndexedSession({
          sessionId: currentSessionId,
          provider: 'codex',
          projectPath: workingDirectory,
          sessionMode: sessionMode || 'research',
          stageTagKeys,
          tagSource: stageTagSource,
        });
      }

      sendMessage(ws, buildCodexSessionCreatedEvent({
        sessionId: currentSessionId,
        sessionMode: sessionMode || 'research',
        projectName: workingDirectory ? encodeProjectPath(workingDirectory) : null,
      }));
    };

    publishSessionId(thread.id || sessionId || null);

    // Expand /skill-name slash commands into full SKILL.md instructions
    const expandedCommand = await expandSkillCommand(command?.trim() || command, workingDirectory);

    const preparedInput = await prepareCodexInput(expandedCommand, images, workingDirectory);
    tempImagePaths = preparedInput.tempImagePaths;
    tempDir = preparedInput.tempDir;

    // Execute with streaming
    // Prefer pre-uploaded attachments (buildCodexInput) over base64 temp images (prepareCodexInput)
    const codexInput = attachments
      ? buildCodexInput(expandedCommand, attachments)
      : preparedInput.input;
    const streamedTurn = await thread.runStreamed(codexInput, {
      signal: abortController.signal
    });

    // Track items we've already sent to avoid duplicates
    const sentItems = new Map(); // itemId -> lifecycle stage

    for await (const event of streamedTurn.events) {
      if (event.type === 'thread.started' && event.id) {
        publishSessionId(event.id);
      }

      // Check if session was aborted
      const activeLookupId = currentSessionId || provisionalSessionId;
      const session = activeCodexSessions.get(activeLookupId);
      if (!session || session.status === 'aborted') {
        break;
      }

      const itemType = event.item?.type || 'unknown';
      const itemId = event.item?.id || null;

      // Detailed debug logging
      if (event.item) {
        const preview = event.item.text ? event.item.text.substring(0, 80) : (event.item.command || '');
        console.log(`[Codex] ${event.type} | ${itemType} | id=${itemId} | preview="${preview}"`);
        // Extra logging for command_execution output
        if (itemType === 'command_execution' && event.type === 'item.completed') {
          const outLen = event.item.aggregated_output?.length || 0;
          const outPreview = event.item.aggregated_output?.substring(0, 120) || '(empty)';
          console.log(`[Codex]   cmd output (${outLen} chars): "${outPreview}"`);
        }
      } else {
        console.log(`[Codex] ${event.type}`);
      }

      // Event filtering:
      // - item.updated: always skip (streaming noise)
      // - item.started: forward tool-type items immediately so they appear in UI
      // - item.completed: always forward (final state with results)
      if (event.type === 'item.updated') {
        continue;
      }

      if (event.type === 'item.started') {
        const toolTypes = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search']);
        if (!toolTypes.has(itemType)) {
          continue;
        }
        if (itemId) sentItems.set(itemId, 'started');
      }

      if (event.type === 'item.completed' && itemId) {
        sentItems.set(itemId, 'completed');
      }

      const transformed = transformCodexEvent(event);

      // Skip null transforms (empty reasoning, etc.)
      if (!transformed) {
        console.log(`[Codex] Skipped null transform for ${event.type} | ${itemType}`);
        continue;
      }

      // Add lifecycle info for frontend dedup
      if (itemId) {
        transformed.itemId = itemId;
        transformed.lifecycle = event.type === 'item.started' ? 'started'
          : event.type === 'item.completed' ? 'completed' : 'other';
      }

      // Add startTime for frontend timer synchronization
      const activeSessionId = currentSessionId || provisionalSessionId;
      const activeSession = activeSessionId ? activeCodexSessions.get(activeSessionId) : null;
      if (Number.isFinite(activeSession?.startTime)) {
        transformed.startTime = activeSession.startTime;
      }

      // For error/turn.failed events, send codex-error instead of codex-response
      // to trigger the error UI with retry button (avoid sending both).
      if (event.type === 'error' || event.type === 'turn.failed') {
        const errorCode = event.error?.code || event.error?.type || '';
        const errorMsg = event.error?.message || event.message || String(event.error || '');
        const { errorType, isRetryable } = errorCode
          ? classifySDKError(errorCode, 'codex')
          : classifyError(errorMsg);
        sendMessage(ws, {
          type: 'codex-error',
          error: errorMsg || errorCode,
          errorType,
          isRetryable,
          sessionId: currentSessionId,
        });
        continue;
      }

      sendMessage(ws, {
        type: 'codex-response',
        data: transformed,
        sessionId: currentSessionId
      });

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed' && event.usage) {
        sendMessage(ws, {
          type: 'token-budget',
          data: buildCodexRealtimeTokenBudget(event.usage),
          sessionId: currentSessionId
        });
      }
    }

    const actualSessionId = thread.id || currentSessionId || provisionalSessionId;

    // Send completion event immediately so the UI can settle
    sendMessage(ws, {
      type: 'codex-complete',
      sessionId: currentSessionId,
      actualSessionId
    });

    // Post-completion housekeeping — runs after the UI receives the completion signal
    if (workingDirectory && actualSessionId) {
      try {
        await reconcileCodexSessionIndex(workingDirectory, {
          sessionId: actualSessionId,
          previousSessionId: currentSessionId,
          projectName: encodeProjectPath(workingDirectory),
        });
        if (currentSessionId && actualSessionId !== currentSessionId) {
          sessionDb.deleteSession(currentSessionId);
        }
      } catch (error) {
        console.warn(`[Codex] Failed to reconcile indexed session ${actualSessionId}:`, error.message);
      }
    }

  } catch (error) {
    const lookupSessionId = currentSessionId || provisionalSessionId;
    const session = lookupSessionId ? activeCodexSessions.get(lookupSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);
      const { errorType, isRetryable } = classifyError(error.message);

      sendMessage(ws, {
        type: 'codex-error',
        error: error.message,
        errorType,
        isRetryable,
        sessionId: currentSessionId
      });
    }

  } finally {
    await cleanupCodexTempFiles(tempImagePaths, tempDir);

    // Update session status
    const finalSessionId = currentSessionId || provisionalSessionId;
    if (finalSessionId) {
      const session = activeCodexSessions.get(finalSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get the start time of a Codex session
 * @param {string} sessionId - Session ID
 * @returns {number|null} Start time in ms or null
 */
export function getCodexSessionStartTime(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session ? session.startTime : null;
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions() {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startTime: session.startTime
      });
    }
  }

  return sessions;
}

export function rebindCodexSessionWriter(sessionId, newWriter) {
  const session = activeCodexSessions.get(sessionId);
  if (!session || !session.writer) return false;
  if (typeof session.writer.replaceSocket === 'function') {
    session.writer.replaceSocket(newWriter.ws || newWriter);
    return true;
  }
  return false;
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

/**
 * Resolve an OpenAI API key from environment or ~/.codex/auth.json.
 */
async function resolveOpenAIApiKey(env) {
  if (env?.OPENAI_API_KEY) return env.OPENAI_API_KEY;
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);
    if (auth?.OPENAI_API_KEY) return auth.OPENAI_API_KEY;
  } catch {
    // auth.json missing or unreadable
  }
  return null;
}

/**
 * One-shot, tool-free side question for the /btw overlay.
 * Bypasses the Codex SDK and calls the OpenAI Chat Completions API directly.
 */
export async function runCodexBtw({ question, transcript, model, env, signal }) {
  const apiKey = await resolveOpenAIApiKey(env);
  if (!apiKey) {
    throw new Error('No OpenAI API key available for Codex /btw');
  }

  const userBlock = buildBtwUserMessage(question, transcript);
  const effectiveModel = model || CODEX_MODELS.DEFAULT;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: effectiveModel,
      messages: [
        { role: 'system', content: BTW_SYSTEM_PROMPT },
        { role: 'user', content: userBlock },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`OpenAI API error (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content || '';
  return { answer };
}

// Clean up old completed sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startTime = typeof session.startTime === 'number' ? session.startTime : Number.NaN;
      if (Number.isFinite(startTime) && now - startTime > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
