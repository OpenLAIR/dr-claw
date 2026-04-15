import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'fs/promises';
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

  it('short-circuits temporary Codex session ids without not-found warnings', async () => {
    const { projects } = await loadTestModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await projects.getCodexSessionMessages('new-session-12345');
    expect(result).toEqual({ messages: [], total: 0, hasMore: false });

    expect(
      warnSpy.mock.calls.some((args) =>
        String(args?.[0] || '').includes('Codex session file not found'),
      ),
    ).toBe(false);

    warnSpy.mockRestore();
  });

  it('invalidates cached Codex session file path when the source file is deleted', async () => {
    const { projects } = await loadTestModules();
    const sessionId = '019d3967-a181-7171-9e9f-7b73811c0d99';

    const sessionFile = await writeCodexSessionFile({
      relativePath: path.join('2026', '04', '12', 'rollout-mismatched-cache-test.jsonl'),
      sessionId,
      cwd: path.join(tempRoot, 'workspace', 'proj-cache'),
      userMessage: 'Cache locator test',
      assistantMessage: 'Cache locator reply',
    });

    const resolvedPath = await projects.resolveCodexSessionFilePath(sessionId);
    expect(resolvedPath).toBe(sessionFile);

    await unlink(sessionFile);
    const resolvedAfterDeletion = await projects.resolveCodexSessionFilePath(sessionId);
    expect(resolvedAfterDeletion).toBeNull();
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


  it('parses Codex history into session context inputs that survive reload', async () => {
    const sessionId = 'codex-session-context';
    const projectRoot = path.join(tempRoot, 'workspace', 'demo');
    const sessionDir = path.join(tempRoot, '.codex', 'sessions', '2026', '03', '30');
    const sessionFile = path.join(sessionDir, `rollout-2026-03-30T05-00-00-${sessionId}.jsonl`);

    await mkdir(sessionDir, { recursive: true });
    await writeFile(sessionFile, [
      JSON.stringify({
        timestamp: '2026-03-30T05:18:20.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: "sed -n '1,200p' src/components/chat/utils/sessionContextSummary.ts",
            workdir: projectRoot,
          }),
          call_id: 'call-read',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-30T05:18:21.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call-read',
          output: 'export const example = true;',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-30T05:18:22.000Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_end',
          call_id: 'call-read',
          cwd: projectRoot,
          parsed_cmd: [
            {
              type: 'read',
              cmd: "sed -n '1,200p' src/components/chat/utils/sessionContextSummary.ts",
              path: 'src/components/chat/utils/sessionContextSummary.ts',
            },
          ],
          aggregated_output: 'export const example = true;',
          exit_code: 0,
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-30T05:19:00.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'update_plan',
          arguments: JSON.stringify({
            plan: [
              { step: 'Normalize Codex history', status: 'in_progress' },
              { step: 'Expand session summary', status: 'pending' },
            ],
          }),
          call_id: 'call-plan',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-30T05:20:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: [
            '*** Begin Patch',
            '*** Update File: src/components/chat/utils/sessionContextSummary.ts',
            '*** Add File: docs/plan.md',
            '*** End Patch',
          ].join('\n'),
          call_id: 'call-patch',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-30T05:20:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'patch_apply_end',
          call_id: 'call-patch',
          stdout: 'Success. Updated the following files:\nM src/components/chat/utils/sessionContextSummary.ts\nA docs/plan.md\n',
          stderr: '',
          success: true,
          status: 'completed',
          changes: {
            [path.join(projectRoot, 'src/components/chat/utils/sessionContextSummary.ts')]: { type: 'update' },
            [path.join(projectRoot, 'docs/plan.md')]: { type: 'add' },
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-30T05:21:00.000Z',
        type: 'response_item',
        payload: {
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'search',
            query: 'Codex session context panel',
            queries: ['Codex session context panel'],
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-30T05:21:30.000Z',
        type: 'response_item',
        payload: {
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'open_page',
            url: 'https://developers.openai.com/api/docs',
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-30T05:22:00.000Z',
        type: 'response_item',
        payload: {
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'find_in_page',
            url: 'https://developers.openai.com/api/docs',
            pattern: 'session',
          },
        },
      }),
    ].join('\n'));

    const { projects } = await loadTestModules();
    const { convertSessionMessages } = await import('../../src/components/chat/utils/messageTransforms.ts');
    const { deriveSessionContextSummary } = await import('../../src/components/chat/utils/sessionContextSummary.ts');
    const result = await projects.getCodexSessionMessages(sessionId, null, 0);
    const summary = deriveSessionContextSummary(convertSessionMessages(result.messages), projectRoot);

    expect(summary.contextFiles.some((item) => item.relativePath === 'src/components/chat/utils/sessionContextSummary.ts')).toBe(true);
    expect(summary.outputFiles.map((item) => item.relativePath).sort()).toEqual([
      'docs/plan.md',
      'src/components/chat/utils/sessionContextSummary.ts',
    ]);
    expect(summary.tasks.some((item) => item.label === 'Normalize Codex history')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'Codex session context panel')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'https://developers.openai.com/api/docs')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'session')).toBe(true);
  });
});
