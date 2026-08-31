import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readlink, stat } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const codexWorkingDir = await import('../utils/codexWorkingDir.js');
  const projects = await import('../projects.js');
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  return { codexWorkingDir, projects, database };
}

function hasNonAscii(p) {
  return /[^\x00-\x7F]/.test(p);
}

async function writeCodexRollout({ sessionId, cwd, userMessage = 'Hello', timestamp = '2026-06-09T11:00:00.000Z' }) {
  const sessionFile = path.join(
    tempRoot, '.codex', 'sessions', '2026', '06', '09',
    `rollout-2026-06-09T11-00-00-${sessionId}.jsonl`,
  );
  await mkdir(path.dirname(sessionFile), { recursive: true });
  const lines = [
    { timestamp, type: 'session_meta', payload: { id: sessionId, timestamp, cwd, model: 'gpt-5.5' } },
    { timestamp, type: 'event_msg', payload: { type: 'user_message', message: userMessage } },
    { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] } },
  ].map((e) => JSON.stringify(e)).join('\n');
  await writeFile(sessionFile, `${lines}\n`, 'utf8');
  return sessionFile;
}

describe('Codex non-ASCII project path handling', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-codex-nonascii-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('returns ASCII project paths unchanged without creating a symlink', async () => {
    const { codexWorkingDir } = await loadModules();
    const asciiPath = path.join(tempRoot, 'workspace', 'plain-project');
    await mkdir(asciiPath, { recursive: true });

    const result = await codexWorkingDir.resolveCodexWorkingDirectory(asciiPath);
    expect(result).toBe(asciiPath);

    const shadowRoot = path.join(tempRoot, '.dr-claw', 'codex-cwd');
    await expect(stat(shadowRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('maps a non-ASCII project path to an ASCII symlink pointing at the real dir', async () => {
    const { codexWorkingDir } = await loadModules();
    const realPath = path.join(tempRoot, '项目', '子目录', 'demo');
    await mkdir(realPath, { recursive: true });

    const result = await codexWorkingDir.resolveCodexWorkingDirectory(realPath);

    expect(result).not.toBe(realPath);
    expect(hasNonAscii(result)).toBe(false);
    expect(codexWorkingDir.pathIsHeaderSafe(result)).toBe(true);

    const target = await readlink(result);
    expect(path.resolve(path.dirname(result), target)).toBe(path.resolve(realPath));

    // A marker created through the symlink lands in the real directory
    await writeFile(path.join(result, 'marker.txt'), 'ok', 'utf8');
    await expect(stat(path.join(realPath, 'marker.txt'))).resolves.toBeTruthy();
  });

  it('is idempotent and stable for the same path', async () => {
    const { codexWorkingDir } = await loadModules();
    const realPath = path.join(tempRoot, '项目', 'demo');
    await mkdir(realPath, { recursive: true });

    const first = await codexWorkingDir.resolveCodexWorkingDirectory(realPath);
    const second = await codexWorkingDir.resolveCodexWorkingDirectory(realPath);
    expect(second).toBe(first);
  });

  it('associates a Codex session recorded under the shadow symlink with the real project', async () => {
    const { codexWorkingDir, projects } = await loadModules();
    const realPath = path.join(tempRoot, '项目', '子目录', 'demo');
    await mkdir(realPath, { recursive: true });

    // The shadow symlink Codex would run inside
    const shadowPath = await codexWorkingDir.resolveCodexWorkingDirectory(realPath);
    expect(shadowPath).not.toBe(realPath);

    // Codex records the rollout with cwd = the shadow (symlink) path
    const sessionId = 'a1b2c3d4-0000-4000-8000-cccccccccccc';
    await writeCodexRollout({ sessionId, cwd: shadowPath, userMessage: 'Inspect the project' });

    // dr-claw queries by the REAL project path; realpath matching must connect them
    const sessions = await projects.getCodexSessions(realPath, { limit: 10 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId);
    expect(sessions[0].provider).toBe('codex');
  });
});
