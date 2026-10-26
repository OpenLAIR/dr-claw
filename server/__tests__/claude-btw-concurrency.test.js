import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
vi.mock('../projects.js', () => ({
  encodeProjectPath: p => p, ensureProjectSkillLinks: vi.fn(), reconcileClaudeSessionIndex: vi.fn(),
}));
vi.mock('../templates/index.js', () => ({ writeProjectTemplates: vi.fn() }));
vi.mock('../utils/sessionIndex.js', () => ({
  applyStageTagsToSession: vi.fn(), recordIndexedSession: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { runClaudeBtw } from '../claude-sdk.js';

const request = { question: 'Why?', transcript: 'User: hello', cwd: '/tmp' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it('keeps concurrent side-question environments private even when they finish out of order', async () => {
  vi.stubEnv('CLAUDE_CODE_STREAM_CLOSE_TIMEOUT', 'original');
  const releases = [];
  query.mockImplementation(({ options }) => (async function* () {
    await new Promise(resolve => releases.push(resolve));
    yield { type: 'result', subtype: 'success', result: options.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT };
  })());

  const first = runClaudeBtw(request);
  const second = runClaudeBtw(request);
  expect(process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT).toBe('original');
  const environments = query.mock.calls.map(([arg]) => arg.options.env);
  expect(environments[0]).not.toBe(environments[1]);
  expect(environments[0].PATH).toBe(process.env.PATH);
  releases[1]();
  expect(await second).toEqual({ answer: '120000' });
  expect(process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT).toBe('original');
  releases[0]();
  expect(await first).toEqual({ answer: '120000' });
  expect(process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT).toBe('original');
});

it('does not alter the process environment when SDK construction throws', async () => {
  vi.stubEnv('CLAUDE_CODE_STREAM_CLOSE_TIMEOUT', undefined);
  query.mockImplementation(() => { throw new Error('spawn failed'); });
  await expect(runClaudeBtw(request)).rejects.toThrow('spawn failed');
  expect(process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT).toBeUndefined();
});

it('cancels the SDK while waiting for the next message', async () => {
  const controller = new AbortController();
  query.mockImplementation(({ options }) => (async function* () {
    await new Promise((resolve, reject) => {
      options.abortController.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
  })());
  const pending = runClaudeBtw({ ...request, signal: controller.signal });
  controller.abort();
  await expect(pending).resolves.toEqual({ answer: '' });
});

it('does not start a query for an already-cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await runClaudeBtw({ ...request, signal: controller.signal })).toEqual({ answer: '' });
  expect(query).not.toHaveBeenCalled();
});
