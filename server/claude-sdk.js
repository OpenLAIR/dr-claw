/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CLAUDE_MODELS } from '../shared/modelConstants.js';
import { classifyError, classifySDKError } from '../shared/errorClassifier.js';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileClaudeSessionIndex } from './projects.js';
import { writeProjectTemplates } from './templates/index.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { buildTempAttachmentFilename } from './utils/imageAttachmentFiles.js';

import { createRequestId, waitForToolApproval, resolveToolApproval as resolvePermApproval, matchesToolPermission } from './utils/permissions.js';
import { buildMemoryBlock } from './utils/memoryPrompt.js';

const activeSessions = new Map();
const pendingClaudeSessionIndexReconciles = new Map();

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion']);

function resolveToolApproval(requestId, decision) {
  resolvePermApproval(requestId, decision);
}

function scheduleClaudeSessionIndexReconcile(projectPath, sessionId, delayMs = 1000) {
  if (!projectPath || !sessionId) {
    return;
  }

  const existingTimer = pendingClaudeSessionIndexReconciles.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timeoutId = setTimeout(async () => {
    pendingClaudeSessionIndexReconciles.delete(sessionId);
    try {
      await reconcileClaudeSessionIndex(encodeProjectPath(projectPath), sessionId);
    } catch (error) {
      console.warn(`[Claude] Failed to reconcile indexed session ${sessionId}:`, error.message);
    }
  }, delayMs);

  pendingClaudeSessionIndexReconciles.set(sessionId, timeoutId);
}

async function flushClaudeSessionIndexReconcile(projectPath, sessionId) {
  if (!projectPath || !sessionId) {
    return;
  }

  const existingTimer = pendingClaudeSessionIndexReconciles.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    pendingClaudeSessionIndexReconciles.delete(sessionId);
  }

  try {
    await reconcileClaudeSessionIndex(encodeProjectPath(projectPath), sessionId);
  } catch (error) {
    console.warn(`[Claude] Failed to flush indexed session ${sessionId}:`, error.message);
  }
}

/**
 * Maps CLI options to SDK-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} SDK-compatible options
 */
function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode, images, env } = options;

  const sdkOptions = {};

  // Map working directory
  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  if (env) {
    sdkOptions.env = env;
  }

  // Map permission mode
  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  // Skip the interactive trust/bypass-permissions dialogs that the CLI shows on
  // first launch in a new directory.  These Ink prompts require a TTY and will
  // hang when the SDK is used headlessly from a server process.
  sdkOptions.allowDangerouslySkipPermissions = false;

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // Handle tool permissions
  if (settings.skipPermissions && permissionMode !== 'plan') {
    // When skipping permissions, use bypassPermissions mode
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  // Add plan mode default tools
  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  // Map model (default to sonnet)
  // Valid models: sonnet, opus, haiku, opusplan, sonnet[1m]
  sdkOptions.model = options.model || CLAUDE_MODELS.DEFAULT;
  console.log(`Using model: ${sdkOptions.model}`);

  // Map system prompt configuration with optional user memory injection
  const memoryBlock = options.userId ? buildMemoryBlock(options.userId) : '';
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code',  // Required to use CLAUDE.md
    ...(memoryBlock ? { append: memoryBlock } : {}),
  };

  // Map setting sources for CLAUDE.md loading
  // This loads CLAUDE.md from project, user (~/.config/claude/CLAUDE.md), and local directories
  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Map resume session
  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, queryInstance, tempImagePaths = [], tempDir = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

/**
 * Returns the context window size for a given model name.
 * Supports both SDK format ('sonnet', 'opus') and API format ('claude-opus-4-6').
 * Falls back to CONTEXT_WINDOW env var, then 200000.
 * @param {string|null} modelName
 * @returns {number}
 */
function getContextWindowForModel(modelName) {
  const MODEL_CONTEXT_WINDOWS = {
    // SDK format names
    'sonnet':              200000,
    'opus':                200000,
    'haiku':               200000,
    'opusplan':            200000,
    'sonnet[1m]':          1000000,
    // API format names
    'claude-opus-4-6':             200000,
    'claude-opus-4-20250918':      200000,
    'claude-sonnet-4-6':           200000,
    'claude-sonnet-4-20250514':    200000,
    'claude-haiku-4-5':            200000,
    'claude-haiku-4-5-20251001':   200000,
    'claude-3-5-sonnet':           200000,
    'claude-3-5-sonnet-20241022':  200000,
    'claude-3-5-haiku':            200000,
    'claude-3-5-haiku-20241022':   200000,
    'claude-3-opus':               200000,
    'claude-3-opus-20240229':      200000,
    'claude-3-sonnet':             200000,
    'claude-3-haiku':              200000,
  };

  if (modelName) {
    // Exact match first
    const exact = MODEL_CONTEXT_WINDOWS[modelName];
    if (exact) return exact;
    // Prefix match (e.g. 'claude-opus-4-6-20260301' matches 'claude-opus-4-6')
    const prefix = Object.keys(MODEL_CONTEXT_WINDOWS).find(k => modelName.startsWith(k));
    if (prefix) return MODEL_CONTEXT_WINDOWS[prefix];
  }

  // Fallback: env var override, then default
  const envVal = parseInt(process.env.CONTEXT_WINDOW, 10);
  return Number.isFinite(envVal) ? envVal : 200000;
}

/**
 * Extracts token budget from the latest assistant message's usage data.
 * Returns a snapshot of context window usage for a single API call,
 * including both input tokens (with cache) and output tokens.
 * Not cumulative across agentic turns.
 * @param {Object|null} usage - usage object from assistant message (message.usage)
 * @param {string|null} modelName - model name for context window lookup
 * @returns {Object|null} Token budget object { used, total } or null
 */
function extractTokenBudgetFromUsage(usage, modelName) {
  if (!usage) {
    return null;
  }

  // In Claude API: input_tokens is the non-cached portion.
  // Total context = input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens
  // This is a per-call snapshot — output_tokens here are for THIS response only,
  // not double-counted with future turns' input_tokens.
  const inputTokens = usage.input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const totalUsed = inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens;

  const contextWindow = getContextWindowForModel(modelName);

  console.log(`Token calculation: model=${modelName}, input=${inputTokens}, cacheRead=${cacheReadTokens}, cacheCreation=${cacheCreationTokens}, output=${outputTokens}, total=${totalUsed}/${contextWindow}`);

  return {
    used: totalUsed,
    total: contextWindow
  };
}

/**
 * Handles image processing for SDK queries
 * Saves base64 images to temporary files and returns modified prompt with file paths
 * @param {string} command - Original user prompt
 * @param {Array} images - Array of image objects with base64 data
 * @param {string} cwd - Working directory for temp file creation
 * @returns {Promise<Object>} {modifiedCommand, tempImagePaths, tempDir}
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Save each image to a temp file
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, , base64Data] = matches;
      const filename = buildTempAttachmentFilename(index, image?.name, matches[1]);
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    // Include the full image paths in the prompt
    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Files provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    console.log(`Processed ${tempImagePaths.length} images to temp directory: ${tempDir}`);
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for SDK:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

/**
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    console.log(`Cleaned up ${tempImagePaths.length} temp image files`);
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      console.log('No ~/.claude.json found, proceeding without MCP servers');
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      console.log(`Loaded ${Object.keys(mcpServers).length} global MCP servers`);
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        console.log(`Loaded ${Object.keys(projectConfig.mcpServers).length} project-specific MCP servers`);
      }
    }

    // Dr. Claw no longer relies on TaskMaster MCP tooling in chat sessions.
    // Filter out any TaskMaster-related MCP entries to prevent legacy "not installed" errors.
    const filteredMcpServers = Object.fromEntries(
      Object.entries(mcpServers).filter(([name, config]) => {
        const normalizedName = String(name || '').toLowerCase();
        const command = String(config?.command || '').toLowerCase();
        const argsJoined = Array.isArray(config?.args)
          ? config.args.map((arg) => String(arg || '').toLowerCase()).join(' ')
          : '';

        const isTaskMasterServer =
          normalizedName.includes('task-master') ||
          normalizedName.includes('taskmaster') ||
          command.includes('task-master') ||
          command.includes('taskmaster') ||
          argsJoined.includes('task-master') ||
          argsJoined.includes('taskmaster');

        return !isTaskMasterServer;
      })
    );

    // Return null if no servers found
    if (Object.keys(filteredMcpServers).length === 0) {
      console.log('No MCP servers configured');
      return null;
    }

    if (Object.keys(filteredMcpServers).length !== Object.keys(mcpServers).length) {
      console.log(
        `Filtered legacy TaskMaster MCP servers: ${Object.keys(mcpServers).length - Object.keys(filteredMcpServers).length}`
      );
    }

    console.log(`Total MCP servers loaded: ${Object.keys(filteredMcpServers).length}`);
    return filteredMcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId, sessionMode, stageTagKeys, stageTagSource = 'task_context' } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  const sessionProjectPath = options.cwd || options.projectPath || null;

  try {
    // Synchronous (better-sqlite3) — no await needed.
    if (sessionId && sessionProjectPath) {
      applyStageTagsToSession({
        sessionId,
        projectPath: sessionProjectPath,
        stageTagKeys,
        source: stageTagSource,
      });
    }

    // Ensure skills symlinks and CLAUDE.md template exist in the project directory
    const projectDir = options.cwd || options.projectPath;
    if (projectDir) {
      try {
        await ensureProjectSkillLinks(projectDir);
        await writeProjectTemplates(projectDir);
      } catch (err) {
        console.warn('[claude-sdk] Failed to initialize project skills/templates:', err.message);
      }
    }

    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK(options);

    // Load MCP configuration
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Inject compute-tools MCP server if an active compute node is configured
    try {
      const { getActiveNode } = await import('./compute-node.js');
      const activeNode = await getActiveNode();
      if (activeNode) {
        const computeMcpPath = new URL('./mcp-compute.js', import.meta.url).pathname;
        sdkOptions.mcpServers = {
          ...(sdkOptions.mcpServers || {}),
          'compute-tools': {
            command: 'node',
            args: [computeMcpPath],
          },
        };
        // Append compute node context to system prompt
        sdkOptions.appendSystemPrompt = [
          sdkOptions.appendSystemPrompt || '',
          '\n\n# Active Compute Node',
          `A remote compute node "${activeNode.name}" (${activeNode.user}@${activeNode.host}) is configured and available.`,
          `Type: ${activeNode.type === 'slurm' ? 'Slurm HPC cluster' : 'Direct GPU server'}.`,
          `Work directory: ${activeNode.workDir || '~'}.`,
          'When the user asks to run training, GPU tasks, or heavy computation, use the compute_* tools (compute_run, compute_sync, compute_slurm_submit, etc.) instead of local Bash.',
          'Use compute_sync direction="up" to upload project code before running, and compute_run to execute commands remotely.',
          'Use compute_info first if you need to check what GPU resources are available.',
        ].join('\n');
        console.log(`[claude-sdk] Compute MCP server injected for node "${activeNode.name}" (${activeNode.host})`);
      }
    } catch (err) {
      // Compute node not configured or error loading — skip silently
      console.log('[claude-sdk] No active compute node:', err.message);
    }

    // Handle images - save to temp files and modify prompt
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions') {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      ws.send({
        type: 'claude-permission-request',
        requestId,
        toolName,
        input,
        sessionId: capturedSessionId || sessionId || null
      });

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal: context?.signal,
        onCancel: (reason) => {
          ws.send({
            type: 'claude-permission-cancelled',
            requestId,
            reason,
            sessionId: capturedSessionId || sessionId || null
          });
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // Set stream-close timeout for interactive tools (Query constructor reads it synchronously). Claude Agent SDK has a default of 5s and this overrides it
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    const queryInstance = query({
      prompt: finalCommand,
      options: sdkOptions
    });

    // Restore immediately — Query constructor already captured the value
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Track the query instance for abort capability
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir);
    }

    // Process streaming messages
    // Track the latest assistant message's usage to get per-API-call context window usage
    let lastAssistantUsage = null;
    console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
    for await (const message of queryInstance) {
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir);

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          if (options.cwd || options.projectPath) {
            recordIndexedSession({
              sessionId: capturedSessionId,
              provider: 'claude',
              projectPath: options.cwd || options.projectPath,
              sessionMode: sessionMode || 'research',
              stageTagKeys,
              tagSource: stageTagSource,
            });
          }
          ws.send({
            type: 'session-created',
            sessionId: capturedSessionId,
            provider: 'claude',
            mode: sessionMode || 'research'
          });
        } else {
          console.log('Not sending session-created. sessionId:', sessionId, 'sessionCreatedSent:', sessionCreatedSent);
        }
      } else {
        console.log('No session_id in message or already captured. message.session_id:', message.session_id, 'capturedSessionId:', capturedSessionId);
      }

      // Track usage from assistant messages (per-API-call, not cumulative)
      if (message.type === 'assistant' && message.message?.usage) {
        lastAssistantUsage = message.message.usage;
      }

      // Detect SDK-level errors on assistant messages (e.g. rate_limit, authentication_failed)
      // These come as structured enum values, not in the catch block.
      if (message.type === 'assistant' && message.error) {
        const { errorType, isRetryable } = classifySDKError(message.error, 'claude');
        ws.send({
          type: 'claude-error',
          error: message.error,
          errorType,
          isRetryable,
          sessionId: capturedSessionId || sessionId || null,
        });
      }

      // Transform and send message to WebSocket
      const transformedMessage = transformMessage(message);
      const sessionData = capturedSessionId ? getSession(capturedSessionId) : null;
      ws.send({
        type: 'claude-response',
        data: {
          ...transformedMessage,
          startTime: sessionData?.startTime
        },
        sessionId: capturedSessionId || sessionId || null
      });

      if (
        capturedSessionId &&
        sessionProjectPath &&
        (message.type === 'assistant' || message.type === 'result')
      ) {
        scheduleClaudeSessionIndexReconcile(sessionProjectPath, capturedSessionId);
      }

      // Send token budget update when the turn completes
      if (message.type === 'result') {
        const tokenBudget = extractTokenBudgetFromUsage(lastAssistantUsage, options.model);
        if (tokenBudget) {
          console.log('Token budget from last assistant usage:', tokenBudget);
          ws.send({
            type: 'token-budget',
            data: tokenBudget,
            sessionId: capturedSessionId || sessionId || null
          });
        }
      }
    }

    // Send completion event before removing session to avoid race with abort requests
    console.log('Streaming complete, sending claude-complete event');
    ws.send({
      type: 'claude-complete',
      sessionId: capturedSessionId,
      exitCode: 0,
      isNewSession: !sessionId && !!command
    });
    console.log('claude-complete event sent');

    // Keep post-run housekeeping out of the completion critical path so the UI
    // can settle immediately after the model finishes streaming.
    const completionTasks = [];
    if (capturedSessionId) {
      removeSession(capturedSessionId);
      completionTasks.push(flushClaudeSessionIndexReconcile(sessionProjectPath, capturedSessionId));
    }
    completionTasks.push(cleanupTempFiles(tempImagePaths, tempDir));
    await Promise.allSettled(completionTasks);

  } catch (error) {
    console.error('SDK query error:', error);

    // Record session before cleanup so it appears in sidebar even on early errors
    if (capturedSessionId && !sessionId && !sessionCreatedSent && (options.cwd || options.projectPath)) {
      sessionCreatedSent = true;
      recordIndexedSession({
        sessionId: capturedSessionId,
        provider: 'claude',
        projectPath: options.cwd || options.projectPath,
        sessionMode: sessionMode || 'research',
      });
      ws.send({
        type: 'session-created',
        sessionId: capturedSessionId,
        provider: 'claude',
        mode: sessionMode || 'research',
      });
    }

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    const { errorType, isRetryable } = classifyError(error.message);

    ws.send({
      type: 'claude-error',
      error: error.message,
      errorType,
      isRetryable,
      sessionId: capturedSessionId || sessionId || null
    });

    const errorTasks = [];
    if (capturedSessionId) {
      errorTasks.push(flushClaudeSessionIndexReconcile(sessionProjectPath, capturedSessionId));
    }
    errorTasks.push(cleanupTempFiles(tempImagePaths, tempDir));
    await Promise.allSettled(errorTasks);

    throw error;
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`Aborting SDK session: ${sessionId}`);

    // interrupt() can hang if the subprocess is unresponsive; race against a timeout
    await Promise.race([
      session.instance.interrupt(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('interrupt timed out after 5s')), 5000))
    ]);

    session.status = 'aborted';
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    // Still clean up the session even if interrupt failed/timed out
    session.status = 'aborted';
    removeSession(sessionId);
    cleanupTempFiles(session.tempImagePaths, session.tempDir).catch(() => {});
    return false;
  }
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets the start time of an SDK session
 * @param {string} sessionId - Session identifier
 * @returns {number|null} Start time in ms or null
 */
function getClaudeSDKSessionStartTime(sessionId) {
  const session = getSession(sessionId);
  return session ? session.startTime : null;
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

const BTW_SYSTEM_PROMPT = `You answer a short side question for someone in the middle of a coding session.

Rules:
- You have NO tools. Do not claim to read files, run commands, or fetch URLs unless that information already appears in the conversation context below.
- Use the "Conversation context" section plus general programming knowledge. If something is not in the context, say you do not see it there.
- Be concise.`;

/**
 * One-shot, tool-free side question (Claude Code /btw-style). Does not resume the main SDK session.
 */
async function runClaudeBtw({ question, transcript, cwd, model, signal }) {
  const safeTranscript =
    typeof transcript === 'string' && transcript.trim()
      ? transcript
      : '(No prior conversation in this session.)';
  const userBlock = `## Conversation context\n\n${safeTranscript}\n\n---\n\n## Side question\n\n${question}`;

  const sdkOptions = {
    cwd: cwd || process.cwd(),
    model: model || CLAUDE_MODELS.DEFAULT,
    tools: [],
    allowedTools: [],
    settingSources: [],
    systemPrompt: BTW_SYSTEM_PROMPT,
    permissionMode: 'default',
  };

  const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
  process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '120000';

  let answer = '';
  let lastError = null;

  try {
    const queryInstance = query({
      prompt: userBlock,
      options: sdkOptions,
    });

    for await (const message of queryInstance) {
      if (signal?.aborted) {
        break;
      }
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          answer = message.result || answer;
        } else {
          lastError = Array.isArray(message.errors) ? message.errors.join('\n') : 'Side question failed';
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      return { answer: '' };
    }
    throw new Error(err?.message || String(err));
  } finally {
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }
  }

  if (signal?.aborted) {
    return { answer: '' };
  }

  if (lastError) {
    throw new Error(lastError);
  }

  return { answer: answer || '' };
}

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getClaudeSDKSessionStartTime,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getContextWindowForModel,
  runClaudeBtw,
};
