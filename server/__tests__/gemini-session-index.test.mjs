import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;
let activeDatabaseModule = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeTestDatabase() {
  if (!activeDatabaseModule?.db?.close) {
    return;
  }

  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      activeDatabaseModule.db.close();
      activeDatabaseModule = null;
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep(30 * attempt);
    }
  }
}

async function removeTempRootWithRetry(targetPath) {
  if (!targetPath) {
    return;
  }

  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EBUSY' || attempt === maxAttempts) {
        throw error;
      }
      await sleep(50 * attempt);
    }
  }
}

async function loadTestModules() {
  vi.resetModules();
  const projects = await import('../projects.js');
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  activeDatabaseModule = database;
  return { projects, database };
}

describe('Gemini API session indexing', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-gemini-index-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  });

  afterEach(async () => {
    await closeTestDatabase();

    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (tempRoot) {
      await removeTempRootWithRetry(tempRoot);
      tempRoot = null;
    }
  });

  it('discovers API-written Gemini sessions from ~/.gemini/sessions', async () => {
    const { projects } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'workspace', 'gemini-project');
    const sessionId = 'gemini-api-session-1';
    const sessionsDir = path.join(tempRoot, '.gemini', 'sessions');
    const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

    await mkdir(projectPath, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(sessionFile, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: sessionId,
          cwd: projectPath,
          timestamp: '2026-04-05T12:00:00.000Z',
          sessionMode: 'research',
          title: 'Explore Gemini API flow',
        },
        cwd: projectPath,
        timestamp: '2026-04-05T12:00:00.000Z',
        title: 'Explore Gemini API flow',
      }),
      JSON.stringify({
        type: 'message',
        role: 'user',
        content: 'Explore Gemini API flow',
        timestamp: '2026-04-05T12:00:01.000Z',
      }),
      JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: 'I inspected the repository.',
        timestamp: '2026-04-05T12:00:02.000Z',
      }),
      '',
    ].join('\n'), 'utf-8');

    const sessions = await projects.getGeminiSessions(projectPath, { limit: 5 });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(expect.objectContaining({
      id: sessionId,
      name: 'Explore Gemini API flow',
      mode: 'research',
      projectPath,
      messageCount: 2,
    }));
  });
});
