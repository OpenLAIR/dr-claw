import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import TOML from '@iarna/toml';
import { editMcpConfig, updateMcpConfigFile } from '../mcpConfigEdit.js';
const original = { command: 'old-command', args: ['--baseline'], env: { FIXTURE: 'private-test' }, startup_timeout_sec: 30 };
const input = () => ({ originalName: 'baseline', name: 'renamed', type: 'stdio', expected: structuredClone(original), config: { command: 'new-command', args: ['--path', '/research/path with spaces'], env: { FIXTURE: 'replacement' } } });
const dirs = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
async function fixture(provider) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-config-edit-')); dirs.push(dir);
  const document = { model: 'fixture-model', [provider === 'codex' ? 'mcp_servers' : 'mcpServers']: { baseline: structuredClone(original), sibling: { command: 'untouched' } } };
  const filename = path.join(dir, provider === 'codex' ? 'config.toml' : 'config.json');
  const text = provider === 'codex' ? TOML.stringify(document) : JSON.stringify(document);
  await fs.writeFile(filename, text, { mode: 0o600 });
  return { filename, dir, text, read: async () => (provider === 'codex' ? TOML.parse : JSON.parse)(await fs.readFile(filename, 'utf8')) };
}
describe('MCP configuration editing', () => {
  for (const provider of ['claude', 'codex']) {
    it(`${provider}: replaces once and preserves unrelated settings and entry metadata`, async () => {
      const f = await fixture(provider); await updateMcpConfigFile(f.filename, provider, input());
      const d = await f.read(), servers = d[provider === 'codex' ? 'mcp_servers' : 'mcpServers'];
      expect(d.model).toBe('fixture-model'); expect(servers.baseline).toBeUndefined(); expect(servers.sibling).toEqual({ command: 'untouched' });
      expect(servers.renamed).toMatchObject({ ...input().config, startup_timeout_sec: 30 });
      expect((await fs.stat(f.filename)).mode & 0o777).toBe(0o600); expect(await fs.readdir(f.dir)).toHaveLength(1);
    });
    it(`${provider}: rename failure leaves original bytes and removes staging file`, async () => {
      const f = await fixture(provider);
      await expect(updateMcpConfigFile(f.filename, provider, input(), { ...fs, rename: async () => { throw new Error('Fixture disk failure'); } })).rejects.toThrow('Fixture disk failure');
      expect(await fs.readFile(f.filename, 'utf8')).toBe(f.text); expect(await fs.readdir(f.dir)).toHaveLength(1);
    });
    it(`${provider}: rejects stale edits and occupied names without modifying bytes`, async () => {
      const f = await fixture(provider);
      await expect(updateMcpConfigFile(f.filename, provider, { ...input(), expected: { ...original, command: 'stale' } })).rejects.toMatchObject({ status: 409 });
      await expect(updateMcpConfigFile(f.filename, provider, { ...input(), name: 'sibling' })).rejects.toMatchObject({ status: 409 });
      expect(await fs.readFile(f.filename, 'utf8')).toBe(f.text);
    });
  }
  it('updates a project-local server without touching the same user-scoped name', () => {
    const d = { mcpServers: { baseline: { command: 'user' } }, projects: { '/research/project': { mcpServers: { baseline: structuredClone(original) }, trusted: true } } };
    editMcpConfig(d, 'claude', { ...input(), scope: 'local', projectPath: '/research/project' });
    expect(d.mcpServers.baseline.command).toBe('user'); expect(d.projects['/research/project'].trusted).toBe(true); expect(d.projects['/research/project'].mcpServers.renamed.command).toBe('new-command');
  });
  it('converts transport while preserving unrelated metadata', () => {
    const d = { mcpServers: { baseline: structuredClone(original) } };
    editMcpConfig(d, 'claude', { ...input(), type: 'sse', config: { url: 'https://fixture.example/mcp', headers: { Authorization: 'test-only' } } });
    expect(d.mcpServers.renamed).toEqual({ type: 'sse', url: 'https://fixture.example/mcp', headers: { Authorization: 'test-only' }, startup_timeout_sec: 30 });
  });
  it('rejects malformed config and invalid command without changing original bytes', async () => {
    const f = await fixture('claude');
    await expect(updateMcpConfigFile(f.filename, 'claude', { ...input(), config: { command: '', args: [], env: {} } })).rejects.toMatchObject({ status: 400 });
    expect(await fs.readFile(f.filename, 'utf8')).toBe(f.text);
    await fs.writeFile(f.filename, '{broken');
    await expect(updateMcpConfigFile(f.filename, 'claude', input())).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(f.filename, 'utf8')).toBe('{broken');
  });
  it('detects an external write made while preparing the replacement', async () => {
    const f = await fixture('claude'); let reads = 0;
    await expect(updateMcpConfigFile(f.filename, 'claude', input(), { ...fs, readFile: async (...args) => {
      if (++reads === 2) await fs.writeFile(f.filename, 'external change');
      return fs.readFile(...args);
    } })).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(f.filename, 'utf8')).toBe('external change'); expect(await fs.readdir(f.dir)).toHaveLength(1);
  });
  it('serializes overlapping edits and rejects the second stale snapshot', async () => {
    const f = await fixture('codex');
    const results = await Promise.allSettled([updateMcpConfigFile(f.filename, 'codex', input()), updateMcpConfigFile(f.filename, 'codex', input())]);
    expect(results.map(r => r.status)).toEqual(['fulfilled','rejected']); expect((await f.read()).mcp_servers.renamed.command).toBe('new-command');
  });
});
