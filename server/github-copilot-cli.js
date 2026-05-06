import crypto from 'crypto';
import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { resolveAvailableCliCommand } from './utils/cliResolution.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { buildMemoryBlock } from './utils/memoryPrompt.js';
import { reconcileGitHubCopilotSessionIndex } from './projects.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

const SESSIONS_DIR = path.join(os.homedir(), '.dr-claw', 'github-copilot-sessions');
const activeGitHubCopilotSessions = new Map();

function clearCopilotHeartbeat(sessionId) {
  const activeSession = activeGitHubCopilotSessions.get(sessionId);
  if (activeSession?.heartbeat) {
    clearInterval(activeSession.heartbeat);
    activeSession.heartbeat = null;
  }
}

function terminateCopilotProcessTree(child, signal) {
  if (!child) {
    return;
  }

  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child if there is no separate process group.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // Ignore races where the process already exited.
  }
}

function sendCopilotStatus(ws, sessionId, startTime, status = 'Working...') {
  sendMessage(ws, {
    type: 'copilot-status',
    sessionId,
    data: {
      status,
      can_interrupt: true,
      startTime,
    },
  });
}

function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[github-copilot-cli] Failed to send message:', error.message);
  }
}

function buildSessionId() {
  return `copilot-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function getGitHubCopilotSessionsDir() {
  return SESSIONS_DIR;
}

async function appendSessionEntry(sessionId, entry) {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  await fs.appendFile(sessionFile, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function readSessionEntries(sessionId) {
  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  try {
    const raw = await fs.readFile(sessionFile, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeSessionEntries(sessionId, entries) {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
  await fs.writeFile(sessionFile, content ? `${content}\n` : '', 'utf8');
}

async function upsertAssistantSessionEntry(sessionId, entry) {
  const entries = await readSessionEntries(sessionId);
  const lastAssistantIndex = entries.findLastIndex(
    (existingEntry) => existingEntry?.role === 'assistant' && existingEntry?.kind === 'streaming-assistant',
  );

  if (lastAssistantIndex >= 0) {
    entries[lastAssistantIndex] = {
      ...entries[lastAssistantIndex],
      ...entry,
      role: 'assistant',
      kind: 'streaming-assistant',
    };
  } else {
    entries.push({
      ...entry,
      role: 'assistant',
      kind: 'streaming-assistant',
    });
  }

  await writeSessionEntries(sessionId, entries);
}

async function resolveCopilotCommand() {
  return resolveAvailableCliCommand({
    envVarName: 'GITHUB_COPILOT_CLI_PATH',
    legacyEnvVarNames: ['COPILOT_CLI_PATH'],
    defaultCommands: ['copilot'],
    appendWindowsSuffixes: true,
  });
}

function appendToolPermissionArgs(args, toolsSettings = {}, permissionMode = 'default') {
  const allowedTools = Array.isArray(toolsSettings.allowedTools) ? toolsSettings.allowedTools.filter(Boolean) : [];
  const disallowedTools = Array.isArray(toolsSettings.disallowedTools) ? toolsSettings.disallowedTools.filter(Boolean) : [];
  const skipPermissions = toolsSettings.skipPermissions || permissionMode === 'bypassPermissions';

  if (skipPermissions) {
    args.push('--allow-all');
    return;
  }

  if (allowedTools.length > 0) {
    args.push('--allow-tool', allowedTools.join(','));
  }

  if (disallowedTools.length > 0) {
    args.push('--deny-tool', disallowedTools.join(','));
  }
}

async function spawnGitHubCopilot(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const {
      sessionId: providedSessionId,
      projectPath,
      cwd,
      model,
      permissionMode = 'default',
      sessionMode,
      stageTagKeys,
      stageTagSource = 'task_context',
      toolsSettings,
      userId,
      env,
    } = options;

    const workingDir = cwd || projectPath || process.cwd();
    const copilotCommand = await resolveCopilotCommand();

    if (!copilotCommand) {
      const errorMessage = 'GitHub Copilot CLI not found. Install @github/copilot or set GITHUB_COPILOT_CLI_PATH.';
      sendMessage(ws, {
        type: 'copilot-error',
        error: errorMessage,
        sessionId: providedSessionId || null,
      });
      reject(new Error(errorMessage));
      return;
    }

    const sessionId = providedSessionId || buildSessionId();
    const startTime = Date.now();
    const memoryBlock = userId ? buildMemoryBlock(userId) : '';
    const prompt = `${memoryBlock}${command || 'Continue'}`.trim();
    const args = ['--add-dir', workingDir, '-s'];

    appendToolPermissionArgs(args, toolsSettings, permissionMode);
    if (model && model !== 'auto') {
      args.push('--model', String(model));
    }
    args.push('-p', prompt || 'Continue');

    if (providedSessionId && workingDir) {
      applyStageTagsToSession({
        sessionId,
        projectPath: workingDir,
        stageTagKeys,
        source: stageTagSource,
      });
    }

    recordIndexedSession({
      sessionId,
      provider: 'copilot',
      projectPath: workingDir,
      sessionMode: sessionMode || 'research',
      displayName: command ? String(command).trim().slice(0, 100) : 'GitHub Copilot Session',
      stageTagKeys,
      tagSource: stageTagSource,
    });

    await appendSessionEntry(sessionId, {
      ts: new Date(startTime).toISOString(),
      role: 'user',
      content: command || '',
      model: model || null,
      cwd: workingDir,
    });

    sendMessage(ws, {
      type: 'session-created',
      sessionId,
      provider: 'copilot',
      model: model || 'auto',
      cwd: workingDir,
      mode: sessionMode || 'research',
      startTime,
    });

    const child = spawnFunction(copilotCommand, args, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...(env || process.env) },
      detached: process.platform !== 'win32',
      shell: process.platform === 'win32',
    });

    const statusHeartbeat = setInterval(() => {
      sendCopilotStatus(ws, sessionId, startTime);
    }, 2000);

    activeGitHubCopilotSessions.set(sessionId, {
      process: child,
      startTime,
      heartbeat: statusHeartbeat,
      isAborting: false,
      killTimer: null,
    });

    sendCopilotStatus(ws, sessionId, startTime);

    let stdout = '';
    let stderr = '';
    let persistTimer = null;
    let persistPromise = Promise.resolve();

    const persistAssistantOutput = async (isFinal = false) => {
      if (!stdout && !isFinal) {
        return;
      }

      persistPromise = persistPromise
        .catch(() => {})
        .then(async () => {
          if (!stdout && !isFinal) {
            return;
          }

          await upsertAssistantSessionEntry(sessionId, {
            ts: new Date().toISOString(),
            content: stdout,
            model: model || null,
            partial: !isFinal,
          });
          await reconcileGitHubCopilotSessionIndex(workingDir, { sessionId });
        });

      return persistPromise;
    };

    const scheduleAssistantPersist = () => {
      if (persistTimer) {
        return;
      }
      persistTimer = setTimeout(() => {
        persistTimer = null;
        persistAssistantOutput(false).catch((error) => {
          console.warn('[github-copilot-cli] Failed to persist streaming output:', error.message);
        });
      }, 700);
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      scheduleAssistantPersist();
      sendMessage(ws, {
        type: 'copilot-response',
        sessionId,
        data: {
          type: 'content_block_delta',
          startTime,
          delta: {
            type: 'text_delta',
            text,
          },
        },
      });
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', async (code, signal) => {
      const activeSession = activeGitHubCopilotSessions.get(sessionId);
      const wasAborted = activeSession?.isAborting === true;
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      clearCopilotHeartbeat(sessionId);
      if (activeSession?.killTimer) {
        clearTimeout(activeSession.killTimer);
      }
      activeGitHubCopilotSessions.delete(sessionId);

      if (stdout) {
        await persistAssistantOutput(true);
      }

      if (stderr) {
        await appendSessionEntry(sessionId, {
          ts: new Date().toISOString(),
          role: 'system',
          kind: 'stderr',
          content: stderr,
        });
      }
  await persistPromise.catch(() => {});
  await reconcileGitHubCopilotSessionIndex(workingDir, { sessionId });

      sendMessage(ws, {
        type: 'copilot-response',
        sessionId,
        data: {
          type: 'content_block_stop',
          startTime,
        },
      });

      if (!wasAborted && stderr && code !== 0) {
        sendMessage(ws, {
          type: 'copilot-error',
          sessionId,
          error: stderr.trim() || `GitHub Copilot CLI exited with code ${code ?? signal ?? 'unknown'}`,
        });
      }

      if (!wasAborted) {
        sendMessage(ws, {
          type: 'copilot-complete',
          sessionId,
          provider: 'copilot',
          exitCode: code,
          isNewSession: !providedSessionId,
        });
      }

      if (wasAborted || code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `GitHub Copilot CLI exited with code ${code ?? signal ?? 'unknown'}`));
      }
    });

    child.on('error', async (error) => {
      clearCopilotHeartbeat(sessionId);
      activeGitHubCopilotSessions.delete(sessionId);
      await appendSessionEntry(sessionId, {
        ts: new Date().toISOString(),
        role: 'system',
        kind: 'error',
        content: error.message,
      });
      sendMessage(ws, {
        type: 'copilot-error',
        sessionId,
        error: error.message,
      });
      reject(error);
    });
  });
}

function abortGitHubCopilotSession(sessionId) {
  const sessionData = activeGitHubCopilotSessions.get(sessionId);
  if (sessionData?.process) {
    try {
      sessionData.isAborting = true;
      clearCopilotHeartbeat(sessionId);
      terminateCopilotProcessTree(sessionData.process, 'SIGINT');
      sessionData.killTimer = setTimeout(() => {
        if (!activeGitHubCopilotSessions.has(sessionId)) {
          return;
        }
        terminateCopilotProcessTree(sessionData.process, 'SIGKILL');
      }, 750);
      return true;
    } catch {
      activeGitHubCopilotSessions.delete(sessionId);
      return false;
    }
  }
  return false;
}

function isGitHubCopilotSessionActive(sessionId) {
  return activeGitHubCopilotSessions.has(sessionId);
}

function getGitHubCopilotSessionStartTime(sessionId) {
  return activeGitHubCopilotSessions.get(sessionId)?.startTime || null;
}

function getActiveGitHubCopilotSessions() {
  return Array.from(activeGitHubCopilotSessions.entries()).map(([sessionId, sessionData]) => ({
    sessionId,
    startTime: sessionData.startTime,
  }));
}

export {
  abortGitHubCopilotSession,
  getActiveGitHubCopilotSessions,
  getGitHubCopilotSessionStartTime,
  getGitHubCopilotSessionsDir,
  isGitHubCopilotSessionActive,
  resolveCopilotCommand,
  spawnGitHubCopilot,
};