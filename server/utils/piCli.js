/**
 * Resolution helpers for the Pi coding agent CLI (https://pi.dev).
 *
 * Mirrors the shape of codexCli.js so provider plumbing stays uniform.
 */

import os from 'os';
import path from 'path';

/** Command used to invoke Pi. Override with PI_CLI_PATH. */
export function getPiCliCommand(env = process.env) {
  return String(env.PI_CLI_PATH || '').trim() || 'pi';
}

/** Root of Pi's on-disk session store. */
export function getPiSessionsRoot(homeDir = os.homedir()) {
  return path.join(homeDir, '.pi', 'agent', 'sessions');
}

/**
 * Pi stores sessions in a per-working-directory folder. Verified against
 * pi 0.83.0: the leading separator is dropped, remaining separators become '-',
 * and the result is wrapped in double dashes.
 *
 *   /private/tmp/a/b  ->  --private-tmp-a-b--
 *
 * This is only used as a lookup hint. It is not reversible — a path segment
 * containing '-' is indistinguishable from a separator — so anything that needs
 * to know a session's real working directory must read `cwd` from the session
 * file's header line instead. See readPiSessionHeader() in projects.js.
 */
export function encodePiSessionDirName(projectPath) {
  if (!projectPath) return '';
  const normalized = path.resolve(projectPath).replace(/\\/g, '/').replace(/^\/+/, '');
  return `--${normalized.replace(/\//g, '-')}--`;
}

export function getPiSessionDirForProject(projectPath, homeDir = os.homedir()) {
  const dirName = encodePiSessionDirName(projectPath);
  return dirName ? path.join(getPiSessionsRoot(homeDir), dirName) : '';
}

export default {
  getPiCliCommand,
  getPiSessionsRoot,
  encodePiSessionDirName,
  getPiSessionDirForProject,
};
