import { describe, expect, it } from 'vitest';
import TOML from '@iarna/toml';
import { editTomlServerSource } from '../tomlSourceEdit.js';
import { editMcpConfig } from '../mcpConfigEdit.js';

function update(source, { originalName = 'evidence', name = originalName, config = { command: 'new-command', args: ['--new', 'path with spaces'], env: { KEPT: 'changed', ADDED: 'with=equals' } } } = {}) {
  const desired = TOML.parse(source);
  editMcpConfig(desired, 'codex', { originalName, name, expected: JSON.parse(JSON.stringify(desired.mcp_servers[originalName])), config });
  const result = editTomlServerSource(source, desired, originalName, name);
  expect(JSON.parse(JSON.stringify(TOML.parse(result)))).toEqual(JSON.parse(JSON.stringify(desired)));
  return result;
}

describe('MCP TOML source preservation', () => {
  it('preserves comments, unrelated whitespace, quotes and ordering when editing and renaming', () => {
    const source = `# Global explanation\nmodel = 'fixture-model' # keep model style\n\n[mcp_servers.evidence] # server purpose\ncommand   = 'old-command' # executable\nargs = [\n  '--old', # argument purpose\n]\nstartup_timeout_sec = 30 # retained metadata\n[mcp_servers.evidence.env] # environment\nKEPT = 'old' # credential description\nREMOVED = 'retire' # obsolete key explanation\n\n[projects.'/research/project']\ntrust_level  = 'trusted' # exact formatting\n`;
    const result = update(source, { name: 'new.name' });
    for (const comment of source.match(/#[^\n]*/g)) expect(result).toContain(comment);
    expect(result).toContain("model = 'fixture-model' # keep model style");
    expect(result).toContain("[projects.'/research/project']\ntrust_level  = 'trusted' # exact formatting\n");
    expect(result).toContain('startup_timeout_sec = 30 # retained metadata');
    expect(result).not.toContain("REMOVED = 'retire'");
  });
  for (const [label, source] of [
    ['dotted root keys', `# description\nmcp_servers.evidence.command = 'old' # command\nmcp_servers.evidence.env.KEPT = 'old'\n[unrelated]\nvalue = 'preserve'\n`],
    ['dotted fields under parent table', `[mcp_servers]\nevidence.command = 'old' # command\nevidence.env.KEPT = 'old'\n`],
    ['inline server', `[mcp_servers]\nevidence = { command = 'old', env = { KEPT = 'old' } } # inline explanation\nother = { command = 'untouched' }\n`],
    ['inline root', `mcp_servers = { evidence = { command = 'old' }, sibling = { command = 'untouched' } } # root explanation\nmodel='untouched'\n`],
    ['quoted table keys', `["mcp_servers".'evidence']\ncommand='old' # detail\n["mcp_servers".'evidence'.env]\nKEPT='old'\n`],
    ['minimal missing args and env', `[mcp_servers.evidence]\ncommand='old'`],
    ['empty environment', `[mcp_servers.evidence]\ncommand='old'\n[mcp_servers.evidence.env]\n# add a key below\n`],
    ['multiline strings containing fake syntax', `note = '''\n[mcp_servers.fake]\n# not a comment\nvalue = "text"\n'''\n[mcp_servers.evidence]\ncommand='old'\nnotes = """\n[unrelated]\n# still a string\n"""\n`],
    ['unknown arrays of tables', `[mcp_servers.evidence]\ncommand='old'\n[[mcp_servers.evidence.extra]]\nlabel='first' # first item\n[[mcp_servers.evidence.extra]]\nlabel='second' # second item\n[unrelated]\nvalue=2026-10-23T10:20:30Z\n`],
    ['CRLF and Unicode', "# 科研说明\r\n[mcp_servers.evidence]\r\ncommand = '实验工具' # 命令\r\n[projects.'研究目录']\r\nnote = '🦞 中文'\r\n"],
  ]) {
    for (const renamed of [false, true]) it(`${label}, ${renamed ? 'renamed' : 'same name'}`, () => {
      const result = update(source, { name: renamed ? 'renamed.研究' : 'evidence' });
      for (const comment of source.match(/#[^\r\n]*/g) || []) expect(result).toContain(comment);
      if (source.includes('\r\n')) expect(result.replaceAll('\r\n', '')).not.toContain('\n');
    });
  }
  it('preserves byte-identical text for a no-op edit', () => {
    const source = `# preserve exactly\n[mcp_servers.evidence]\ncommand = 'old'\nargs = ['a', 'b']\nenv = { KEPT = 'old' }\n`;
    expect(update(source, { config: TOML.parse(source).mcp_servers.evidence })).toBe(source);
  });
});
