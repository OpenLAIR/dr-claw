import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';

/**
 * Session discovery for Pi. The transcript layout here matches real files
 * written by pi 0.83.0, including the directory-name encoding
 * (`/private/tmp/a/b` -> `--private-tmp-a-b--`) and the header-first JSONL.
 */

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot;
let projectRoot;

async function loadModules() {
  vi.resetModules();
  const projects = await import('../projects.js');
  const piCli = await import('../utils/piCli.js');
  return { projects, piCli };
}

function sessionLines({ sessionId, cwd, prompt = 'hello', reply = 'hi there', timestamp = '2026-08-05T19:00:00.000Z' }) {
  return [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd },
    { type: 'model_change', id: 'm1', parentId: null, timestamp, provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    { type: 'message', id: 'u1', parentId: 'm1', timestamp, message: { role: 'user', content: [{ type: 'text', text: prompt }] } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: reply }], stopReason: 'stop' } },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}

async function writeSession({ sessionId, cwd, prompt, reply, fileName }) {
  // Mirrors Pi's own directory naming.
  const dirName = `--${path.resolve(cwd).replace(/^\/+/, '').replace(/\//g, '-')}--`;
  const dir = path.join(tempRoot, '.pi', 'agent', 'sessions', dirName);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, fileName || `2026-08-05T19-00-00-000Z_${sessionId}.jsonl`);
  await writeFile(file, sessionLines({ sessionId, cwd, prompt, reply }), 'utf8');
  return file;
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'drclaw-pi-index-'));
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');

  projectRoot = path.join(tempRoot, 'workspace', 'demo');
  await mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.env.DATABASE_PATH = originalDatabasePath;
  vi.restoreAllMocks();
});

describe('encodePiSessionDirName', () => {
  it('matches the layout pi writes on disk', async () => {
    const { piCli } = await loadModules();
    // Captured from pi 0.83.0.
    expect(piCli.encodePiSessionDirName('/private/tmp/a/b')).toBe('--private-tmp-a-b--');
    expect(piCli.encodePiSessionDirName('/Users/me/project')).toBe('--Users-me-project--');
  });
});

describe('buildPiSessionsIndex', () => {
  it('groups sessions by the cwd recorded in the header', async () => {
    await writeSession({ sessionId: 'pi-1', cwd: projectRoot, prompt: 'first question' });
    const { projects } = await loadModules();

    const index = await projects.buildPiSessionsIndex();
    const sessions = [...index.values()].flat();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('pi-1');
    expect(sessions[0].summary).toBe('first question');
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[0].model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('trusts the header cwd over the directory name', async () => {
    // A path segment containing '-' is indistinguishable from a separator once
    // encoded, so the directory name alone cannot identify the project.
    const trickyPath = path.join(tempRoot, 'work-space', 'my-project');
    await mkdir(trickyPath, { recursive: true });
    await writeSession({ sessionId: 'pi-tricky', cwd: trickyPath });

    const { projects } = await loadModules();
    const sessions = await projects.getPiSessions(trickyPath, { limit: 0 });

    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('pi-tricky');
  });

  it('does not re-read transcripts whose size and mtime are unchanged', async () => {
    await writeSession({ sessionId: 'pi-cache', cwd: projectRoot });
    const { projects } = await loadModules();

    await projects.buildPiSessionsIndex();

    const createReadStream = vi.spyOn(fsSync, 'createReadStream');
    await projects.buildPiSessionsIndex();

    expect(createReadStream).not.toHaveBeenCalled();
  });

  it('drops cache entries for deleted transcripts', async () => {
    const file = await writeSession({ sessionId: 'pi-gone', cwd: projectRoot });
    const { projects } = await loadModules();

    expect([...(await projects.buildPiSessionsIndex()).values()].flat()).toHaveLength(1);
    await rm(file);
    expect([...(await projects.buildPiSessionsIndex()).values()].flat()).toHaveLength(0);
  });

  it('skips malformed transcripts without failing the whole scan', async () => {
    await writeSession({ sessionId: 'pi-good', cwd: projectRoot });
    const dirName = `--${path.resolve(projectRoot).replace(/^\/+/, '').replace(/\//g, '-')}--`;
    await writeFile(path.join(tempRoot, '.pi', 'agent', 'sessions', dirName, 'broken.jsonl'), '{not json\n', 'utf8');

    const { projects } = await loadModules();
    const sessions = [...(await projects.buildPiSessionsIndex()).values()].flat();

    expect(sessions.map((s) => s.id)).toEqual(['pi-good']);
  });
});

describe('getPiSessionMessages', () => {
  it('returns user and assistant turns in order', async () => {
    await writeSession({ sessionId: 'pi-msg', cwd: projectRoot, prompt: 'what is 2+2', reply: 'four' });
    const { projects } = await loadModules();

    const { messages, total } = await projects.getPiSessionMessages('pi-msg');

    expect(total).toBe(2);
    expect(messages[0]).toMatchObject({ type: 'user', message: { content: 'what is 2+2' } });
    expect(messages[1]).toMatchObject({ type: 'assistant', message: { content: 'four' } });
  });

  it('finds a session whose filename does not contain the id', async () => {
    await writeSession({ sessionId: 'pi-hidden', cwd: projectRoot, fileName: 'opaque-name.jsonl' });
    const { projects } = await loadModules();

    const { messages } = await projects.getPiSessionMessages('pi-hidden');
    expect(messages.length).toBeGreaterThan(0);
  });

  it('verifies the transcript header when another session id contains the requested id', async () => {
    await writeSession({
      sessionId: 'pi-msg-shadow',
      cwd: projectRoot,
      prompt: 'wrong transcript',
      fileName: '2026-08-05T18-00-00-000Z_pi-msg-shadow.jsonl',
    });
    await writeSession({
      sessionId: 'pi-msg',
      cwd: projectRoot,
      prompt: 'right transcript',
      fileName: 'opaque-name.jsonl',
    });
    const { projects } = await loadModules();

    const { messages } = await projects.getPiSessionMessages('pi-msg');

    expect(messages[0]).toMatchObject({ type: 'user', message: { content: 'right transcript' } });
  });

  it('returns empty rather than throwing for an unknown session', async () => {
    const { projects } = await loadModules();
    const result = await projects.getPiSessionMessages('does-not-exist');
    expect(result).toEqual({ messages: [], total: 0, hasMore: false });
  });
});

describe('deletePiSession', () => {
  it('removes the transcript from disk', async () => {
    const file = await writeSession({ sessionId: 'pi-del', cwd: projectRoot });
    const { projects } = await loadModules();
    const database = await import('../database/db.js');
    await database.initializeDatabase();

    expect(await projects.deletePiSession('demo', 'pi-del')).toBe(true);
    expect(fsSync.existsSync(file)).toBe(false);
  });

  it('reports false when nothing matched', async () => {
    const { projects } = await loadModules();
    const database = await import('../database/db.js');
    await database.initializeDatabase();

    expect(await projects.deletePiSession('demo', 'never-existed')).toBe(false);
  });
});
