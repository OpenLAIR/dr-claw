import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  fs: { mkdir: vi.fn(), readdir: vi.fn(), access: vi.fn() },
}));
vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('fs', () => ({ promises: mocks.fs }));
vi.mock('../compute-node.js', () => ({ loadAllNodes: vi.fn(), loadNodeConfig: vi.fn(), ComputeNode: class {} }));

import router from '../routes/community-tools.js';

const configure = router.stack.find(layer => layer.route?.path === '/configure').route.stack[0].handle;
const bridge = fileURLToPath(new URL('../../skills/aris-infra/mcp-servers/codex-exec/server.py', import.meta.url));
let registrationList;

beforeEach(() => {
  vi.resetAllMocks();
  registrationList = '';
  mocks.fs.readdir.mockResolvedValue([]);
  mocks.spawn.mockImplementation((command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (command === 'claude' && args[1] === 'list') child.stdout.emit('data', registrationList);
      child.emit('close', 0);
    });
    return child;
  });
});

async function request(projectPath = null) {
  const res = { json: vi.fn(), status: vi.fn() };
  res.status.mockReturnValue(res);
  await configure({ body: { projectPath, mcpBackend: 'codex' } }, res);
  return res.json.mock.calls[0][0];
}

describe('Hub Codex reviewer configuration (mock CLI and filesystem)', () => {
  it.each([null, '/tmp/research project'])('registers the bundled bridge independently of projectPath=%s', async projectPath => {
    expect(path.isAbsolute(bridge)).toBe(true);
    const result = await request(projectPath);
    expect(result.success).toBe(true);
    expect(mocks.fs.access).toHaveBeenCalledWith(bridge);
    expect(mocks.spawn).toHaveBeenCalledWith('claude', [
      'mcp', 'add', 'codex', '-s', 'user', '--', 'python3', bridge,
    ], expect.objectContaining({ shell: false }));
    expect(mocks.spawn.mock.calls.some(([, args]) => args.includes('mcp-server'))).toBe(false);
  });

  it('preserves an existing registration instead of replacing it', async () => {
    registrationList = 'codex: existing user command';
    const result = await request();
    expect(result.steps).toContainEqual(expect.objectContaining({ step: 'mcp', status: 'skipped' }));
    expect(mocks.spawn.mock.calls.some(([, args]) => args[1] === 'add')).toBe(false);
  });

  it('reports a missing bundle without registering a dead entry', async () => {
    mocks.fs.access.mockRejectedValue(new Error('Reviewer bridge missing'));
    const result = await request();
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual({ step: 'mcp', error: 'Reviewer bridge missing' });
    expect(mocks.spawn.mock.calls.some(([, args]) => args[1] === 'add')).toBe(false);
  });
});
