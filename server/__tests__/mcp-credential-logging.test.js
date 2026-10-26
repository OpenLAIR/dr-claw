import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { spawn } from 'child_process';
import mcpRoutes from '../routes/mcp.js';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('../utils/cliResolution.js', () => ({
  resolveAvailableCliCommand: vi.fn(async () => 'claude'),
}));

const secrets = ['owner-token-sentinel', 'custom-header-sentinel', 'env-secret-sentinel', 'argument-secret-sentinel', 'url-secret-sentinel'];
const httpConfig = {
  type: 'http',
  url: `https://example.invalid/mcp?key=${secrets[4]}`,
  headers: { Authorization: `Bearer ${secrets[0]}`, 'X-Custom-Credential': secrets[1] },
};
const stdioConfig = {
  type: 'stdio', command: 'example-mcp',
  env: { SERVICE_KEY: secrets[2] }, args: ['--credential', secrets[3]],
};
const cases = [
  ...['http', 'sse'].map(type => ({
    label: type, route: '/cli/add',
    body: { name: 'example', ...httpConfig, type },
    args: ['mcp', 'add', '--scope', 'user', '--transport', type, 'example', httpConfig.url,
      '--header', `Authorization: Bearer ${secrets[0]}`, '--header', `X-Custom-Credential: ${secrets[1]}`],
  })),
  {
    label: 'stdio', route: '/cli/add', body: { name: 'example', ...stdioConfig },
    args: ['mcp', 'add', '--scope', 'user', 'example', '-e', `SERVICE_KEY=${secrets[2]}`, stdioConfig.command, ...stdioConfig.args],
  },
  ...[httpConfig, stdioConfig].flatMap(config => [false, true].map(asString => ({
    label: `JSON ${config.type} ${asString ? 'string' : 'object'}`, route: '/cli/add-json',
    body: { name: 'example', jsonConfig: asString ? JSON.stringify(config) : config },
    args: ['mcp', 'add-json', '--scope', 'user', 'example', JSON.stringify(config)],
  }))),
];

let server;
let baseUrl;
let logSpies;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', mcpRoutes);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/mcp`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  logSpies = ['log', 'warn', 'error', 'info', 'debug'].map(method => vi.spyOn(console, method).mockImplementation(() => {}));
  vi.mocked(spawn).mockReset();
});

afterEach(() => vi.restoreAllMocks());

function fakeCli(outcome, stdout = 'Configured') {
  vi.mocked(spawn).mockImplementation((_command, args) => {
    const error = Object.assign(new Error(`Failed: ${secrets.join(' ')}`), { spawnargs: args });
    if (outcome === 'throw') throw error;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (outcome === 'error') child.emit('error', error);
      else {
        child.stdout.emit('data', Buffer.from(stdout));
        // CLI diagnostics can echo arbitrary configuration, even on success.
        child.stderr.emit('data', Buffer.from(secrets.join(' ')));
        child.emit('close', outcome === 'failure' ? 1 : 0);
      }
    });
    return child;
  });
}

function expectSafeLogs() {
  const logs = inspect(logSpies.flatMap(spy => spy.mock.calls), { depth: null });
  expect(logs).toContain('Claude CLI');
  for (const secret of secrets) expect(logs).not.toContain(secret);
}

describe('MCP configuration credentials stay out of server logs', () => {
  for (const entry of cases) {
    for (const outcome of ['success', 'failure', 'error', 'throw']) {
      it(`${entry.label}: ${outcome} logs no secrets and passes the original configuration to the CLI`, async () => {
        fakeCli(outcome);
        const response = await fetch(`${baseUrl}${entry.route}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry.body),
        });
        const body = await response.json();
        expect(response.status).toBe(outcome === 'success' ? 200 : outcome === 'failure' ? 400 : 500);
        if (outcome === 'success') expect(body.success).toBe(true);
        expect(spawn).toHaveBeenCalledExactlyOnceWith('claude', entry.args, expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }));
        expectSafeLogs();
      });
    }
  }

  for (const [method, route, failureStatus] of [['GET', '/cli/list', 500], ['GET', '/cli/get/example', 404], ['DELETE', '/cli/remove/example', 400]]) {
    for (const outcome of ['failure', 'error', 'throw']) {
      it(`${method} ${route}: ${outcome} does not log echoed credentials`, async () => {
        fakeCli(outcome);
        const response = await fetch(`${baseUrl}${route}`, { method });
        await response.json();
        expect(response.status).toBe(outcome === 'failure' ? failureStatus : 500);
        expectSafeLogs();
      });
    }
  }

  it('does not log credentials in a successful server listing', async () => {
    fakeCli('success', `example: ${httpConfig.url} - ✓ Connected\n`);
    const response = await fetch(`${baseUrl}/cli/list`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.servers[0].description).toBe(httpConfig.url);
    expectSafeLogs();
  });
});
