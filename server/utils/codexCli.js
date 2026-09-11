import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..', '..');
const moduleRequire = createRequire(import.meta.url);

function getPathEnvKey(env = process.env) {
  if (process.platform !== 'win32') return 'PATH';
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path';
}

function normalizePathForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getLocalNodeBinPaths() {
  return [
    path.join(APP_ROOT, 'node_modules', '.bin'),
    path.join(process.cwd(), 'node_modules', '.bin'),
  ];
}

function stripLocalNodeBinFromPath(pathValue = '') {
  if (!pathValue) return pathValue;

  const blocked = new Set(getLocalNodeBinPaths().map(normalizePathForCompare));
  return pathValue
    .split(path.delimiter)
    .filter((entry) => {
      if (!entry) return false;
      return !blocked.has(normalizePathForCompare(entry));
    })
    .join(path.delimiter);
}

function buildCodexCliEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  const pathKey = getPathEnvKey(env);
  env[pathKey] = stripLocalNodeBinFromPath(env[pathKey] || '');
  return env;
}

function getCodexCliCommand(env = process.env) {
  return String(env.CODEX_CLI_PATH || '').trim() || 'codex';
}

/**
 * How to launch the Codex CLI that Dr. Claw's chat turns actually run on.
 *
 * `@openai/codex-sdk` spawns the `@openai/codex` package it depends on, never
 * the `codex` on PATH. Anything that describes that executor to the user (the
 * model picker, most of all) has to ask the very same binary, otherwise the
 * catalogue it shows and the catalogue the chat can use drift apart: a newer
 * global CLI lists models the bundled one cannot run, an older one hides
 * models it can. The bundled CLI is resolved the way the SDK resolves it,
 * through Node's module lookup, and is run via `process.execPath` so it works
 * without relying on the file's exec bit or shebang.
 *
 * `CODEX_CLI_PATH` still wins so an operator can point every Codex call at one
 * explicit binary. If the package cannot be resolved (an install that dropped
 * it), fall back to `codex` on PATH exactly like the shell does.
 *
 * @returns {{ command: string, args: string[], env: object }}
 */
function getBundledCodexCliInvocation(env = process.env) {
  const override = String(env.CODEX_CLI_PATH || '').trim();
  if (override) {
    return { command: override, args: [], env: buildCodexCliEnv(env) };
  }
  try {
    const entry = moduleRequire.resolve('@openai/codex/bin/codex.js');
    return { command: process.execPath, args: [entry], env: { ...env } };
  } catch (_) {
    return { command: 'codex', args: [], env: buildCodexCliEnv(env) };
  }
}

function quotePosix(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function codexCommandForShell(env = process.env, platform = process.platform) {
  const command = getCodexCliCommand(env);
  if (command === 'codex') return command;

  return platform === 'win32'
    ? `& ${quotePowerShell(command)}`
    : quotePosix(command);
}

export {
  buildCodexCliEnv,
  codexCommandForShell,
  getBundledCodexCliInvocation,
  getCodexCliCommand,
};
