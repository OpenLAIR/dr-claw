import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'stream';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { createAcpConnection } from '../utils/acpConnection.js';
import {
  acpModeForPermission,
  parseAgyModelsOutput,
  permissionNamesForCard,
  pickPermissionOptionId,
  resolveAcpModelId,
  resolveAntigravityBinary,
  shouldSkipPermissions,
  todosFromAcpPlan,
  tokenBudgetFromAcpUsage,
  toolCardForAcpCall,
  toolResultTextForAcpCall,
} from '../utils/antigravityAcp.js';

function pipePair() {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const sent = [];
  toAgent.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) sent.push(JSON.parse(line));
  });
  const emit = (message) => fromAgent.write(`${JSON.stringify(message)}\n`);
  return { toAgent, fromAgent, sent, emit };
}

describe('createAcpConnection', () => {
  it('matches responses to requests, even when split across chunks', async () => {
    const { toAgent, fromAgent, sent } = pipePair();
    const connection = createAcpConnection({ stdin: toAgent, stdout: fromAgent });
    const pending = connection.request('initialize', { protocolVersion: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(sent[0]).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
    fromAgent.write(line.slice(0, 10));
    fromAgent.write(`${line.slice(10)}\n`);
    await expect(pending).resolves.toEqual({ protocolVersion: 1 });
  });

  it('rejects with the JSON-RPC error and on close', async () => {
    const { toAgent, fromAgent, emit } = pipePair();
    const connection = createAcpConnection({ stdin: toAgent, stdout: fromAgent });
    const failing = connection.request('session/load', {});
    emit({ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'not found' } });
    await expect(failing).rejects.toMatchObject({ code: -32002, message: 'session/load: not found' });

    const hanging = connection.request('session/prompt', {});
    connection.close('agy exited');
    await expect(hanging).rejects.toThrow('agy exited');
    await expect(connection.request('x', {})).rejects.toThrow('agy exited');
  });

  it('routes notifications and answers agent requests', async () => {
    const { toAgent, fromAgent, sent, emit } = pipePair();
    const notifications = [];
    createAcpConnection({
      stdin: toAgent,
      stdout: fromAgent,
      onNotification: (method, params) => notifications.push([method, params]),
      onRequest: async (method) => {
        if (method === 'session/request_permission') return { outcome: { outcome: 'selected', optionId: 'allow' } };
        throw Object.assign(new Error('nope'), { code: -32601 });
      },
    });
    emit({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'plan' } } });
    emit({ jsonrpc: '2.0', id: '7', method: 'session/request_permission', params: {} });
    emit({ jsonrpc: '2.0', id: 8, method: 'fs/read_text_file', params: {} });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(notifications).toEqual([['session/update', { update: { sessionUpdate: 'plan' } }]]);
    expect(sent).toContainEqual({ jsonrpc: '2.0', id: '7', result: { outcome: { outcome: 'selected', optionId: 'allow' } } });
    expect(sent).toContainEqual({ jsonrpc: '2.0', id: 8, error: { code: -32601, message: 'nope' } });
  });
});

describe('antigravity helpers', () => {
  it('maps permission modes', () => {
    expect(acpModeForPermission('plan')).toBe('plan');
    expect(acpModeForPermission('acceptEdits')).toBe('accept-edits');
    expect(acpModeForPermission('default')).toBe('default');
    expect(shouldSkipPermissions('bypassPermissions')).toBe(true);
    expect(shouldSkipPermissions('default', { skipPermissions: true })).toBe(true);
    expect(shouldSkipPermissions('default', {})).toBe(false);
  });

  it('finds agy in an override, the installer location, then PATH', () => {
    expect(resolveAntigravityBinary({ env: { ANTIGRAVITY_CLI_PATH: '/opt/agy' }, exists: () => false })).toBe('/opt/agy');
    expect(resolveAntigravityBinary({ env: {}, homeDir: '/home/u', platform: 'darwin', exists: (p) => p === '/home/u/.local/bin/agy' })).toBe('/home/u/.local/bin/agy');
    expect(resolveAntigravityBinary({ env: {}, homeDir: '/home/u', platform: 'linux', exists: () => false })).toBe('agy');
  });

  it('picks agy model ids from Gemini API ids', () => {
    const models = [{ modelId: 'gemini-3.8-flash-high' }, { modelId: 'gemini-3.8-flash-low' }, { modelId: 'claude-sonnet-4-6' }];
    expect(resolveAcpModelId('claude-sonnet-4-6', models)).toBe('claude-sonnet-4-6');
    expect(resolveAcpModelId('gemini-3.8-flash', models)).toBe('gemini-3.8-flash-high');
    expect(resolveAcpModelId('gemini-2.5-pro', models)).toBeNull();
    expect(resolveAcpModelId(null, models)).toBeNull();
  });

  it('turns agy tool calls into Dr. Claw tool cards', () => {
    expect(toolCardForAcpCall({ name: 'run_command', rawInput: { CommandLine: 'ls -1', toolSummary: 'List files' } }))
      .toEqual({ name: 'Bash', input: { command: 'ls -1', description: 'List files' } });
    expect(toolCardForAcpCall({ name: 'write_file', rawInput: { Path: '/p/a.txt', Content: 'done\n' } }))
      .toEqual({ name: 'Write', input: { file_path: '/p/a.txt', content: 'done\n' } });
    expect(toolCardForAcpCall({ name: 'edit_file', rawInput: { Path: '/p/a.txt', Target: 'done', Replacement: 'finished' } }))
      .toEqual({ name: 'Edit', input: { file_path: '/p/a.txt', old_string: 'done', new_string: 'finished' } });
    expect(toolCardForAcpCall({ name: 'read_file', title: 'File .', rawInput: { Path: '/p' } })).toEqual({ name: 'LS', input: { path: '/p' } });
    expect(toolCardForAcpCall({ name: 'manage_task', rawInput: { Action: 'list' } })).toEqual({ name: 'manage_task', input: { Action: 'list' } });
  });

  it('reads tool results from content, diffs and raw output', () => {
    expect(toolResultTextForAcpCall({ content: [{ type: 'content', content: { type: 'text', text: 'Command exited with code 0.' } }] })).toBe('Command exited with code 0.');
    expect(toolResultTextForAcpCall({ content: [{ type: 'diff', path: '/p/a.txt' }] })).toBe('Updated /p/a.txt');
    expect(toolResultTextForAcpCall({ rawOutput: { output: 'hi' } })).toBe('hi');
    expect(toolResultTextForAcpCall({ status: 'failed' })).toBe('Tool call failed.');
  });

  it('maps plans, permission options, usage and legacy permission names', () => {
    expect(todosFromAcpPlan([{ content: 'Run tests', status: 'in_progress' }, { content: ' ' }]))
      .toEqual([{ content: 'Run tests', activeForm: 'Run tests', status: 'in_progress' }]);
    const options = [{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'always', kind: 'allow_always' }, { optionId: 'deny', kind: 'reject_once' }];
    expect(pickPermissionOptionId(options, { allow: true })).toBe('allow');
    expect(pickPermissionOptionId(options, { allow: true, remember: true })).toBe('always');
    expect(pickPermissionOptionId(options, { allow: false })).toBe('deny');
    expect(pickPermissionOptionId([], { allow: true })).toBeNull();
    expect(tokenBudgetFromAcpUsage({ inputTokens: 10, outputTokens: 5, cachedReadTokens: 2, totalTokens: 15 }, 1000))
      .toEqual({ used: 15, total: 1000, breakdown: { input: 10, output: 5, cacheCreation: 0, cacheRead: 2 } });
    expect(permissionNamesForCard('Bash')).toEqual(['Bash', 'run_shell_command']);
  });

  it('parses agy models output', () => {
    expect(parseAgyModelsOutput('Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n'))
      .toEqual([
        { value: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
      ]);
  });
});

// A stand-in for `agy acp` that speaks just enough ACP for one turn and logs
// every message it receives.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require('fs');
const log = process.env.FAKE_AGY_LOG;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const update = (sessionId, u) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } });
fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');
let buf = '';
let pendingPrompt = null;
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    fs.appendFileSync(log, line + '\\n');
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
    else if (m.method === 'session/new') send({ jsonrpc: '2.0', id: m.id, result: { sessionId: 'conv-new-1', models: { currentModelId: 'gemini-3.8-flash-high', availableModels: [{ modelId: 'gemini-3.8-flash-high' }, { modelId: 'gemini-3.8-flash-low' }] }, modes: { currentModeId: 'default' } } });
    else if (m.method === 'session/load') {
      update(m.params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OLD HISTORY' } });
      send({ jsonrpc: '2.0', id: m.id, result: { models: { currentModelId: 'gemini-3.8-flash-high', availableModels: [] }, modes: { currentModeId: 'default' } } });
    }
    else if (m.method === 'session/set_model' || m.method === 'session/set_mode') send({ jsonrpc: '2.0', id: m.id, result: {} });
    else if (m.method === 'session/prompt') {
      const sid = m.params.sessionId;
      pendingPrompt = m.id;
      update(sid, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking about it.' } });
      update(sid, { sessionUpdate: 'tool_call', toolCallId: 't1', name: 'run_command', kind: 'execute', status: 'pending', rawInput: { CommandLine: 'ls -1' } });
      send({ jsonrpc: '2.0', id: 'perm-1', method: 'session/request_permission', params: { sessionId: sid, toolCall: { toolCallId: 't1', name: 'run_command', rawInput: { CommandLine: 'ls -1' } }, options: [{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }] } });
    } else if (m.id === 'perm-1') {
      const allowed = m.result && m.result.outcome && m.result.outcome.optionId === 'allow';
      const sid = 'conv-new-1';
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: allowed ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: allowed ? 'a.txt' : 'denied' } }] });
      update(sid, { sessionUpdate: 'plan', entries: [{ content: 'List files', status: 'completed' }] });
      update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } });
      update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } });
      send({ jsonrpc: '2.0', id: pendingPrompt, result: { stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } } });
    }
  }
});
`;

describe('spawnGemini over ACP', () => {
  const originalEnv = { HOME: process.env.HOME, DATABASE_PATH: process.env.DATABASE_PATH, ANTIGRAVITY_CLI_PATH: process.env.ANTIGRAVITY_CLI_PATH, FAKE_AGY_LOG: process.env.FAKE_AGY_LOG };
  let tempRoot;
  let projectDir;
  let logFile;
  let spawnGemini;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agy-acp-'));
    projectDir = path.join(tempRoot, 'project');
    await mkdir(projectDir, { recursive: true });
    const fakeAgy = path.join(tempRoot, 'agy');
    await writeFile(fakeAgy, FAKE_AGY);
    await chmod(fakeAgy, 0o755);
    logFile = path.join(tempRoot, 'agy.log');
    await writeFile(logFile, '');
    process.env.HOME = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
    process.env.ANTIGRAVITY_CLI_PATH = fakeAgy;
    process.env.FAKE_AGY_LOG = logFile;
    vi.resetModules();
    const database = await import('../database/db.js');
    await database.initializeDatabase();
    ({ spawnGemini } = await import('../gemini-cli.js'));
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  const run = async (command, options) => {
    const messages = [];
    const ws = { send: (message) => messages.push(message), setSessionId: () => {} };
    await spawnGemini(command, { cwd: projectDir, env: { ...process.env }, ...options }, ws);
    const received = (await readFile(logFile, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { messages, received };
  };

  it('runs a turn, auto-allows tools from the allow list, and records the conversation', async () => {
    const { messages, received } = await run('list the files', {
      sessionId: 'new-session-1',
      model: 'gemini-3.8-flash',
      permissionMode: 'default',
      toolsSettings: { allowedTools: ['Bash(ls:*)'] },
    });

    expect(received[0].argv).toEqual(expect.arrayContaining(['acp']));
    expect(received[0].argv).not.toContain('--dangerously-skip-permissions');
    expect(received.find((m) => m.method === 'session/new').params.cwd).toBe(projectDir);
    // gemini-3.8-flash maps to agy's -high variant, which is already current.
    expect(received.some((m) => m.method === 'session/set_model')).toBe(false);
    expect(received.find((m) => m.id === 'perm-1').result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });

    expect(messages).toContainEqual({ type: 'session-created', sessionId: 'conv-new-1', provider: 'gemini', mode: 'research' });
    const toolUse = messages.find((m) => m.data?.content?.[0]?.type === 'tool_use' && m.data.content[0].name === 'Bash');
    expect(toolUse.data.content[0].input).toEqual({ command: 'ls -1', description: undefined });
    expect(messages.some((m) => m.data?.content?.[0]?.type === 'tool_result' && m.data.content[0].content === 'a.txt')).toBe(true);
    expect(messages.some((m) => m.data?.content?.[0]?.name === 'TodoWrite')).toBe(true);
    expect(messages.some((m) => m.data?.content?.[0]?.type === 'thinking')).toBe(true);
    const text = messages.filter((m) => m.data?.type === 'content_block_delta').map((m) => m.data.delta.text).join('');
    expect(text).toBe('Hello world');
    expect(messages).toContainEqual(expect.objectContaining({ type: 'token-budget', data: expect.objectContaining({ used: 120 }) }));
    expect(messages.at(-1)).toMatchObject({ type: 'gemini-complete', sessionId: 'conv-new-1', exitCode: 0 });

    const history = (await readFile(path.join(tempRoot, '.gemini', 'sessions', 'conv-new-1.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(history.map((entry) => entry.type)).toEqual(['session_meta', 'message', 'thinking', 'tool_use', 'tool_result', 'message', 'status']);
    expect(history[1]).toMatchObject({ role: 'user', content: 'list the files' });
    expect(history[5]).toMatchObject({ role: 'assistant', content: 'Hello world' });
  });

  it('denies blocked tools, skips history replay on resume, and passes bypass to agy', async () => {
    const denied = await run('again', {
      sessionId: 'conv-new-1',
      permissionMode: 'default',
      toolsSettings: { disallowedTools: ['run_shell_command'] },
    });
    expect(denied.received.some((m) => m.method === 'session/load' && m.params.sessionId === 'conv-new-1')).toBe(true);
    expect(denied.received.find((m) => m.id === 'perm-1').result.outcome.optionId).toBe('deny');
    const streamed = denied.messages.filter((m) => m.data?.type === 'content_block_delta').map((m) => m.data.delta.text).join('');
    expect(streamed).not.toContain('OLD HISTORY');
    expect(denied.messages.some((m) => m.type === 'session-created')).toBe(false);

    await writeFile(logFile, '');
    const bypass = await run('go', { sessionId: 'new-session-2', permissionMode: 'bypassPermissions' });
    expect(bypass.received[0].argv).toContain('--dangerously-skip-permissions');
    expect(bypass.received.some((m) => m.method === 'session/set_mode')).toBe(false);
  });

  it('switches mode for accept-edits and reports a missing agy clearly', async () => {
    const accept = await run('edit', { sessionId: 'new-session-3', permissionMode: 'acceptEdits', toolsSettings: { allowedTools: ['Bash(ls:*)'] } });
    expect(accept.received.find((m) => m.method === 'session/set_mode').params.modeId).toBe('accept-edits');

    process.env.ANTIGRAVITY_CLI_PATH = path.join(tempRoot, 'missing-agy');
    vi.resetModules();
    ({ spawnGemini } = await import('../gemini-cli.js'));
    const messages = [];
    await expect(spawnGemini('hi', { cwd: projectDir, env: { ...process.env } }, { send: (m) => messages.push(m) })).rejects.toThrow();
    expect(messages.find((m) => m.type === 'gemini-error').error).toMatch(/Antigravity CLI \(agy\) was not found/);
  });
});
