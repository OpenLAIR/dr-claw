/**
 * Central Nano Claude Code session JSON location (~/.dr-claw/nano-sessions).
 * Matches file watcher PROVIDER_WATCH_PATHS and avoids cwd-scattered drclaw-nano-*.json.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export function getNanoDrClawSessionsRoot() {
  return path.join(os.homedir(), '.dr-claw', 'nano-sessions');
}

export async function ensureNanoDrClawSessionsRoot() {
  const root = getNanoDrClawSessionsRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

/**
 * Plain filename only: drclaw-nano-<sanitizedId>.json — no path segments / traversal.
 */
export function safeNanoSessionFilename(sessionId) {
  const safe = String(sessionId || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe.includes('..')) {
    return null;
  }
  const filename = `drclaw-nano-${safe}.json`;
  if (path.basename(filename) !== filename) {
    return null;
  }
  return filename;
}

export function resolveNanoSessionAbsPath(sessionId) {
  const filename = safeNanoSessionFilename(sessionId);
  if (!filename) {
    return null;
  }
  return path.join(getNanoDrClawSessionsRoot(), filename);
}
