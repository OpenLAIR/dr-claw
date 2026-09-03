import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';

/**
 * Exercises the /api/models routes over real HTTP, mounted without the auth
 * middleware. Registration in this environment needs config the test harness
 * does not have, and the auth layer is not what these routes add.
 */

let server;
let baseUrl;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const { default: modelsRoutes } = await import('../routes/models.js');
  const app = express();
  app.use(express.json());
  app.use('/api/models', modelsRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/models/:provider', () => {
  it('always returns a usable list, even for a provider it cannot probe', async () => {
    const { GEMINI_MODELS } = await import('../../shared/modelConstants.js');
    const { status, body } = await get('/api/models/gemini');

    expect(status).toBe(200);
    expect(body.provider).toBe('gemini');
    expect(body.source).toBe('static');
    expect(body.options).toEqual(GEMINI_MODELS.OPTIONS);
    expect(body.default).toBe(GEMINI_MODELS.DEFAULT);
  });

  it('reports allowsCustom so the client can render a free-text picker', async () => {
    const { body } = await get('/api/models/openrouter');
    expect(body.allowsCustom).toBe(true);
  });

  it('answers 200 with an error field for an unknown provider rather than throwing', async () => {
    const { status, body } = await get('/api/models/definitely-not-real');

    expect(status).toBe(200);
    expect(body.options).toEqual([]);
    expect(body.error).toContain('Unknown provider');
  });

  it('never rejects when the harness is absent — the picker must still render', async () => {
    const previous = process.env.CODEX_CLI_PATH;
    process.env.CODEX_CLI_PATH = '/nonexistent/codex-binary';
    try {
      const { clearModelDiscoveryCache } = await import('../utils/harnessModelDiscovery.js');
      clearModelDiscoveryCache('codex');

      const { status, body } = await get('/api/models/codex');
      expect(status).toBe(200);
      expect(body.source).toBe('static');
      expect(body.options.length).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env.CODEX_CLI_PATH;
      else process.env.CODEX_CLI_PATH = previous;
    }
  });
});

describe('GET /api/models/providers', () => {
  it('lists only the providers that can be probed', async () => {
    const { status, body } = await get('/api/models/providers');

    expect(status).toBe(200);
    expect(body.providers).toEqual(['claude', 'codex', 'openrouter']);
  });
});
