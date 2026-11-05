import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeLocalServerUrl, localApiBaseUrl, checkLocalModelServer, requestLocalChat } from '../utils/localModelServer.js';

afterEach(() => vi.unstubAllGlobals());
const json = data => ({ ok: true, json: async () => data });

describe('local OpenAI-compatible servers (#203)', () => {
  it('accepts vLLM, SGLang, IPv6 and prefixed /v1 URLs without duplicating /v1', () => {
    expect(localApiBaseUrl('localhost:8000')).toBe('http://localhost:8000/v1');
    expect(localApiBaseUrl('http://[::1]:30000/v1/')).toBe('http://[::1]:30000/v1');
    expect(localApiBaseUrl('http://localhost:8000/proxy/v1')).toBe('http://localhost:8000/proxy/v1');
  });
  it.each(['https://example.com', 'http://192.168.1.1', 'file:///etc/passwd', 'http://localhost@evil.com', 'http://a:b@localhost', 'http://localhost/?token=x', 'http://localhost/#x'])('rejects unsafe URL %s', url => {
    expect(() => normalizeLocalServerUrl(url)).toThrow();
  });
  it('discovers OpenAI model IDs and forwards an optional server-side key', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ data: [{ id: 'org/model' }] }));
    vi.stubGlobal('fetch', fetch);
    const status = await checkLocalModelServer('http://localhost:8000/v1', 'test-key');
    expect(status.provider).toBe('openai-compatible');
    expect(status.models[0].name).toBe('org/model');
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/v1/models', expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer test-key' } }));
  });
  it('falls back from Ollama discovery for a root vLLM URL', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce(json({ data: [{ id: 'test-model' }] }));
    vi.stubGlobal('fetch', fetch);
    expect((await checkLocalModelServer('http://localhost:8000')).running).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['http://localhost:8000/api/tags', 'http://localhost:8000/v1/models']);
  });
  it('retains Ollama parameter size metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ models: [{ name: 'qwen3:8b', details: { parameter_size: '8B' } }] })));
    const status = await checkLocalModelServer('http://localhost:11434');
    expect(status.provider).toBe('ollama');
    expect(status.models[0].sizeB).toBe(8);
  });
  it('reports bad models payloads and HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ models: [] })).mockResolvedValueOnce({ ok: false, status: 401 }));
    expect((await checkLocalModelServer('http://localhost:8000/v1')).running).toBe(false);
    expect((await checkLocalModelServer('http://localhost:8000/v1')).error).toContain('401');
  });
  it('streams completion requests to the same base, with tool calls, auth, and abort signal', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const body = { model: 'org/model', messages: [], stream: true, tools: [{ type: 'function' }] };
    await requestLocalChat('http://localhost:30000/v1', body, signal, 'secret');
    expect(fetch).toHaveBeenCalledWith('http://localhost:30000/v1/chat/completions', expect.objectContaining({ method: 'POST', redirect: 'error', signal, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' } }));
  });
});
