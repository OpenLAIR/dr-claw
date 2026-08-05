import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Drives the real Pi provider code against a fake `pi` binary: a Node script
 * that speaks the same JSONL event stream the real CLI emits (captured from
 * pi 0.83.0). This keeps argv construction, stdin handling, stream parsing and
 * abort semantics under test without requiring Pi or any model credentials.
 */

let tmpDir;
let mod;

async function writeFakePi(name, body) {
  const file = path.join(tmpDir, name);
  await writeFile(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
}

// Reads the prompt from stdin (as the real CLI does) and echoes a full turn.
const FAKE_PI_HAPPY_PATH = `
import { readFileSync } from 'fs';
const prompt = readFileSync(0, 'utf8');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'session', version: 3, id: 'sess-from-pi', timestamp: '2026-08-05T19:00:00.000Z', cwd: process.cwd() });
out({ type: 'agent_start' });
out({ type: 'turn_start' });
out({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });
out({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' } });
out({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'world' } });
out({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'bash', args: { cmd: 'ls' } });
out({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'bash', result: 'file.txt', isError: false });
out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }], model: 'claude-sonnet-4-6', provider: 'anthropic', stopReason: 'stop', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 } } });
out({ type: 'turn_end', message: { role: 'assistant', content: [], stopReason: 'stop', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 } }, toolResults: [] });
out({ type: 'agent_end', messages: [] });
`;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'drclaw-pi-'));
  vi.resetModules();
  mod = await import('../pi-cli.js');
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function collectingWs() {
  const events = [];
  return {
    events,
    send: (msg) => events.push(msg),
    setSessionId: () => {},
    setProjectPath: () => {},
  };
}

describe('buildPiArgs', () => {
  it('requests the JSON event stream in non-interactive mode', () => {
    const args = mod.buildPiArgs({ sessionId: 'abc' });
    expect(args.slice(0, 3)).toEqual(['--mode', 'json', '-p']);
  });

  it('addresses the session by id so Dr. Claw owns session identity', () => {
    const args = mod.buildPiArgs({ sessionId: 'abc-123' });
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe('abc-123');
  });

  it('never puts the prompt in argv', () => {
    // Verified against pi 0.83.0: a positional "-rf ..." is parsed as a flag and
    // "@notes.md ..." as a file include, and pi has no `--` terminator. Both are
    // ordinary user input, so the prompt has to travel over stdin.
    const args = mod.buildPiArgs({ sessionId: 'abc', model: 'anthropic/claude-sonnet-4-6' });
    expect(args).not.toContain('--');
    expect(args.join(' ')).not.toContain('prompt');
    expect(args).toEqual(['--mode', 'json', '-p', '--session-id', 'abc', '--model', 'anthropic/claude-sonnet-4-6']);
  });

  it('passes model and thinking level through', () => {
    const args = mod.buildPiArgs({ sessionId: 'a', model: 'openai/gpt-5', thinking: 'high' });
    expect(args[args.indexOf('--model') + 1]).toBe('openai/gpt-5');
    expect(args[args.indexOf('--thinking') + 1]).toBe('high');
  });

  it('only trusts project-local files when permissions are skipped', () => {
    expect(mod.buildPiArgs({ sessionId: 'a' })).not.toContain('--approve');
    expect(mod.buildPiArgs({ sessionId: 'a', skipPermissions: true })).toContain('--approve');
  });
});

describe('transformPiEvent', () => {
  it('maps text deltas', () => {
    expect(mod.transformPiEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
    })).toEqual({ type: 'text_delta', delta: 'hi' });
  });

  it('ignores lifecycle chatter that has nothing to display', () => {
    for (const type of ['agent_start', 'turn_start', 'queue_update', 'auto_retry_start', 'agent_settled']) {
      expect(mod.transformPiEvent({ type })).toBeNull();
    }
  });

  it('suppresses an assistant message that stopped on error', () => {
    // The caller turns this into a pi-error; emitting it as a message too would
    // render an empty assistant bubble above the error.
    expect(mod.transformPiEvent({
      type: 'message_end',
      message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: '401' },
    })).toBeNull();
  });

  it('maps tool execution to tool_use / tool_result', () => {
    expect(mod.transformPiEvent({
      type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { cmd: 'ls' },
    })).toMatchObject({ type: 'tool_use', toolName: 'bash', toolInput: { cmd: 'ls' } });

    expect(mod.transformPiEvent({
      type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: 'out', isError: false,
    })).toMatchObject({ type: 'tool_result', output: 'out', isError: false });
  });
});

describe('buildPiTokenBudget', () => {
  it('normalizes Pi usage to the shared budget shape', () => {
    const budget = mod.buildPiTokenBudget({ input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165 });
    expect(budget).toMatchObject({ used: 165, inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5 });
  });

  it('falls back to summing components when totalTokens is absent', () => {
    expect(mod.buildPiTokenBudget({ input: 3, output: 4 }).used).toBe(7);
  });

  it('returns null for empty usage rather than a zeroed budget', () => {
    expect(mod.buildPiTokenBudget(null)).toBeNull();
    expect(mod.buildPiTokenBudget({ input: 0, output: 0 })).toBeNull();
  });
});

describe('spawnPi', () => {
  it('streams a full turn and completes', async () => {
    const fake = await writeFakePi('pi-happy.mjs', FAKE_PI_HAPPY_PATH);
    const ws = collectingWs();

    const result = await mod.spawnPi('say hi', {
      cwd: tmpDir,
      model: 'anthropic/claude-sonnet-4-6',
      env: { ...process.env, PI_CLI_PATH: fake },
    }, ws);

    const types = ws.events.map((e) => e.type);
    expect(types).toContain('session-created');
    expect(types).toContain('pi-complete');
    expect(types).not.toContain('pi-error');

    const responses = ws.events.filter((e) => e.type === 'pi-response').map((e) => e.data);
    expect(responses.filter((d) => d.type === 'text_delta').map((d) => d.delta)).toEqual(['Hello ', 'world']);
    expect(responses.some((d) => d.type === 'tool_use' && d.toolName === 'bash')).toBe(true);
    expect(responses.some((d) => d.type === 'tool_result' && d.output === 'file.txt')).toBe(true);
    expect(ws.events.some((e) => e.type === 'token-budget' && e.data.used === 15)).toBe(true);
    expect(result.sessionId).toBeTruthy();
  });

  it('delivers the prompt over stdin, intact, including @ and - prefixes', async () => {
    const capture = path.join(tmpDir, 'captured-prompt.txt');
    const fake = await writeFakePi('pi-capture.mjs', `
import { readFileSync, writeFileSync } from 'fs';
writeFileSync(${JSON.stringify(capture)}, readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify({ type: 'session', version: 3, id: 's', timestamp: '', cwd: process.cwd() }) + '\\n');
`);

    const prompt = '@notes.md -rf 请解释这段代码 🦞';
    await mod.spawnPi(prompt, { cwd: tmpDir, env: { ...process.env, PI_CLI_PATH: fake } }, collectingWs());

    expect(await readFile(capture, 'utf8')).toBe(prompt);
  });

  it('does not hang when the prompt is empty', async () => {
    // Pi blocks until stdin reaches EOF, so stdin must be closed even with
    // nothing to write.
    const fake = await writeFakePi('pi-empty.mjs', FAKE_PI_HAPPY_PATH);
    const ws = collectingWs();

    const started = Date.now();
    await mod.spawnPi('', { cwd: tmpDir, env: { ...process.env, PI_CLI_PATH: fake } }, ws);

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(ws.events.map((e) => e.type)).toContain('pi-complete');
  });

  it('surfaces a failed assistant turn as pi-error', async () => {
    const fake = await writeFakePi('pi-autherr.mjs', `
import { readFileSync } from 'fs';
readFileSync(0, 'utf8');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'session', version: 3, id: 's', timestamp: '', cwd: process.cwd() });
out({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: '401 invalid x-api-key' } });
out({ type: 'agent_end', messages: [] });
`);
    const ws = collectingWs();

    await mod.spawnPi('hi', { cwd: tmpDir, env: { ...process.env, PI_CLI_PATH: fake } }, ws);

    const error = ws.events.find((e) => e.type === 'pi-error');
    expect(error.error).toContain('401');
    // No empty assistant bubble alongside the error.
    expect(ws.events.filter((e) => e.type === 'pi-response')).toHaveLength(0);
  });

  it('reports stderr when the CLI dies before emitting any events', async () => {
    const fake = await writeFakePi('pi-crash.mjs', `
process.stderr.write('No models available. Use /login to log into a provider.\\n');
process.exit(1);
`);
    const ws = collectingWs();

    await mod.spawnPi('hi', { cwd: tmpDir, env: { ...process.env, PI_CLI_PATH: fake } }, ws);

    const error = ws.events.find((e) => e.type === 'pi-error');
    expect(error.error).toContain('No models available');
  });

  it('gives an actionable message when the CLI is not installed', async () => {
    const ws = collectingWs();

    await expect(mod.spawnPi('hi', {
      cwd: tmpDir,
      env: { ...process.env, PI_CLI_PATH: path.join(tmpDir, 'not-installed') },
    }, ws)).rejects.toThrow(/Pi CLI not found/);

    expect(ws.events.find((e) => e.type === 'pi-error').error).toContain('@earendil-works/pi-coding-agent');
  });

  it('emits exactly one terminal event when the CLI is missing', async () => {
    // 'error' and 'close' both fire on a failed spawn. The client must not
    // receive a pi-complete contradicting the pi-error it was just sent.
    const ws = collectingWs();

    await mod.spawnPi('hi', {
      cwd: tmpDir,
      env: { ...process.env, PI_CLI_PATH: path.join(tmpDir, 'absent') },
    }, ws).catch(() => {});

    // Give the 'close' event a chance to fire after 'error'.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(ws.events.filter((e) => e.type === 'pi-error')).toHaveLength(1);
    expect(ws.events.filter((e) => e.type === 'pi-complete')).toHaveLength(0);
  });

  it('ignores non-JSON output rather than failing the turn', async () => {
    const fake = await writeFakePi('pi-noise.mjs', `
import { readFileSync } from 'fs';
readFileSync(0, 'utf8');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdout.write('Checking for updates...\\n');
out({ type: 'session', version: 3, id: 's', timestamp: '', cwd: process.cwd() });
process.stdout.write('not json either\\n');
out({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'ok' } });
out({ type: 'agent_end', messages: [] });
`);
    const ws = collectingWs();

    await mod.spawnPi('hi', { cwd: tmpDir, env: { ...process.env, PI_CLI_PATH: fake } }, ws);

    expect(ws.events.map((e) => e.type)).toContain('pi-complete');
    expect(ws.events.some((e) => e.type === 'pi-error')).toBe(false);
  });

  it('keeps multi-byte text intact when a delta straddles a stdout chunk', async () => {
    const fake = await writeFakePi('pi-bytewise.mjs', `
import { readFileSync } from 'fs';
readFileSync(0, 'utf8');
const lines = [
  { type: 'session', version: 3, id: 's', timestamp: '', cwd: process.cwd() },
  { type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: '请问大家有变卡的情况吗 🦞' } },
  { type: 'agent_end', messages: [] },
].map((o) => JSON.stringify(o)).join('\\n') + '\\n';
for (const byte of Buffer.from(lines, 'utf8')) process.stdout.write(Buffer.from([byte]));
`);
    const ws = collectingWs();

    await mod.spawnPi('hi', { cwd: tmpDir, env: { ...process.env, PI_CLI_PATH: fake } }, ws);

    const delta = ws.events.find((e) => e.type === 'pi-response' && e.data.type === 'text_delta');
    expect(delta.data.delta).toBe('请问大家有变卡的情况吗 🦞');
    expect(delta.data.delta).not.toContain('�');
  });

  it('tracks and clears the active session', async () => {
    const fake = await writeFakePi('pi-happy.mjs', FAKE_PI_HAPPY_PATH);
    const result = await mod.spawnPi('hi', { cwd: tmpDir, env: { ...process.env, PI_CLI_PATH: fake } }, collectingWs());

    expect(mod.isPiSessionActive(result.sessionId)).toBe(false);
    expect(mod.getActivePiSessions()).toEqual([]);
  });

  it('reuses a provided session id instead of minting a new one', async () => {
    const fake = await writeFakePi('pi-happy.mjs', FAKE_PI_HAPPY_PATH);
    const ws = collectingWs();

    const result = await mod.spawnPi('hi', {
      cwd: tmpDir,
      sessionId: 'existing-session-id',
      env: { ...process.env, PI_CLI_PATH: fake },
    }, ws);

    expect(result.sessionId).toBe('existing-session-id');
    // Resuming must not announce a new session to the UI.
    expect(ws.events.some((e) => e.type === 'session-created')).toBe(false);
  });
});

describe('abortPiSession', () => {
  it('stops a running turn and reports it as aborted', async () => {
    const fake = await writeFakePi('pi-slow.mjs', `
import { readFileSync } from 'fs';
readFileSync(0, 'utf8');
process.stdout.write(JSON.stringify({ type: 'session', version: 3, id: 's', timestamp: '', cwd: process.cwd() }) + '\\n');
setTimeout(() => {}, 60000);
`);
    const ws = collectingWs();

    const pending = mod.spawnPi('hi', {
      cwd: tmpDir,
      sessionId: 'abort-me',
      env: { ...process.env, PI_CLI_PATH: fake },
    }, ws);

    // Wait for the child to actually start before aborting.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mod.isPiSessionActive('abort-me')).toBe(true);
    expect(mod.abortPiSession('abort-me')).toBe(true);

    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(ws.events.some((e) => e.type === 'pi-complete' && e.aborted)).toBe(true);
    // An abort is a user action, not a failure.
    expect(ws.events.some((e) => e.type === 'pi-error')).toBe(false);
  });

  it('returns false for an unknown session', () => {
    expect(mod.abortPiSession('never-existed')).toBe(false);
  });
});
