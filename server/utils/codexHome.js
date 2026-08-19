import os from 'os';
import path from 'path';

/**
 * Resolve Codex's state root consistently across the server. CODEX_HOME is a
 * portable deployment boundary; authentication remains target-host state and
 * is never copied by the bootstrap.
 */
function resolveCodexHome(env = process.env, homeDir = os.homedir()) {
  const configured = String(env.CODEX_HOME || '').trim();
  if (!configured) return path.join(homeDir, '.codex');
  if (configured === '~') return homeDir;
  if (configured.startsWith(`~${path.sep}`) || configured.startsWith('~/')) {
    return path.resolve(homeDir, configured.slice(2));
  }
  return path.resolve(configured);
}

export { resolveCodexHome };
