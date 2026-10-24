import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import TOML from '@iarna/toml';
import { editTomlServerSource } from './tomlSourceEdit.js';

const edits = new Map();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export const codexConfigPath = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');

export async function claudeConfigPath() {
  for (const filename of [path.join(os.homedir(), '.claude.json'), path.join(os.homedir(), '.claude', 'settings.json')]) {
    try { await fs.access(filename); return filename; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  fail(404, 'Configuration not found. Refresh the server list.');
}

function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || ['__proto__', 'constructor', 'prototype'].includes(name)) fail(400, 'Invalid server name.');
}
function strings(value) { return object(value) && Object.values(value).every(item => typeof item === 'string'); }

// Only edit an existing entry. Creation stays on the provider CLI. No process is
// launched and no original entry is removed before the complete replacement exists.
export function editMcpConfig(document, provider, input) {
  const { originalName, name, scope = 'user', projectPath, expected, config, type = 'stdio' } = input;
  validateName(originalName); validateName(name);
  if (!object(config) || !object(expected)) fail(409, 'Refresh the server list before editing this configuration.');
  let servers;
  if (provider === 'codex') servers = document.mcp_servers;
  else if (scope === 'user') servers = document.mcpServers;
  else if (scope === 'local' && typeof projectPath === 'string' && path.isAbsolute(projectPath)) servers = document.projects?.[projectPath]?.mcpServers;
  else fail(400, 'Invalid MCP scope or project.');
  if (!object(servers) || !own(servers, originalName)) fail(409, 'The original server no longer exists. Refresh the server list.');
  const original = servers[originalName];
  if (!isDeepStrictEqual(JSON.parse(JSON.stringify(original)), expected)) fail(409, 'This server changed elsewhere. Refresh before editing again.');
  if (name !== originalName && own(servers, name)) fail(409, 'A server with this name already exists.');
  const next = { ...original };
  if (type === 'stdio') {
    if (typeof config.command !== 'string' || !config.command.trim() || !Array.isArray(config.args) || !config.args.every(arg => typeof arg === 'string') || !strings(config.env)) fail(400, 'A command, string arguments and environment values are required.');
    for (const key of ['url', 'headers', 'http_headers', 'bearer_token_env_var', 'env_http_headers', 'transport']) delete next[key];
    Object.assign(next, { command: config.command, args: config.args, env: config.env });
    if (provider === 'claude') next.type = 'stdio';
  } else if (provider === 'claude' && ['http', 'sse'].includes(type)) {
    let url; try { url = new URL(config.url); } catch { fail(400, 'A valid HTTP or HTTPS URL is required.'); }
    if (!['http:', 'https:'].includes(url.protocol) || !strings(config.headers)) fail(400, 'A valid URL and string header values are required.');
    for (const key of ['command', 'args', 'env', 'transport']) delete next[key];
    Object.assign(next, { type, url: config.url, headers: config.headers });
  } else fail(400, 'Unsupported MCP transport.');
  if (name !== originalName) delete servers[originalName];
  servers[name] = next;
  return document;
}

export async function updateMcpConfigFile(filename, provider, input, io = fs) {
  // Serialize this application's edits to the same file; compare bytes again
  // before rename to reject external edits observed while preparing the write.
  const previous = edits.get(filename) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const target = await io.realpath(filename);
    const original = await io.readFile(target, 'utf8');
    const stat = await io.stat(target);
    const parse = provider === 'codex' ? TOML.parse : JSON.parse;
    let document;
    try { document = parse(original); } catch { fail(409, 'The configuration cannot be parsed. The original file was not changed.'); }
    editMcpConfig(document, provider, input);
    const replacement = provider === 'codex' ? editTomlServerSource(original, document, input.originalName, input.name) : JSON.stringify(document, null, 2) + '\n';
    parse(replacement);
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      const handle = await io.open(temporary, 'wx', stat.mode & 0o777);
      try { await handle.writeFile(replacement, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      if (await io.readFile(target, 'utf8') !== original) fail(409, 'The configuration changed while saving. Please refresh and try again.');
      await io.rename(temporary, target);
    } finally { await io.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.error('[ERROR] MCP temporary file cleanup failed:', error.code); }); }
  });
  edits.set(filename, operation);
  try { return await operation; } finally { if (edits.get(filename) === operation) edits.delete(filename); }
}
