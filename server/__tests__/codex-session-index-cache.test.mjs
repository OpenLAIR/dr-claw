import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, appendFile, readFile } from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';

/**
 * Regression tests for the Codex session index.
 *
 * Before the fix, buildCodexSessionsIndex() re-read and JSON.parse'd every line
 * of every transcript under ~/.codex/sessions on every call. With a realistic
 * multi-gigabyte session history that is tens of seconds of blocking work on the
 * main thread, repeated at least every 30 seconds — which is what made the app
 * lag, stall on "loading", and refuse to create new sessions.
 */

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;
const originalCodexHome = process.env.CODEX_HOME;

let tempRoot = null;
let projectRoot = null;

async function loadProjects() {
  vi.resetModules();
  const projects = await import('../projects.js');
  return projects;
}

function sessionLines({ sessionId, cwd, timestamp, userMessage }) {
  return [
    { timestamp, type: 'session_meta', payload: { id: sessionId, timestamp, cwd, model: 'gpt-5.6' } },
    { timestamp, type: 'event_msg', payload: { type: 'user_message', message: userMessage } },
    { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] } },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}

async function writeRollout({ sessionId, cwd, userMessage = 'hello', timestamp = '2026-06-09T11:00:00.000Z' }) {
  const sessionFile = path.join(
    tempRoot, '.codex', 'sessions', '2026', '06', '09',
    `rollout-2026-06-09T11-00-00-${sessionId}.jsonl`,
  );
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, sessionLines({ sessionId, cwd, timestamp, userMessage }), 'utf8');
  return sessionFile;
}

describe('Codex session index caching', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-codex-cache-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
    process.env.CODEX_HOME = path.join(tempRoot, '.codex');

    projectRoot = path.join(tempRoot, 'workspace', 'demo');
    await mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    process.env.DATABASE_PATH = originalDatabasePath;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    vi.restoreAllMocks();
  });

  it('does not re-read a transcript whose size and mtime are unchanged', async () => {
    await writeRollout({ sessionId: 'sess-a', cwd: projectRoot, userMessage: 'first prompt' });
    const { buildCodexSessionsIndex } = await loadProjects();

    const first = await buildCodexSessionsIndex();
    expect([...first.values()].flat()).toHaveLength(1);

    // Count file reads on the second pass only, so the cold pass is not counted.
    const createReadStream = vi.spyOn(fsSync, 'createReadStream');
    const second = await buildCodexSessionsIndex();

    expect(createReadStream).not.toHaveBeenCalled();
    expect([...second.values()].flat()).toHaveLength(1);
    expect([...second.values()].flat()[0].summary).toContain('first prompt');
  });

  it('parses only the appended tail when a transcript grows', async () => {
    const sessionFile = await writeRollout({ sessionId: 'sess-b', cwd: projectRoot, userMessage: 'first prompt' });
    const { buildCodexSessionsIndex } = await loadProjects();

    await buildCodexSessionsIndex();
    const sizeAfterFirstPass = (await readFile(sessionFile)).length;

    await appendFile(sessionFile, JSON.stringify({
      timestamp: '2026-06-09T12:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'second prompt' },
    }) + '\n', 'utf8');

    const createReadStream = vi.spyOn(fsSync, 'createReadStream');
    const index = await buildCodexSessionsIndex();

    expect(createReadStream).toHaveBeenCalledTimes(1);
    // The resumed read starts at the previously consumed offset, not at 0.
    expect(createReadStream.mock.calls[0][1]).toMatchObject({ start: sizeAfterFirstPass });

    const sessions = [...index.values()].flat();
    expect(sessions).toHaveLength(1);
    // Folded state carried across the incremental read: both the earlier and the
    // appended message are counted, and the summary reflects the newest prompt.
    expect(sessions[0].summary).toContain('second prompt');
    expect(sessions[0].messageCount).toBe(3);
  });

  it('matches a full re-parse after an incremental read', async () => {
    const sessionFile = await writeRollout({ sessionId: 'sess-c', cwd: projectRoot, userMessage: 'alpha' });
    const projects = await loadProjects();

    await projects.buildCodexSessionsIndex();
    await appendFile(sessionFile, JSON.stringify({
      timestamp: '2026-06-09T12:30:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'beta 请问大家有变卡的情况吗' },
    }) + '\n', 'utf8');

    const incremental = [...(await projects.buildCodexSessionsIndex()).values()].flat();

    projects.resetCodexSessionFileCache();
    const fullReparse = [...(await projects.buildCodexSessionsIndex()).values()].flat();

    expect(incremental).toEqual(fullReparse);
  });

  it('re-parses from scratch when a transcript is rewritten smaller', async () => {
    const sessionFile = await writeRollout({ sessionId: 'sess-d', cwd: projectRoot, userMessage: 'original prompt' });
    const { buildCodexSessionsIndex } = await loadProjects();

    await buildCodexSessionsIndex();

    // Simulate a rewrite/truncation rather than an append.
    await writeFile(sessionFile, sessionLines({
      sessionId: 'sess-d',
      cwd: projectRoot,
      timestamp: '2026-06-09T13:00:00.000Z',
      userMessage: 'rewritten',
    }), 'utf8');

    const sessions = [...(await buildCodexSessionsIndex()).values()].flat();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].summary).toContain('rewritten');
    // A stale accumulator would have double-counted the original messages.
    expect(sessions[0].messageCount).toBe(2);
  });

  it('re-parses a same-size rewrite instead of treating it as an append', async () => {
    // A rewrite that lands on an identical byte count is not growth. Resuming
    // from the cached offset would keep the stale prefix folded in and read
    // none of the new content.
    const sessionFile = await writeRollout({ sessionId: 'sess-g', cwd: projectRoot, userMessage: 'aaaaa' });
    const { buildCodexSessionsIndex } = await loadProjects();

    const before = [...(await buildCodexSessionsIndex()).values()].flat();
    expect(before[0].summary).toContain('aaaaa');
    const sizeBefore = fsSync.statSync(sessionFile).size;

    await writeFile(sessionFile, sessionLines({
      sessionId: 'sess-g',
      cwd: projectRoot,
      timestamp: '2026-06-09T14:00:00.000Z',
      userMessage: 'bbbbb', // same length as 'aaaaa' => same file size
    }), 'utf8');
    expect(fsSync.statSync(sessionFile).size).toBe(sizeBefore);

    const after = [...(await buildCodexSessionsIndex()).values()].flat();
    expect(after[0].summary).toContain('bbbbb');
    expect(after[0].messageCount).toBe(2);
  });

  it('includes a final record that has no trailing newline', async () => {
    const dir = path.join(tempRoot, '.codex', 'sessions', '2026', '06', '09');
    await mkdir(dir, { recursive: true });
    const sessionFile = path.join(dir, 'rollout-sess-h.jsonl');
    // Note: no terminating newline on the last record.
    await writeFile(sessionFile, [
      JSON.stringify({ timestamp: '2026-06-09T11:00:00.000Z', type: 'session_meta', payload: { id: 'sess-h', cwd: projectRoot, model: 'gpt-5.6' } }),
      JSON.stringify({ timestamp: '2026-06-09T11:01:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'unterminated tail' } }),
    ].join('\n'), 'utf8');

    const { buildCodexSessionsIndex } = await loadProjects();
    const sessions = [...(await buildCodexSessionsIndex()).values()].flat();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].summary).toContain('unterminated tail');
    expect(sessions[0].messageCount).toBe(1);
  });

  it('does not double-count a trailing record once it is terminated', async () => {
    const dir = path.join(tempRoot, '.codex', 'sessions', '2026', '06', '09');
    await mkdir(dir, { recursive: true });
    const sessionFile = path.join(dir, 'rollout-sess-i.jsonl');
    await writeFile(sessionFile, [
      JSON.stringify({ timestamp: '2026-06-09T11:00:00.000Z', type: 'session_meta', payload: { id: 'sess-i', cwd: projectRoot, model: 'gpt-5.6' } }),
      JSON.stringify({ timestamp: '2026-06-09T11:01:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'mid-write' } }),
    ].join('\n'), 'utf8');

    const { buildCodexSessionsIndex } = await loadProjects();
    const first = [...(await buildCodexSessionsIndex()).values()].flat();
    expect(first[0].messageCount).toBe(1);

    // The writer completes that line and appends nothing else.
    await appendFile(sessionFile, '\n', 'utf8');

    const second = [...(await buildCodexSessionsIndex()).values()].flat();
    expect(second[0].messageCount).toBe(1);
    expect(second[0].summary).toContain('mid-write');
  });

  it('finds a session with no cwd, which the project index cannot hold', async () => {
    const dir = path.join(tempRoot, '.codex', 'sessions', '2026', '06', '09');
    await mkdir(dir, { recursive: true });
    // Opaque filename AND no cwd: neither the basename match nor the project
    // index can resolve this, so the header scan has to.
    const sessionFile = path.join(dir, 'rollout-no-cwd.jsonl');
    await writeFile(sessionFile, [
      JSON.stringify({ timestamp: '2026-06-09T11:00:00.000Z', type: 'session_meta', payload: { id: 'sess-nocwd', model: 'gpt-5.6' } }),
      JSON.stringify({ timestamp: '2026-06-09T11:01:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'orphaned session' } }),
      JSON.stringify({ timestamp: '2026-06-09T11:02:00.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'still reachable' }] } }),
    ].join('\n') + '\n', 'utf8');

    const { getCodexSessionMessages, deleteCodexSession } = await loadProjects();

    const result = await getCodexSessionMessages('sess-nocwd');
    expect(result.messages.length).toBeGreaterThan(0);

    // Deleting must remove the transcript, not just a database row.
    await deleteCodexSession('sess-nocwd');
    expect(fsSync.existsSync(sessionFile)).toBe(false);
  });

  it('does not delete a transcript whose filename merely contains the id', async () => {
    const dir = path.join(tempRoot, '.codex', 'sessions', '2026', '06', '09');
    await mkdir(dir, { recursive: true });

    // Filename contains "abc123" as a substring but belongs to another session.
    const decoy = path.join(dir, 'rollout-abc1234567.jsonl');
    await writeFile(decoy, sessionLines({
      sessionId: 'abc1234567',
      cwd: projectRoot,
      timestamp: '2026-06-09T10:00:00.000Z',
      userMessage: 'do not touch me',
    }), 'utf8');

    const target = path.join(dir, 'rollout-opaque.jsonl');
    await writeFile(target, sessionLines({
      sessionId: 'abc123',
      cwd: projectRoot,
      timestamp: '2026-06-09T11:00:00.000Z',
      userMessage: 'delete me',
    }), 'utf8');

    const { deleteCodexSession } = await loadProjects();
    await deleteCodexSession('abc123');

    expect(fsSync.existsSync(decoy)).toBe(true);
    expect(fsSync.existsSync(target)).toBe(false);
  });

  it('drops cache entries for deleted transcripts', async () => {
    const sessionFile = await writeRollout({ sessionId: 'sess-e', cwd: projectRoot });
    const { buildCodexSessionsIndex } = await loadProjects();

    expect([...(await buildCodexSessionsIndex()).values()].flat()).toHaveLength(1);

    await rm(sessionFile);

    expect([...(await buildCodexSessionsIndex()).values()].flat()).toHaveLength(0);
  });

  it('resolves a session file by id without re-parsing every transcript', async () => {
    // Filename intentionally does NOT contain the session id, so the lookup has
    // to fall through to the index rather than the cheap basename match.
    const dir = path.join(tempRoot, '.codex', 'sessions', '2026', '06', '09');
    await mkdir(dir, { recursive: true });
    const sessionFile = path.join(dir, 'rollout-opaque-name.jsonl');
    await writeFile(sessionFile, sessionLines({
      sessionId: 'sess-lookup',
      cwd: projectRoot,
      timestamp: '2026-06-09T11:00:00.000Z',
      userMessage: 'find me',
    }), 'utf8');

    // Decoys the old implementation would also have parsed line by line.
    for (let i = 0; i < 5; i++) {
      await writeFile(path.join(dir, `rollout-decoy-${i}.jsonl`), sessionLines({
        sessionId: `decoy-${i}`,
        cwd: projectRoot,
        timestamp: '2026-06-09T10:00:00.000Z',
        userMessage: 'decoy',
      }), 'utf8');
    }

    const { buildCodexSessionsIndex, getCodexSessionMessages } = await loadProjects();
    await buildCodexSessionsIndex();

    const createReadStream = vi.spyOn(fsSync, 'createReadStream');
    const result = await getCodexSessionMessages('sess-lookup');

    expect(result.messages.length).toBeGreaterThan(0);
    // Only the resolved transcript is read — not the five decoys.
    const readPaths = new Set(createReadStream.mock.calls.map((call) => String(call[0])));
    expect([...readPaths]).toEqual([sessionFile]);
  });

  it('collapses concurrent scans onto a single pass', async () => {
    await writeRollout({ sessionId: 'sess-f', cwd: projectRoot });
    const { buildCodexSessionsIndex, resetCodexSessionFileCache } = await loadProjects();
    resetCodexSessionFileCache();

    const createReadStream = vi.spyOn(fsSync, 'createReadStream');
    const [a, b, c] = await Promise.all([
      buildCodexSessionsIndex(),
      buildCodexSessionsIndex(),
      buildCodexSessionsIndex(),
    ]);

    expect(createReadStream).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
