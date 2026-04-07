/**
 * Nano Claw Code provider — spawns the nano-claw-code CLI in stream-json harness mode.
 * Uses the same WebSocket shapes as Claude (claude-response / claude-complete) for UI reuse.
 *
 * Requires a nano-claw-code build that supports:
 *   --output-format stream-json -p "..." --dangerously-skip-permissions
 *   --session-file <name.json> and --resume <name.json> for multi-turn persistence
 *   result lines may include nano_session_file (optional)
 * Install: https://github.com/OpenLAIR/nano-claw-code — use main after the harness session patches land, or pip install -e from that repo.
 */

import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import crypto from 'crypto';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileClaudeSessionIndex } from './projects.js';
import { writeProjectTemplates } from './templates/index.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

const activeNanoSessions = new Map();

function resolveNanoCommand() {
  const explicit = String(process.env.NANO_CLAW_CODE_COMMAND || '').trim();
  if (explicit) {
    return explicit;
  }
  return 'nano-claw-code';
}

function sessionFileBasename(sessionId) {
  const safe = String(sessionId || '').replace(/[^a-zA-Z0-9._-]/g, '');
  return safe ? `drclaw-nano-${safe}.json` : null;
}

async function persistNanoSessionMetadata(sessionId, projectPath, sessionMode) {
  if (!sessionId || !projectPath) return;
  try {
    const { sessionDb } = await import('./database/db.js');
    sessionDb.upsertSession(
      sessionId,
      encodeProjectPath(projectPath),
      'nano',
      'Nano Claw Code Session',
      new Date().toISOString(),
      0,
      { sessionMode: sessionMode || 'research' },
    );
  } catch (error) {
    console.warn('[Nano] Failed to persist session metadata:', error.message);
  }
}

export async function spawnNanoClawCode(command, options = {}, ws) {
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

  const streaming = String(process.env.NANO_CLAW_CODE_STREAMING || '').trim() === '1';

  const isPlaceholderSession =
    !sessionId ||
    String(sessionId).startsWith('new-session-');

  const capturedSessionId = isPlaceholderSession ? crypto.randomUUID() : String(sessionId);
  const sessionFile = sessionFileBasename(capturedSessionId);

  if (!sessionFile) {
    const err = 'Invalid Nano Claw Code session id';
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
    '--session-file', sessionFile,
  ];
  if (!isPlaceholderSession) {
    args.push('--resume', sessionFile);
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
      try {
        await reconcileClaudeSessionIndex(encodeProjectPath(workingDir), capturedSessionId);
      } catch (error) {
        console.warn('[Nano] Session index reconcile:', error.message);
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`nano-claw-code exited with code ${code}`));
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

export function abortNanoClawCodeSession(sessionId) {
  const sessionData = activeNanoSessions.get(sessionId);
  if (sessionData?.process) {
    console.log(`[Nano] Aborting session: ${sessionId}`);
    sessionData.process.kill('SIGTERM');
    activeNanoSessions.delete(sessionId);
    return true;
  }
  return false;
}

export function isNanoClawCodeSessionActive(sessionId) {
  return activeNanoSessions.has(sessionId);
}

export function getNanoClawCodeSessionStartTime(sessionId) {
  const sessionData = activeNanoSessions.get(sessionId);
  return sessionData ? sessionData.startTime : null;
}

export function getActiveNanoClawCodeSessions() {
  return Array.from(activeNanoSessions.keys());
}
