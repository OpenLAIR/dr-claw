import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;

async function loadTestModules() {
  vi.resetModules();
  const projects = await import('../projects.js');
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  return { projects, database };
}

// Mirrors how the Claude CLI currently derives ~/.claude/projects dir names.
// The resolver under test must NOT depend on this rule — it discovers
// directories through the cwd recorded in their jsonl files.
function cliEncode(projectPath) {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

async function writeClaudeSessionFile({ dirName, sessionId, cwd, userMessage = 'Hello' }) {
  const projectDir = path.join(tempRoot, '.claude', 'projects', dirName);
  await mkdir(projectDir, { recursive: true });

  const userUuid = `user-${sessionId}`;
  const lines = [
    {
      sessionId,
      type: 'user',
      uuid: userUuid,
      parentUuid: null,
      cwd,
      timestamp: '2026-06-09T10:00:00.000Z',
      message: { role: 'user', content: userMessage },
    },
    {
      sessionId,
      type: 'assistant',
      uuid: `assistant-${sessionId}`,
      parentUuid: userUuid,
      cwd,
      timestamp: '2026-06-09T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
  await writeFile(sessionFile, `${lines}\n`, 'utf8');
  return sessionFile;
}

async function writeProjectConfig(config) {
  const claudeDir = path.join(tempRoot, '.claude');
  await mkdir(claudeDir, { recursive: true });
  await writeFile(path.join(claudeDir, 'project-config.json'), JSON.stringify(config, null, 2), 'utf8');
}

describe('Claude CLI session directory resolution', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-dir-resolve-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();

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

  it('lists sessions for a project whose path contains non-ASCII characters', async () => {
    const projectPath = path.join(tempRoot, '项目', '子目录', 'demo');
    const cliDirName = cliEncode(projectPath);
    // dr-claw's own encoding keeps the Chinese characters, so the project name
    // never matches the CLI directory name.
    const sessionId = 'a1b2c3d4-0000-4000-8000-aaaaaaaaaaaa';

    await writeClaudeSessionFile({ dirName: cliDirName, sessionId, cwd: projectPath });

    const { projects } = await loadTestModules();
    const projectName = projects.encodeProjectPath(projectPath);
    expect(projectName).not.toBe(cliDirName);

    await writeProjectConfig({
      [projectName]: { manuallyAdded: true, originalPath: projectPath },
    });

    const result = await projects.getSessions(projectName, 5, 0);
    expect(result.total).toBe(1);
    expect(result.sessions[0].id).toBe(sessionId);
  });

  it('reads session messages across resolved directories', async () => {
    const projectPath = path.join(tempRoot, '项目', 'demo');
    const sessionId = 'a1b2c3d4-0000-4000-8000-bbbbbbbbbbbb';

    await writeClaudeSessionFile({
      dirName: cliEncode(projectPath),
      sessionId,
      cwd: projectPath,
      userMessage: 'Find my messages',
    });

    const { projects } = await loadTestModules();
    const projectName = projects.encodeProjectPath(projectPath);
    await writeProjectConfig({
      [projectName]: { manuallyAdded: true, originalPath: projectPath },
    });

    const messages = await projects.getSessionMessages(projectName, sessionId);
    expect(messages.length).toBe(2);
    expect(messages[0].message.content).toBe('Find my messages');
  });

  it('still lists sessions for directory-named (ASCII) projects', async () => {
    const projectPath = path.join(tempRoot, 'workspace', 'plain-project');
    const dirName = cliEncode(projectPath);
    const sessionId = '11111111-2222-4333-8444-555555555555';

    await writeClaudeSessionFile({ dirName, sessionId, cwd: projectPath });

    const { projects } = await loadTestModules();
    // Auto-discovered projects are named after the CLI directory itself.
    const result = await projects.getSessions(dirName, 5, 0);
    expect(result.total).toBe(1);
    expect(result.sessions[0].id).toBe(sessionId);
  });

  it('merges sessions from multiple directories that resolve to the same path', async () => {
    const projectPath = path.join(tempRoot, '项目', 'demo');
    const sessionA = 'aaaaaaaa-1111-4111-8111-111111111111';
    const sessionB = 'bbbbbbbb-2222-4222-8222-222222222222';

    // Two historic encodings of the same cwd (e.g. the CLI changed its naming rule)
    await writeClaudeSessionFile({ dirName: cliEncode(projectPath), sessionId: sessionA, cwd: projectPath });
    await writeClaudeSessionFile({ dirName: `${cliEncode(projectPath)}-legacy`, sessionId: sessionB, cwd: projectPath });

    const { projects } = await loadTestModules();
    const projectName = projects.encodeProjectPath(projectPath);
    await writeProjectConfig({
      [projectName]: { manuallyAdded: true, originalPath: projectPath },
    });

    const result = await projects.getSessions(projectName, 10, 0);
    const ids = result.sessions.map((session) => session.id).sort();
    expect(ids).toEqual([sessionA, sessionB]);
  });

  it('discovers a directory created after the index was built once the cache is cleared', async () => {
    const projectPath = path.join(tempRoot, '项目', 'fresh-project');
    const sessionId = 'cccccccc-3333-4333-8333-333333333333';

    const { projects } = await loadTestModules();
    const projectName = projects.encodeProjectPath(projectPath);
    await writeProjectConfig({
      [projectName]: { manuallyAdded: true, originalPath: projectPath },
    });

    // First lookup: no CLI directory exists yet, builds an index without it
    const before = await projects.getSessions(projectName, 5, 0);
    expect(before.total).toBe(0);

    await writeClaudeSessionFile({ dirName: cliEncode(projectPath), sessionId, cwd: projectPath });

    // The file watcher calls this when ~/.claude/projects changes
    projects.clearProjectDirectoryCache();

    const after = await projects.getSessions(projectName, 5, 0);
    expect(after.total).toBe(1);
    expect(after.sessions[0].id).toBe(sessionId);
  });

  it('reconciles a targeted session even when the directory is newer than the index', async () => {
    const projectPath = path.join(tempRoot, '项目', 'reconcile-project');
    const sessionId = 'dddddddd-4444-4444-8444-444444444444';

    const { projects, database } = await loadTestModules();
    const projectName = projects.encodeProjectPath(projectPath);
    await writeProjectConfig({
      [projectName]: { manuallyAdded: true, originalPath: projectPath },
    });

    // Build the index before the CLI creates the directory (stale-index scenario)
    await projects.getSessions(projectName, 5, 0);

    await writeClaudeSessionFile({ dirName: cliEncode(projectPath), sessionId, cwd: projectPath });

    // reconcileClaudeSessionIndex must retry with a fresh index instead of giving up
    const result = await projects.reconcileClaudeSessionIndex(projectName, sessionId);
    expect(result.session?.id).toBe(sessionId);

    const indexed = database.sessionDb.getSessionById(sessionId);
    expect(indexed?.provider).toBe('claude');
  });
});
