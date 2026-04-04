import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
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
});
