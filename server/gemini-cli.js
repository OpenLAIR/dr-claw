import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createRequestId, waitForToolApproval, matchesToolPermission } from './utils/permissions.js';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeGeminiSessions = new Map(); // Track active sessions: { process, heartbeat, sessionId, options, sessionAllowedTools, sessionDisallowedTools }

/**
 * Ensures a session directory exists and creates a basic JSONL metadata file if it doesn't.
 * This helps VibeLab discover the session even if the CLI hasn't written to it yet.
 */
async function syncSessionMetadata(sessionId, projectPath) {
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
      const initialEntry = {
        type: 'session_meta',
        payload: {
          id: sessionId,
          cwd: projectPath,
          timestamp: new Date().toISOString()
        },
        cwd: projectPath, // Compatibility
        timestamp: new Date().toISOString()
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
    const { sessionId, projectPath, cwd, model, images, permissionMode, toolsSettings } = options;
    let capturedSessionId = sessionId;
    let sessionCreatedSent = false;
    let messageStartedSent = false;
    let contentBlockStarted = false;
    let currentBlockIndex = 0;
    let messageBuffer = '';
    
    const workingDir = cwd || projectPath || process.cwd();
    
    // Track allowed/disallowed tools locally for this session
    const sessionAllowedTools = [...(toolsSettings?.allowedTools || [])];
    const sessionDisallowedTools = [...(toolsSettings?.disallowedTools || [])];
    
    // Build Gemini CLI command
    const args = [];
    
    if (sessionId && !sessionId.startsWith('new-session-')) {
      args.push('--resume', sessionId);
    }

    if (command && command.trim()) {
      args.push('--prompt', command);

      if ((!sessionId || sessionId.startsWith('new-session-')) && model) {
        args.push('--model', model);
      }

      // CRITICAL FIX: Always use YOLO mode internally to ensure all tools (write_file, etc.)
      // are available and authorized even for sub-agents (generalist).
      // We handle the actual "approval" logic ourselves in the message stream.
      args.push('--approval-mode', 'yolo');

      const globalSkillsPath = path.join(process.cwd(), 'skills');
      args.push('--include-directories', globalSkillsPath);

      // Request streaming JSON output
      args.push('--output-format', 'stream-json');
    }
    
    const geminiCommand = process.env.GEMINI_CLI_PATH || 'gemini';

    const cleanEnv = { ...process.env };
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
    
    const statusHeartbeat = setInterval(() => {
      ws.send({
        type: 'gemini-status',
        data: { status: 'Working...', can_interrupt: true },
        sessionId: capturedSessionId || sessionId || null
      });
    }, 2000);

    const sessionData = {
      process: geminiProcess,
      heartbeat: statusHeartbeat,
      sessionId: capturedSessionId,
      options,
      sessionAllowedTools,
      sessionDisallowedTools
    };

    activeGeminiSessions.set(initialKey, sessionData);

    ws.send({
      type: 'gemini-status',
      data: { status: 'Working...', can_interrupt: true },
      sessionId: capturedSessionId || sessionId || null
    });

    const sendLifecycleStart = (id) => {
      if (!messageStartedSent) {
        messageStartedSent = true;
        ws.send({
          type: 'gemini-response',
          data: {
            type: 'message_start',
            message: { id: `msg_gemini_${Date.now()}`, role: 'assistant', content: [], model: model || 'gemini' }
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
          content_block: type === 'text' ? { type: 'text', text: '' } : { type: 'tool_use', id: `tool_${Date.now()}`, name: '', input: {} }
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

    const handleToolApproval = async (toolName, input, allowedTools = [], disallowedTools = []) => {
      // Internal bypass if UI mode is actually bypass
      if (permissionMode === 'bypassPermissions' || toolsSettings?.skipPermissions === true) return true;

      // Auto Edit Mode: Automatically approve editing tools
      if (permissionMode === 'acceptEdits') {
        const editTools = ['write_file', 'replace', 'insert_content', 'undo'];
        if (editTools.includes(toolName)) {
          console.log(`[Gemini] Auto-approving edit tool: ${toolName}`);
          return true;
        }
      }

      const isDisallowed = disallowedTools.some(entry => matchesToolPermission(entry, toolName, input));
      if (isDisallowed) return false;

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

      const decision = await waitForToolApproval(requestId);
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

    const processLine = async (line) => {
      if (!line.trim()) return;
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
              
              // Persist metadata to filesystem so VibeLab can discover it on refresh
              await syncSessionMetadata(capturedSessionId, workingDir);
              
              // NEW: If we have an initial command, save it now that we have a real SID
              if (command) {
                await appendToSessionFile(capturedSessionId, {
                  role: 'user',
                  content: command,
                  type: 'message'
                });
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
                ws.send({ type: 'session-created', sessionId: capturedSessionId, provider: 'gemini' });
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
                await appendToSessionFile(capturedSessionId || sessionId || initialKey, {
                  role: response.role,
                  content: response.content,
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
            const toolName = response.name || response.tool_name;
            const toolInput = response.parameters || response.input || response.arguments;
            const toolCallId = response.id || `tool_${Date.now()}`;

            await appendToSessionFile(capturedSessionId || sessionId || initialKey, {
              type: 'tool_use',
              toolName,
              toolInput,
              toolCallId
            });
            
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
              toolName, 
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
              const outputText = typeof response.output === 'string' ? response.output : JSON.stringify(response.output, null, 2);
              
              await appendToSessionFile(capturedSessionId || sessionId || initialKey, {
                type: 'tool_result',
                output: outputText,
                toolCallId: response.id || response.tool_use_id
              });
            }
            sendContentBlockStop(1);
            currentBlockIndex = 0;
            break;

          case 'result':
            if (messageBuffer && (capturedSessionId || sessionId)) {
              await appendToSessionFile(capturedSessionId || sessionId || initialKey, {
                role: 'assistant',
                content: messageBuffer,
                type: 'message'
              });
              messageBuffer = '';
            }
            break;
          case 'status':
            if (response.stats || response.status === 'completed') {
              if (response.stats) {
                ws.send({
                  type: 'token-budget',
                  data: { used: response.stats.total_tokens || response.stats.input_tokens + response.stats.output_tokens, total: 2000000 },
                  sessionId: capturedSessionId || sessionId || null
                });
              }
              sendContentBlockStop();
              ws.send({ type: 'gemini-response', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, sessionId: capturedSessionId || sessionId || null });
              ws.send({ type: 'gemini-response', data: { type: 'message_stop' }, sessionId: capturedSessionId || sessionId || null });
            }
            break;

          case 'error':
            ws.send({ type: 'gemini-error', error: response.message, sessionId: capturedSessionId || sessionId || null });
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
      if (/error|exception|fail|invalid|denied/i.test(errorOutput) && !/cached credentials/i.test(errorOutput)) {
        console.error(`[Gemini STDERR] ${errorOutput}`);
        ws.send({ type: 'gemini-error', error: errorOutput, sessionId: capturedSessionId || sessionId || null });
      }
    });
    
    geminiProcess.on('close', async (code) => {
      await processingQueue;
      if (messageBuffer && (capturedSessionId || sessionId || initialKey)) {
        await appendToSessionFile(capturedSessionId || sessionId || initialKey, {
          role: 'assistant',
          content: messageBuffer,
          type: 'message'
        });
        messageBuffer = '';
      }
      const finalSessionId = capturedSessionId || sessionId || initialKey;
      const sessionData = activeGeminiSessions.get(finalSessionId);
      if (sessionData?.heartbeat) clearInterval(sessionData.heartbeat);
      activeGeminiSessions.delete(finalSessionId);
      ws.send({ type: 'gemini-complete', sessionId: finalSessionId, exitCode: code, isNewSession: (!sessionId || sessionId.startsWith('new-session-')) && !!command });
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Gemini CLI exited with code ${code}`));
    });
    
    geminiProcess.on('error', (error) => {
      console.error('[Gemini] Process error:', error);
      const finalSessionId = capturedSessionId || sessionId || initialKey;
      const sessionData = activeGeminiSessions.get(finalSessionId);
      if (sessionData && sessionData.heartbeat) clearInterval(sessionData.heartbeat);
      activeGeminiSessions.delete(finalSessionId);
      ws.send({ type: 'gemini-error', error: error.message, sessionId: capturedSessionId || sessionId || null });
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
export function getActiveGeminiSessions() { return Array.from(activeGeminiSessions.keys()); }
