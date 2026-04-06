import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadableStream } from 'node:stream/web';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

const ensureProjectSkillLinks = vi.fn();
const reconcileGeminiSessionIndex = vi.fn();
const writeProjectTemplates = vi.fn();
const applyStageTagsToSession = vi.fn();
const recordIndexedSession = vi.fn();
const getGeminiAuthHeaders = vi.fn();
const buildGeminiThinkingConfig = vi.fn();
const spawnGemini = vi.fn();

vi.mock('../projects.js', () => ({
  encodeProjectPath: (projectPath) => `encoded:${projectPath}`,
  ensureProjectSkillLinks,
  reconcileGeminiSessionIndex,
}));

vi.mock('../templates/index.js', () => ({
  writeProjectTemplates,
}));

vi.mock('../../shared/errorClassifier.js', () => ({
  classifyError: (message) => ({
    errorType: String(message || '').includes('auth') ? 'auth' : 'api',
    isRetryable: false,
  }),
}));

vi.mock('../utils/sessionIndex.js', () => ({
  applyStageTagsToSession,
  recordIndexedSession,
}));

vi.mock('../utils/permissions.js', async () => {
  const actual = await vi.importActual('../utils/permissions.js');
  return {
    ...actual,
    waitForToolApproval: vi.fn(),
  };
});

vi.mock('../utils/geminiOAuth.js', () => ({
  getGeminiAuthHeaders,
}));

vi.mock('../gemini-cli.js', () => ({
  spawnGemini,
}));

vi.mock('../../shared/geminiThinkingSupport.js', () => ({
  buildGeminiThinkingConfig,
}));

const encoder = new TextEncoder();
const originalRetryBaseMs = process.env.GEMINI_API_RETRY_BASE_MS;
const originalRetryMaxAttempts = process.env.GEMINI_API_MAX_ATTEMPTS;

function makeSseResponse(lines) {
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines.join('\n')));
        controller.close();
      },
    }),
  };
}

function createTestWriter() {
  const sent = [];
  return {
    sent,
    writer: {
      send(payload) {
        sent.push(typeof payload === 'string' ? JSON.parse(payload) : payload);
      },
    },
  };
}

function getGeminiCliChatsDir(projectIdentifier = path.basename(process.cwd())) {
  return path.join(os.homedir(), '.gemini', 'tmp', projectIdentifier, 'chats');
}

async function removeGeminiCliConversation(sessionId, projectIdentifier = path.basename(process.cwd())) {
  const chatsDir = getGeminiCliChatsDir(projectIdentifier);
  try {
    const files = await fs.readdir(chatsDir);
    await Promise.all(files.map(async (fileName) => {
      if (!fileName.startsWith('session-') || !fileName.endsWith('.json')) return;
      const filePath = path.join(chatsDir, fileName);
      try {
        const conversation = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (conversation?.sessionId === sessionId) {
          await fs.unlink(filePath);
        }
      } catch {}
    }));
  } catch {}
}

async function readGeminiCliConversation(sessionId, projectIdentifier = path.basename(process.cwd())) {
  const chatsDir = getGeminiCliChatsDir(projectIdentifier);
  const files = await fs.readdir(chatsDir);

  for (const fileName of files) {
    if (!fileName.startsWith('session-') || !fileName.endsWith('.json')) continue;
    const filePath = path.join(chatsDir, fileName);
    try {
      const conversation = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (conversation?.sessionId === sessionId) {
        return conversation;
      }
    } catch {}
  }

  return null;
}

const geminiApiModulePromise = import('../gemini-api.js');

describe('gemini-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildGeminiThinkingConfig.mockReturnValue(null);
    spawnGemini.mockResolvedValue(undefined);
    process.env.GEMINI_API_RETRY_BASE_MS = '0';
    process.env.GEMINI_API_MAX_ATTEMPTS = '3';
  });

  afterEach(() => {
    if (originalRetryBaseMs === undefined) delete process.env.GEMINI_API_RETRY_BASE_MS;
    else process.env.GEMINI_API_RETRY_BASE_MS = originalRetryBaseMs;

    if (originalRetryMaxAttempts === undefined) delete process.env.GEMINI_API_MAX_ATTEMPTS;
    else process.env.GEMINI_API_MAX_ATTEMPTS = originalRetryMaxAttempts;
  });

  it('returns authFailed without emitting UI noise when direct auth is unavailable', async () => {
    getGeminiAuthHeaders.mockResolvedValue({ headers: null, authMethod: null });

    const { queryGeminiApi } = await geminiApiModulePromise;
    const { sent, writer } = createTestWriter();

    const result = await queryGeminiApi('Hello Gemini', {
      cwd: '/tmp/project',
      model: 'gemini-3-flash-preview',
      sessionId: 'gemini-authless',
      permissionMode: 'bypassPermissions',
    }, writer);

    expect(result).toEqual({ authFailed: true });
    expect(sent).toEqual([]);
  });

  it('builds Gemini request bodies with tools and thinking config', async () => {
    buildGeminiThinkingConfig.mockReturnValue({ thinkingLevel: 'HIGH' });

    const { GEMINI_TOOL_DECLARATIONS, buildRequestBody } = await geminiApiModulePromise;
    const body = buildRequestBody(
      'gemini-3-flash-preview',
      [{ role: 'user', parts: [{ text: 'Inspect the repo' }] }],
      { parts: [{ text: 'System prompt' }] },
      'high',
      GEMINI_TOOL_DECLARATIONS.slice(0, 2),
    );

    expect(body).toEqual(expect.objectContaining({
      systemInstruction: { parts: [{ text: 'System prompt' }] },
      contents: [{ role: 'user', parts: [{ text: 'Inspect the repo' }] }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } },
    }));
    expect(body.tools).toEqual([{
      functionDeclarations: GEMINI_TOOL_DECLARATIONS.slice(0, 2),
    }]);
  });

  it('parses Gemini SSE text, function calls, finish reason, and usage metadata', async () => {
    const { consumeGeminiStream } = await geminiApiModulePromise;
    const deltas = [];
    const response = makeSseResponse([
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello "},{"functionCall":{"name":"list_directory","args":{"path":"."}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":7}}',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"world"}]}}]}',
      '',
    ]);

    const result = await consumeGeminiStream(response, {
      onText(delta) {
        deltas.push(delta);
      },
    });

    expect(deltas).toEqual(['Hello ', 'world']);
    expect(result).toEqual({
      content: 'Hello world',
      functionCalls: [{ name: 'list_directory', args: { path: '.' } }],
      finishReason: 'STOP',
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 7 },
    });
  });

  it('adds a synthetic thought signature to oauth function-call turns when the model omitted one', async () => {
    const { SYNTHETIC_THOUGHT_SIGNATURE, buildModelTurnParts } = await geminiApiModulePromise;

    expect(buildModelTurnParts('', [{
      name: 'run_shell_command',
      args: { command: 'pwd' },
    }], { requireSyntheticThoughtSignatures: true })).toEqual([
      {
        functionCall: {
          name: 'run_shell_command',
          args: { command: 'pwd' },
        },
        thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE,
      },
    ]);
  });

  it('uses the Code Assist endpoint for oauth auth and still emits standard gemini websocket messages', async () => {
    getGeminiAuthHeaders.mockResolvedValue({
      headers: { Authorization: 'Bearer token' },
      authMethod: 'oauth',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cloudaicompanionProject: 'test-project',
          currentTier: { id: 'standard-tier' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeSseResponse([
          'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello from API"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}}',
          '',
        ]).body,
      });

    const { queryGeminiApi } = await geminiApiModulePromise;
    const { sent, writer } = createTestWriter();

    await queryGeminiApi('Say hello', {
      cwd: '/tmp/project',
      projectPath: '/tmp/project',
      model: 'gemini-3-flash-preview',
      sessionId: 'gemini-stream-test',
      permissionMode: 'bypassPermissions',
    }, writer);

    expect(ensureProjectSkillLinks).toHaveBeenCalledWith('/tmp/project');
    expect(writeProjectTemplates).toHaveBeenCalledWith('/tmp/project');
    expect(recordIndexedSession).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toBe('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist');
    expect(global.fetch.mock.calls[1][0]).toBe('https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse');
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual(expect.objectContaining({
      model: 'gemini-3-flash-preview',
      project: 'test-project',
      request: expect.objectContaining({
        session_id: 'gemini-stream-test',
      }),
    }));
    expect(sent[0]).toEqual(expect.objectContaining({
      type: 'session-created',
      sessionId: 'gemini-stream-test',
      provider: 'gemini',
    }));
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'gemini-response',
      sessionId: 'gemini-stream-test',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello from API' },
      },
    }));
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'token-budget',
      sessionId: 'gemini-stream-test',
      data: { used: 15, total: 2000000 },
    }));
    expect(sent.at(-1)).toEqual({
      type: 'gemini-complete',
      sessionId: 'gemini-stream-test',
      exitCode: 0,
    });
    expect(reconcileGeminiSessionIndex).toHaveBeenCalledWith('/tmp/project', expect.objectContaining({
      sessionId: 'gemini-stream-test',
      projectName: 'encoded:/tmp/project',
    }));
  });

  it('prefers an explicit API key over oauth when both auth paths are available', async () => {
    getGeminiAuthHeaders.mockResolvedValue({
      headers: { Authorization: 'Bearer oauth-token' },
      authMethod: 'oauth',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        body: makeSseResponse([
          'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello from public API"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":4,"totalTokenCount":12}}',
          '',
        ]).body,
      });

    const { queryGeminiApi } = await geminiApiModulePromise;
    const { sent, writer } = createTestWriter();

    await queryGeminiApi('Prefer API key', {
      cwd: '/tmp/project',
      projectPath: '/tmp/project',
      model: 'gemini-2.5-flash',
      sessionId: 'gemini-api-key-preferred',
      permissionMode: 'bypassPermissions',
      env: {
        GEMINI_API_KEY: 'env-gemini-key',
      },
    }, writer);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(global.fetch.mock.calls[0][1].headers).toEqual(expect.objectContaining({
      'x-goog-api-key': 'env-gemini-key',
    }));
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(sent.at(-1)).toEqual({
      type: 'gemini-complete',
      sessionId: 'gemini-api-key-preferred',
      exitCode: 0,
    });
  });

  it('retries transient Gemini capacity errors before surfacing a failure', async () => {
    getGeminiAuthHeaders.mockResolvedValue({
      headers: { Authorization: 'Bearer retry-token' },
      authMethod: 'oauth',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cloudaicompanionProject: 'test-project',
          currentTier: { id: 'standard-tier' },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => 'RESOURCE_EXHAUSTED: No capacity available for model gemini-2.5-flash-lite',
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeSseResponse([
          'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Recovered after retry."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":5,"totalTokenCount":25}}}',
          '',
        ]).body,
      });

    const { queryGeminiApi } = await geminiApiModulePromise;
    const { sent, writer } = createTestWriter();

    await queryGeminiApi('Retry once, then succeed.', {
      cwd: '/tmp/project',
      projectPath: '/tmp/project',
      model: 'gemini-2.5-flash-lite',
      sessionId: 'gemini-retry-success',
      permissionMode: 'bypassPermissions',
    }, writer);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(sent.find((entry) => entry.type === 'gemini-error')).toBeUndefined();
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'gemini-response',
      sessionId: 'gemini-retry-success',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Recovered after retry.' },
      },
    }));
    expect(sent.at(-1)).toEqual({
      type: 'gemini-complete',
      sessionId: 'gemini-retry-success',
      exitCode: 0,
    });
  });

  it('falls back to a smaller direct Gemini model before invoking the CLI on capacity exhaustion', async () => {
    process.env.GEMINI_API_MAX_ATTEMPTS = '1';

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => 'RESOURCE_EXHAUSTED: No capacity available for model gemini-3-flash-preview',
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeSseResponse([
          'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Recovered on fallback model."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":4,"totalTokenCount":12}}',
          '',
        ]).body,
      });

    const { queryGeminiApi } = await geminiApiModulePromise;
    const { sent, writer } = createTestWriter();

    await queryGeminiApi('Say hello after capacity fallback.', {
      cwd: '/tmp/project',
      projectPath: '/tmp/project',
      model: 'gemini-3-flash-preview',
      sessionId: 'gemini-direct-model-fallback',
      permissionMode: 'bypassPermissions',
      env: {
        GEMINI_API_KEY: 'env-gemini-key',
      },
    }, writer);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse');
    expect(global.fetch.mock.calls[1][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(spawnGemini).not.toHaveBeenCalled();
    expect(sent.find((entry) => entry.type === 'gemini-error')).toBeUndefined();
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'gemini-status',
      sessionId: 'gemini-direct-model-fallback',
      data: expect.objectContaining({
        status: 'Model busy, retrying with gemini-2.5-flash...',
      }),
    }));
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'gemini-response',
      sessionId: 'gemini-direct-model-fallback',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Recovered on fallback model.' },
      },
    }));
    expect(sent.at(-1)).toEqual({
      type: 'gemini-complete',
      sessionId: 'gemini-direct-model-fallback',
      exitCode: 0,
    });
  });

  it('replays oauth tool turns back to Code Assist with synthetic thought signatures and function responses', async () => {
    getGeminiAuthHeaders.mockResolvedValue({
      headers: { Authorization: 'Bearer tool-loop-token' },
      authMethod: 'oauth',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cloudaicompanionProject: 'test-project',
          currentTier: { id: 'standard-tier' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeSseResponse([
          'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"list_directory","args":{"path":"server/__tests__"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}}',
          '',
        ]).body,
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeSseResponse([
          'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Tests directory summarized."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":5,"totalTokenCount":35}}}',
          '',
        ]).body,
      });

    const { SYNTHETIC_THOUGHT_SIGNATURE, queryGeminiApi } = await geminiApiModulePromise;
    const { sent, writer } = createTestWriter();

    await queryGeminiApi('Summarize the Gemini tests.', {
      cwd: process.cwd(),
      projectPath: process.cwd(),
      model: 'gemini-2.5-flash-lite',
      sessionId: 'gemini-oauth-tool-loop',
      permissionMode: 'bypassPermissions',
    }, writer);

    expect(global.fetch).toHaveBeenCalledTimes(3);

    const secondTurnBody = JSON.parse(global.fetch.mock.calls[2][1].body);
    expect(secondTurnBody).toEqual(expect.objectContaining({
      model: 'gemini-2.5-flash-lite',
      project: 'test-project',
      request: expect.objectContaining({
        session_id: 'gemini-oauth-tool-loop',
        contents: expect.arrayContaining([
          expect.objectContaining({
            role: 'model',
            parts: [{
              functionCall: {
                name: 'list_directory',
                args: { path: 'server/__tests__' },
              },
              thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE,
            }],
          }),
          expect.objectContaining({
            role: 'user',
            parts: [{
              functionResponse: {
                name: 'list_directory',
                id: expect.any(String),
                response: {
                  result: expect.any(String),
                },
              },
            }],
          }),
        ]),
      }),
    }));

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'gemini-response',
      sessionId: 'gemini-oauth-tool-loop',
      data: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: expect.any(String),
          name: 'list_directory',
          input: { path: 'server/__tests__' },
        }],
      },
    }));

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'gemini-response',
      sessionId: 'gemini-oauth-tool-loop',
      data: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: expect.any(String),
          content: expect.any(String),
          is_error: false,
        }],
      },
    }));

    expect(sent.at(-1)).toEqual({
      type: 'gemini-complete',
      sessionId: 'gemini-oauth-tool-loop',
      exitCode: 0,
    });
  });

  it('bridges the direct-api session into Gemini CLI storage and falls back to CLI after retry exhaustion', async () => {
    process.env.GEMINI_API_MAX_ATTEMPTS = '2';
    const sessionId = 'gemini-cli-fallback-bridge';

    await removeGeminiCliConversation(sessionId);

    getGeminiAuthHeaders.mockResolvedValue({
      headers: { Authorization: 'Bearer exhausted-token' },
      authMethod: 'oauth',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cloudaicompanionProject: 'test-project',
          currentTier: { id: 'standard-tier' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeSseResponse([
          'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"list_directory","args":{"path":"server"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}}',
          '',
        ]).body,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => 'RESOURCE_EXHAUSTED: No capacity available for model gemini-2.5-flash-lite',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => 'RESOURCE_EXHAUSTED: No capacity available for model gemini-2.5-flash-lite',
      });

    const { queryGeminiApi } = await geminiApiModulePromise;
    const { sent, writer } = createTestWriter();

    await queryGeminiApi('Continue inspecting the server folder.', {
      cwd: process.cwd(),
      projectPath: process.cwd(),
      model: 'gemini-2.5-flash-lite',
      sessionId,
      permissionMode: 'bypassPermissions',
    }, writer);

    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(sent.find((entry) => entry.type === 'gemini-error')).toBeUndefined();
    expect(spawnGemini).toHaveBeenCalledTimes(1);
    expect(spawnGemini).toHaveBeenCalledWith(
      expect.stringContaining('Continue the current task from the existing session context.'),
      expect.objectContaining({
        cwd: process.cwd(),
        projectPath: process.cwd(),
        model: 'gemini-2.5-flash-lite',
        sessionId,
      }),
      writer,
    );

    const bridgedConversation = await readGeminiCliConversation(sessionId);
    expect(bridgedConversation).toEqual(expect.objectContaining({
      sessionId,
      kind: 'main',
      messages: expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          content: 'Continue inspecting the server folder.',
        }),
        expect.objectContaining({
          type: 'gemini',
          toolCalls: [
            expect.objectContaining({
              name: 'list_directory',
              args: { path: 'server' },
              result: expect.any(String),
            }),
          ],
        }),
      ]),
    }));
  });

  it('emits a final gemini-error for non-retryable API failures without invoking CLI fallback', async () => {
    getGeminiAuthHeaders.mockResolvedValue({
      headers: { Authorization: 'Bearer bad-request-token' },
      authMethod: 'oauth',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cloudaicompanionProject: 'test-project',
          currentTier: { id: 'standard-tier' },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: async () => JSON.stringify({ error: { message: 'Bad request payload' } }),
      });

    const { queryGeminiApi } = await geminiApiModulePromise;
    const { sent, writer } = createTestWriter();

    await queryGeminiApi('This request is malformed.', {
      cwd: '/tmp/project',
      projectPath: '/tmp/project',
      model: 'gemini-2.5-flash-lite',
      sessionId: 'gemini-non-retryable-failure',
      permissionMode: 'bypassPermissions',
    }, writer);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(spawnGemini).not.toHaveBeenCalled();
    expect(sent.filter((entry) => entry.type === 'gemini-error')).toEqual([
      expect.objectContaining({
        type: 'gemini-error',
        sessionId: 'gemini-non-retryable-failure',
        isRetryable: false,
        error: 'Bad request payload',
      }),
    ]);
  });
});
