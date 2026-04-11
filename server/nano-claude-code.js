/**
 * Nano Claude Code provider — spawns the nano-claude-code CLI in stream-json harness mode.
 * Uses the same WebSocket shapes as Claude (claude-response / claude-complete) for UI reuse.
 *
 * Requires a nano-claude-code build that supports:
 *   --output-format stream-json -p "..." --dangerously-skip-permissions
 *   --session-file <path.json> and --resume <path.json> for multi-turn persistence (absolute path under ~/.dr-claw/nano-sessions)
 *   result lines may include nano_session_file (optional)
 * Install: https://github.com/OpenLAIR/nano-claude-code — pip install from that repo or use the published CLI name on PATH.
 */

import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import crypto from 'crypto';
import { encodeProjectPath, ensureProjectSkillLinks } from './projects.js';
import { writeProjectTemplates } from './templates/index.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { ensureNanoDrClawSessionsRoot, resolveNanoSessionAbsPath } from './nanoSessionPaths.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

const activeNanoSessions = new Map();

let nanoShutdownHooksInstalled = false;

function installNanoProcessShutdownHooks() {
  if (nanoShutdownHooksInstalled) {
    return;
  }
  nanoShutdownHooksInstalled = true;
  const shutdown = () => {
    for (const { process: childProc } of activeNanoSessions.values()) {
      try {
        if (childProc && !childProc.killed) {
          childProc.kill('SIGTERM');
        }
      } catch (_) {
        // ignore
      }
    }
    activeNanoSessions.clear();
  };
  process.on('exit', shutdown);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, shutdown);
  }
}

function resolveNanoCommand() {
  const explicit = String(
    process.env.NANO_CLAUDE_CODE_COMMAND || ''
  ).trim();
  if (explicit) {
    return explicit;
  }
  return 'nano-claude-code';
}

async function persistNanoSessionMetadata(sessionId, projectPath, sessionMode) {
  if (!sessionId || !projectPath) return;
  try {
    const { sessionDb } = await import('./database/db.js');
    sessionDb.upsertSession(
      sessionId,
      encodeProjectPath(projectPath),
      'nano',
      'Nano Claude Code Session',
      new Date().toISOString(),
      0,
      { sessionMode: sessionMode || 'research', projectPath },
    );
  } catch (error) {
    console.warn('[Nano] Failed to persist session metadata:', error.message);
  }
}

export async function spawnNanoClaudeCode(command, options = {}, ws) {
  installNanoProcessShutdownHooks();
  const {
    sessionId,
    projectPath,
    cwd,
    model,
    env,
    sessionMode,
    stageTagKeys,
    stageTagSource = 'task_context',
  } = options;

  const workingDir = cwd || projectPath || process.cwd();

  try {
    await writeProjectTemplates(workingDir);
    await ensureProjectSkillLinks(workingDir);
  } catch (error) {
    console.warn('[Nano] Project template setup:', error.message);
  }

  const streaming = String(
    process.env.NANO_CLAUDE_CODE_STREAMING || ''
  ).trim() === '1';

  const isPlaceholderSession =
    !sessionId ||
    String(sessionId).startsWith('new-session-');

  const capturedSessionId = isPlaceholderSession ? crypto.randomUUID() : String(sessionId);

  await ensureNanoDrClawSessionsRoot();
  const sessionAbsPath = resolveNanoSessionAbsPath(capturedSessionId);
  if (!sessionAbsPath) {
    const err = 'Invalid Nano Claude Code session id';
    ws.send({ type: 'claude-error', error: err, sessionId: null });
    return Promise.reject(new Error(err));
  }

  if (capturedSessionId && workingDir) {
    applyStageTagsToSession({
      sessionId: capturedSessionId,
      projectPath: workingDir,
      stageTagKeys,
      source: stageTagSource,
    });
  }

  if (isPlaceholderSession) {
    recordIndexedSession({
      sessionId: capturedSessionId,
      provider: 'nano',
      projectPath: workingDir,
      sessionMode: sessionMode || 'research',
      stageTagKeys,
      tagSource: stageTagSource,
    });
    ws.send({
      type: 'session-created',
      sessionId: capturedSessionId,
      provider: 'nano',
      mode: sessionMode || 'research',
      projectName: encodeProjectPath(workingDir),
    });
  }

  if (ws.setSessionId && typeof ws.setSessionId === 'function') {
    ws.setSessionId(capturedSessionId);
  }

  await persistNanoSessionMetadata(capturedSessionId, workingDir, sessionMode);

  const nanoCmd = resolveNanoCommand();
  const args = [
    '--output-format', 'stream-json',
    '-p', command,
    '--dangerously-skip-permissions',
    '--session-file', sessionAbsPath,
  ];
  if (!isPlaceholderSession) {
    args.push('--resume', sessionAbsPath);
  }
  if (streaming) {
    args.push('--streaming');
  }
  if (model) {
    args.push('--model', model);
  }

  console.log('[Nano] spawn:', nanoCmd, args.join(' '));
  console.log('[Nano] cwd:', workingDir);

  return new Promise((resolve, reject) => {
    const child = spawnFunction(nanoCmd, args, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...(env || process.env) },
    });

    activeNanoSessions.set(capturedSessionId, { process: child, startTime: Date.now() });

    const getSessionStartTime = () => activeNanoSessions.get(capturedSessionId)?.startTime;

    let stdoutBuf = '';

    child.stdout.on('data', (data) => {
      stdoutBuf += data.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const response = JSON.parse(t);
          switch (response.type) {
            case 'assistant':
              if (response.message) {
                ws.send({
                  type: 'claude-response',
                  data: {
                    type: 'assistant',
                    message: response.message,
                    startTime: getSessionStartTime(),
                  },
                  sessionId: capturedSessionId,
                });
              }
              break;
            case 'user':
              if (response.message) {
                ws.send({
                  type: 'claude-response',
                  data: {
                    type: 'user',
                    message: response.message,
                    startTime: getSessionStartTime(),
                  },
                  sessionId: capturedSessionId,
                });
              }
              break;
            case 'stream_delta':
              if (response.content && (response.delta_type === 'text' || response.delta_type === 'thinking')) {
                ws.send({
                  type: 'claude-response',
                  data: {
                    type: 'content_block_delta',
                    startTime: getSessionStartTime(),
                    delta: { type: 'text_delta', text: response.content },
                  },
                  sessionId: capturedSessionId,
                });
              }
              break;
            case 'result': {
              const u = response.usage || {};
              const input = Number(u.input_tokens) || 0;
              const output = Number(u.output_tokens) || 0;
              const cacheCreate = Number(u.cache_creation_input_tokens) || 0;
              const cacheRead = Number(u.cache_read_input_tokens) || 0;
              if (input || output || cacheCreate || cacheRead) {
                const total = parseInt(process.env.CONTEXT_WINDOW || process.env.VITE_CONTEXT_WINDOW || '200000', 10);
                ws.send({
                  type: 'token-budget',
                  data: {
                    used: input + output + cacheCreate + cacheRead,
                    total,
                    breakdown: {
                      input,
                      output,
                      cacheCreation: cacheCreate,
                      cacheRead,
                    },
                  },
                  sessionId: capturedSessionId,
                });
              }
              break;
            }
            default:
              break;
          }
        } catch {
          console.warn('[Nano] Ignoring non-JSON stdout line:', t.slice(0, 200));
        }
      }
    });

    child.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (!msg) return;
      console.error('[Nano] stderr:', msg);
      ws.send({
        type: 'claude-error',
        error: msg.slice(0, 2000),
        sessionId: capturedSessionId,
      });
    });

    child.on('close', async (code) => {
      activeNanoSessions.delete(capturedSessionId);
      ws.send({
        type: 'claude-complete',
        sessionId: capturedSessionId,
        exitCode: code,
        isNewSession: isPlaceholderSession && Boolean(command && String(command).trim()),
      });
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`nano-claude-code exited with code ${code}`));
      }
    });

    child.on('error', (error) => {
      activeNanoSessions.delete(capturedSessionId);
      ws.send({
        type: 'claude-error',
        error: error.message,
        sessionId: capturedSessionId,
      });
      reject(error);
    });
  });
}

export function abortNanoClaudeCodeSession(sessionId) {
  const sessionData = activeNanoSessions.get(sessionId);
  if (sessionData?.process) {
    console.log(`[Nano] Aborting session: ${sessionId}`);
    sessionData.process.kill('SIGTERM');
    activeNanoSessions.delete(sessionId);
    return true;
  }
  return false;
}

export function isNanoClaudeCodeSessionActive(sessionId) {
  return activeNanoSessions.has(sessionId);
}

export function getNanoClaudeCodeSessionStartTime(sessionId) {
  const sessionData = activeNanoSessions.get(sessionId);
  return sessionData ? sessionData.startTime : null;
}

export function getActiveNanoClaudeCodeSessions() {
  return Array.from(activeNanoSessions.keys());
}

/** Kill all in-flight Nano CLI children (e.g. before process exit). */
export function killAllNanoClaudeCodeChildren() {
  for (const { process: childProc } of activeNanoSessions.values()) {
    try {
      if (childProc && !childProc.killed) {
        childProc.kill('SIGTERM');
      }
    } catch (_) {
      // ignore
    }
  }
  activeNanoSessions.clear();
}
