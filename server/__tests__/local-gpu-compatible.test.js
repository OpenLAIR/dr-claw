import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

vi.mock('../projects.js', () => ({
  encodeProjectPath: p => p, ensureProjectSkillLinks: vi.fn(), reconcileLocalGPUSessionIndex: vi.fn(),
}));
vi.mock('../templates/index.js', () => ({ writeProjectTemplates: vi.fn() }));
vi.mock('../utils/sessionIndex.js', () => ({ applyStageTagsToSession: vi.fn(), recordIndexedSession: vi.fn() }));
vi.mock('../utils/memoryPrompt.js', () => ({ buildMemoryBlock: () => '' }));

let tempDir;
beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-model-agent-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
  vi.stubEnv('LOCAL_GPU_SERVER_URL', 'http://localhost:8000/proxy/v1');
  vi.stubEnv('LOCAL_GPU_API_KEY', 'fixture-key');
});
afterAll(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  await fs.rm(tempDir, { recursive: true, force: true });
});

function sse(deltas) {
  const payload = deltas.map(delta => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(new ReadableStream({ start(controller) {
    // Deliberately fragment SSE records across chunks.
    const bytes = new TextEncoder().encode(payload);
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

it('runs discovery → streamed tool call → real local Read → streamed answer without Ollama (#203)', async () => {
  await fs.writeFile(path.join(tempDir, 'sample.txt'), 'fixture-content');
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'org/fixture-model' }] });
    if (requests.length === 2) return sse([
      { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"path":' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '"sample.txt"}' } }] },
    ]);
    return sse([{ content: 'Read ' }, { content: 'successfully' }]);
  }));
  const { queryLocalGPU, pullOllamaModel } = await import('../local-gpu.js');
  const sent = [];
  await queryLocalGPU('Read sample.txt', {
    cwd: tempDir, model: 'org/fixture-model', permissionMode: 'bypassPermissions',
  }, { send: payload => sent.push(JSON.parse(payload)) });
  expect(requests.map(r => r.url)).toEqual([
    'http://localhost:8000/proxy/v1/models',
    'http://localhost:8000/proxy/v1/chat/completions',
    'http://localhost:8000/proxy/v1/chat/completions',
  ]);
  for (const request of requests) {
    expect(request.options.headers.Authorization).toBe('Bearer fixture-key');
    expect(request.options.redirect).toBe('error');
  }
  const continuation = JSON.parse(requests[2].options.body);
  expect(continuation.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '1|fixture-content' });
  expect(continuation.model).toBe('org/fixture-model');
  expect(sent.some(m => m.type === 'localgpu-error')).toBe(false);
  expect(sent.at(-1).type).toBe('localgpu-complete');
  expect(sent.filter(m => m.data?.type === 'assistant_message').map(m => m.data.message.content).join('')).toBe('Read successfully');
  await expect(pullOllamaModel('http://localhost:8000/proxy/v1', 'some-model')).rejects.toThrow('only supported by Ollama');
  expect(requests.some(r => r.url.endsWith('/api/pull'))).toBe(false);
});
