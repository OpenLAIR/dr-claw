import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;
let loadedDatabase = null;

async function loadTestModules() {
  vi.resetModules();
  const projects = await import('../projects.js');
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  loadedDatabase = database;
  return { projects, database };
}

async function writeCodexSessionFile({
  relativePath,
  sessionId,
  cwd = '/tmp/test-project',
  userMessage = 'Hello from Codex',
  assistantMessage = 'Hi there',
  timestamp = '2026-03-30T11:00:00.000Z',
}) {
  const sessionFile = path.join(tempRoot, '.codex', 'sessions', relativePath);
  await mkdir(path.dirname(sessionFile), { recursive: true });

  const lines = [
    {
      timestamp,
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp,
        cwd,
        model: 'gpt-5.4',
      },
    },
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: userMessage,
      },
    },
    {
      timestamp,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: assistantMessage }],
      },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n');

  await writeFile(sessionFile, `${lines}\n`, 'utf8');
  return sessionFile;
}

describe('session deletion fallbacks', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-session-delete-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  });

  afterEach(async () => {
    try {
      loadedDatabase?.closeDatabase?.();
    } finally {
      loadedDatabase = null;
      vi.resetModules();
    }

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('deletes a Claude session from the index when the project directory is missing', async () => {
    const { projects, database } = await loadTestModules();
    const projectName = 'tmp-project';
    const sessionId = 'claude-session-missing-file';

    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'claude');
    expect(database.sessionDb.getSessionById(sessionId)?.provider).toBe('claude');

    await expect(projects.deleteSession(projectName, sessionId, 'claude')).resolves.toBe(true);
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });

  it('deletes a Gemini session from the index when the jsonl file is missing', async () => {
    const { projects, database } = await loadTestModules();
    const projectName = 'tmp-project';
    const sessionId = 'gemini-session-missing-file';

    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'gemini');
    expect(database.sessionDb.getSessionById(sessionId)?.provider).toBe('gemini');

    await expect(projects.deleteSession(projectName, sessionId, 'gemini')).resolves.toBe(true);
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });

  it('deletes a Codex session from the index when the jsonl file is missing', async () => {
    const { projects, database } = await loadTestModules();
    const projectName = 'tmp-project';
    const sessionId = 'codex-session-missing-file';

    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'codex');
    expect(database.sessionDb.getSessionById(sessionId)?.provider).toBe('codex');

    await expect(projects.deleteCodexSession(sessionId)).resolves.toBe(true);
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });

  it('reads Codex session messages by embedded metadata when the filename lookup key differs', async () => {
    const { projects } = await loadTestModules();
    const sessionId = '019d3967-fcdc-7501-8441-f443c81e2de0';

    await writeCodexSessionFile({
      relativePath: path.join('2026', '03', '30', 'rollout-2026-03-30T07-43-29-mismatched-name.jsonl'),
      sessionId,
      cwd: path.join(tempRoot, 'workspace', 'proj-a'),
      userMessage: 'Hello from regression test',
      assistantMessage: 'Codex responded successfully',
    });

    const result = await projects.getCodexSessionMessages(sessionId);
    expect(result.messages.length).toBeGreaterThanOrEqual(1);

    const assistantMessages = result.messages.filter((entry) => entry?.message?.role === 'assistant');

    expect(assistantMessages.some((entry) => entry.message.content.includes('Codex responded successfully'))).toBe(true);
  });

  it('indexes Codex sessions using the real session id from metadata', async () => {
    const { projects } = await loadTestModules();
    const sessionId = '019d3967-a181-7171-9e9f-7b73811c0d71';
    const projectPath = path.join(tempRoot, 'workspace', 'proj-b');

    await writeCodexSessionFile({
      relativePath: path.join('2026', '03', '30', `rollout-2026-03-30T07-43-06-${sessionId}.jsonl`),
      sessionId,
      cwd: projectPath,
      userMessage: 'Inspect the project state',
      assistantMessage: 'I found the pipeline files',
    });

    const sessions = await projects.getCodexSessions(projectPath, { limit: 10 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId);
    expect(sessions[0].provider).toBe('codex');
    expect(sessions[0].summary).toContain('Inspect the project state');
  });
});
