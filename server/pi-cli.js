/**
 * Pi Coding Agent Integration (https://pi.dev)
 * ============================================
 *
 * Pi is a minimal, MIT-licensed agent harness that fronts 15+ model providers.
 * Dr. Claw drives it non-interactively:
 *
 *   pi --mode json -p --session-id <uuid> --model <provider/id> <prompt>
 *
 * `--mode json` emits one JSON object per line: a session header first, then
 * agent/turn/message/tool events. `--session-id` addresses a session by id and
 * creates it if missing, which maps cleanly onto Dr. Claw's model of "a session
 * is a uuid" without needing Pi's interactive resume picker.
 *
 * Exports mirror the other providers so server/index.js can treat them alike:
 *   spawnPi(command, options, ws)
 *   abortPiSession(sessionId)
 *   isPiSessionActive(sessionId)
 *   getPiSessionStartTime(sessionId)
 *   getActivePiSessions()
 */

import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import crypto from 'crypto';
import { StringDecoder } from 'string_decoder';

import { getPiCliCommand } from './utils/piCli.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { classifyError } from '../shared/errorClassifier.js';

// cross-spawn resolves .cmd shims correctly on Windows.
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

const activePiSessions = new Map(); // sessionId -> { process, startTime, aborted }

/**
 * Split a stream into complete lines.
 *
 * StringDecoder rather than chunk.toString(): a multi-byte UTF-8 character can
 * straddle two 'data' events, and decoding each chunk independently turns it
 * into replacement characters — which for a CJK conversation means corrupting
 * the model's actual output.
 */
function createLineSplitter(onLine) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  return {
    push(chunk) {
      buffer += decoder.write(chunk);
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim()) onLine(line);
      }
    },
    flush() {
      buffer += decoder.end();
      const line = buffer.replace(/\r$/, '');
      buffer = '';
      if (line.trim()) onLine(line);
    },
  };
}

/** Concatenate the text blocks of a Pi message's content array. */
function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function extractThinking(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'thinking' && typeof block.thinking === 'string')
    .map((block) => block.thinking)
    .join('');
}

/**
 * Translate a Pi event into the payload Dr. Claw's chat UI consumes.
 *
 * Returns null for events with nothing to display — Pi emits a lot of
 * lifecycle chatter (queue updates, retry bookkeeping) that would only add
 * noise to the transcript.
 */
export function transformPiEvent(event) {
  if (!event || typeof event !== 'object') return null;

  switch (event.type) {
    case 'message_update': {
      // Incremental assistant text. Pi also emits thinking deltas; those are
      // surfaced separately so the UI can collapse them.
      const delta = event.assistantMessageEvent;
      if (delta?.type === 'text_delta' && typeof delta.delta === 'string' && delta.delta) {
        return { type: 'text_delta', delta: delta.delta };
      }
      if (delta?.type === 'thinking_delta' && typeof delta.delta === 'string' && delta.delta) {
        return { type: 'thinking_delta', delta: delta.delta };
      }
      return null;
    }

    case 'message_end': {
      const message = event.message;
      if (!message || message.role !== 'assistant') return null;

      // An assistant message that stopped on error carries no content; the
      // caller turns this into a pi-error rather than an empty bubble.
      if (message.stopReason === 'error') return null;

      const text = extractText(message.content);
      const thinking = extractThinking(message.content);
      if (!text.trim() && !thinking.trim()) return null;

      return {
        type: 'assistant_message',
        message: { role: 'assistant', content: text },
        thinking: thinking.trim() ? thinking : undefined,
        model: message.model,
        provider: message.provider,
      };
    }

    case 'tool_execution_start':
      return {
        type: 'tool_use',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        toolInput: event.args ?? {},
      };

    case 'tool_execution_end':
      return {
        type: 'tool_result',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: Boolean(event.isError),
        output: typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? null),
      };

    default:
      return null;
  }
}

/** Pi reports usage per assistant message; normalize to Dr. Claw's budget shape. */
export function buildPiTokenBudget(usage, contextWindow = null) {
  if (!usage || typeof usage !== 'object') return null;

  const used = Number(usage.totalTokens)
    || (Number(usage.input) || 0) + (Number(usage.output) || 0)
      + (Number(usage.cacheRead) || 0) + (Number(usage.cacheWrite) || 0);

  if (!used) return null;

  return {
    used,
    total: Number(contextWindow) || Number(process.env.CONTEXT_WINDOW) || 200000,
    inputTokens: Number(usage.input) || 0,
    outputTokens: Number(usage.output) || 0,
    cacheReadTokens: Number(usage.cacheRead) || 0,
    cacheCreationTokens: Number(usage.cacheWrite) || 0,
  };
}

/**
 * Build the argv for one non-interactive Pi run.
 *
 * Exported for tests: argv construction is where provider integrations
 * usually go wrong, and it is pure.
 */
export function buildPiArgs({ sessionId, model, thinking, skipPermissions, extraArgs = [] }) {
  const args = ['--mode', 'json', '-p'];

  if (sessionId) {
    // Addresses the session by id, creating it when absent. This lets Dr. Claw
    // own session identity instead of relying on Pi's "most recent" heuristics,
    // which would be wrong the moment two sessions run in one directory.
    args.push('--session-id', sessionId);
  }

  if (model) {
    args.push('--model', model);
  }

  if (thinking) {
    args.push('--thinking', thinking);
  }

  if (skipPermissions) {
    // Trust project-local extensions/skills for this run.
    args.push('--approve');
  }

  args.push(...extraArgs);

  // The prompt is deliberately NOT an argv entry — it is piped on stdin. Pi
  // parses positional arguments, and verified against pi 0.83.0:
  //   "-rf please"            -> Error: Unknown option: -rf please
  //   "@notes.md explain"     -> Error: File not found: .../notes.md explain
  // Pi has no `--` end-of-options terminator ("Error: Unknown option: --"), so
  // argv cannot carry an arbitrary user prompt safely. Both cases are ordinary
  // user input here, and '@' file mentions are a Dr. Claw feature, so a prompt
  // beginning with '@' is expected rather than exotic. Pi's documented stdin
  // piping accepts any bytes, so that is what we use.
  return args;
}

/**
 * Run one Pi turn, streaming events to the websocket writer.
 *
 * @param {string} command Prompt text.
 * @param {object} options { sessionId, projectPath, cwd, model, thinking, sessionMode, ... }
 * @param {object} ws Writer with .send()
 */
export async function spawnPi(command, options = {}, ws) {
  const {
    sessionId,
    projectPath,
    cwd,
    model,
    thinking,
    skipPermissions,
    sessionMode,
    stageTagKeys,
    stageTagSource = 'task_context',
    env,
  } = options;

  const workingDir = cwd || projectPath || process.cwd();
  const piCommand = getPiCliCommand(env || process.env);

  // Pi creates the session on demand for a --session-id it does not know, so we
  // can mint the id up front and report it immediately. The UI therefore has a
  // stable session to attach to before the model produces its first token.
  const effectiveSessionId = sessionId || crypto.randomUUID();
  const isNewSession = !sessionId;

  if (workingDir) {
    applyStageTagsToSession({
      sessionId: effectiveSessionId,
      projectPath: workingDir,
      stageTagKeys,
      source: stageTagSource,
    });
  }

  const args = buildPiArgs({ sessionId: effectiveSessionId, model, thinking, skipPermissions });

  return new Promise((resolve, reject) => {
    let piProcess;
    try {
      piProcess = spawnFunction(piCommand, args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...(env || process.env) },
      });
    } catch (error) {
      ws.send({
        type: 'pi-error',
        error: `Failed to start Pi CLI: ${error.message}`,
        sessionId: effectiveSessionId,
      });
      reject(error);
      return;
    }

    // Write the prompt and close stdin. Pi blocks until it sees EOF on stdin,
    // so the end() is mandatory even for an empty prompt — leaving the pipe open
    // hangs the turn forever with no output and a running timer, exactly the
    // symptom this app is trying to stop having.
    try {
      if (command && command.trim()) {
        piProcess.stdin?.write(command);
      }
      piProcess.stdin?.end();
    } catch (error) {
      // EPIPE if the child died between spawn and write; the 'error'/'close'
      // handlers below report it.
    }

    const startTime = Date.now();
    activePiSessions.set(effectiveSessionId, { process: piProcess, startTime, aborted: false });

    let settled = false;
    let stderrBuffer = '';
    let sawSessionHeader = false;
    let reportedError = null;
    let latestUsage = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      activePiSessions.delete(effectiveSessionId);
      fn(value);
    };

    try {
      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(effectiveSessionId);
      }
    } catch (error) {
      // A writer that throws here must not strand the child process or leave a
      // stale entry in activePiSessions.
      try { piProcess.kill(); } catch (_) { /* already gone */ }
      finish(reject, error);
      return;
    }

    const emitSessionCreated = (headerCwd) => {
      if (sawSessionHeader) return;
      sawSessionHeader = true;

      if (!isNewSession) return;

      recordIndexedSession({
        sessionId: effectiveSessionId,
        provider: 'pi',
        projectPath: headerCwd || workingDir,
        sessionMode: sessionMode || 'research',
        stageTagKeys,
        tagSource: stageTagSource,
      });

      ws.send({
        type: 'session-created',
        sessionId: effectiveSessionId,
        provider: 'pi',
        mode: sessionMode || 'research',
        startTime,
      });
    };

    const handleLine = (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch (_) {
        // Pi may print non-JSON notices before the stream begins.
        return;
      }

      if (event.type === 'session') {
        emitSessionCreated(event.cwd);
        return;
      }

      // An assistant turn that failed carries its cause in errorMessage rather
      // than in a dedicated error event.
      const failedMessage = (event.type === 'message_end' || event.type === 'turn_end')
        && event.message?.role === 'assistant'
        && event.message?.stopReason === 'error';

      if (failedMessage && !reportedError) {
        reportedError = event.message.errorMessage || 'Pi reported an error';
        const { errorType, isRetryable } = classifyError(reportedError);
        ws.send({
          type: 'pi-error',
          error: reportedError,
          errorType,
          isRetryable,
          sessionId: effectiveSessionId,
        });
        return;
      }

      if (event.message?.usage) {
        latestUsage = event.message.usage;
      }

      const transformed = transformPiEvent(event);
      if (transformed) {
        ws.send({ type: 'pi-response', data: transformed, sessionId: effectiveSessionId });
      }

      if (event.type === 'turn_end' && latestUsage) {
        const budget = buildPiTokenBudget(latestUsage);
        if (budget) {
          ws.send({ type: 'token-budget', data: budget, sessionId: effectiveSessionId });
        }
      }
    };

    const stdoutSplitter = createLineSplitter(handleLine);
    piProcess.stdout?.on('data', (chunk) => stdoutSplitter.push(chunk));

    piProcess.stderr?.on('data', (chunk) => {
      // Bounded so a noisy failure cannot grow this without limit.
      if (stderrBuffer.length < 16384) stderrBuffer += chunk.toString();
    });

    piProcess.on('error', (error) => {
      const message = error.code === 'ENOENT'
        ? `Pi CLI not found. Install it with "npm install -g --ignore-scripts @earendil-works/pi-coding-agent", or set PI_CLI_PATH.`
        : `Pi CLI failed to start: ${error.message}`;

      ws.send({ type: 'pi-error', error: message, sessionId: effectiveSessionId });
      finish(reject, new Error(message));
    });

    piProcess.on('close', (code) => {
      // 'error' and 'close' both fire when a spawn fails. The promise is already
      // guarded, but the websocket is not: without this the client would receive
      // a pi-complete (or a second pi-error) contradicting the failure it was
      // just told about.
      if (settled) return;

      stdoutSplitter.flush();

      const session = activePiSessions.get(effectiveSessionId);
      const wasAborted = Boolean(session?.aborted);

      if (wasAborted) {
        ws.send({ type: 'pi-complete', sessionId: effectiveSessionId, aborted: true });
        finish(resolve, { sessionId: effectiveSessionId, aborted: true });
        return;
      }

      if (code !== 0 && !reportedError) {
        // A non-zero exit with nothing on the event stream means Pi never got
        // far enough to report through JSON — surface stderr so the user sees
        // the actual cause (missing credentials, unknown model, ...).
        const message = stderrBuffer.trim() || `Pi CLI exited with code ${code}`;
        const { errorType, isRetryable } = classifyError(message);
        ws.send({
          type: 'pi-error',
          error: message,
          errorType,
          isRetryable,
          sessionId: effectiveSessionId,
        });
        finish(resolve, { sessionId: effectiveSessionId, error: message });
        return;
      }

      ws.send({
        type: 'pi-complete',
        sessionId: effectiveSessionId,
        actualSessionId: effectiveSessionId,
      });
      finish(resolve, { sessionId: effectiveSessionId });
    });
  });
}

export function abortPiSession(sessionId) {
  const session = activePiSessions.get(sessionId);
  if (!session) return false;

  session.aborted = true;
  try {
    session.process.kill('SIGTERM');
    // Escalate: a harness that traps SIGTERM would otherwise keep running with
    // its pipes attached long after the user pressed stop.
    const killTimer = setTimeout(() => {
      try { session.process.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }, 2000);
    killTimer.unref?.();
  } catch (error) {
    console.warn(`[Pi] Failed to abort session ${sessionId}:`, error.message);
    return false;
  }

  return true;
}

export function isPiSessionActive(sessionId) {
  return activePiSessions.has(sessionId);
}

export function getPiSessionStartTime(sessionId) {
  return activePiSessions.get(sessionId)?.startTime;
}

export function getActivePiSessions() {
  return Array.from(activePiSessions.entries()).map(([sessionId, session]) => ({
    sessionId,
    startTime: session.startTime,
  }));
}
