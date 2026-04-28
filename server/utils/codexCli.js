import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..', '..');

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
  getCodexCliCommand,
};
