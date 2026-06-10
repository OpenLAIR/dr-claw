/**
 * ASCII-safe working directory for the Codex CLI.
 *
 * HTTP header values must be ISO-8859-1 / ASCII. codex-cli embeds the workspace
 * path verbatim into the `x-codex-turn-metadata` request header, so a project
 * whose filesystem path contains non-ASCII characters (e.g. a Chinese path like
 * `/Users/you/Documents/项目/demo`) makes the Codex backend reject the
 * request with:
 *
 *   UTF-8 encoding error: failed to convert header to a str for header name
 *   'x-codex-turn-metadata' ...
 *
 * and the stream disconnects before completion ("Reconnecting... 5/5").
 *
 * Codex keeps the `-C/--cd` working-directory value verbatim — it does NOT
 * canonicalize symlinks (verified: the `<cwd>` and `<workspace_roots>` it renders
 * keep the symlink path). So we run Codex inside an ASCII-only symlink that points
 * at the real project directory. The header stays ASCII while file operations
 * still resolve to the real directory through the symlink.
 *
 * dr-claw keeps using the REAL project path for its own indexing/tags; only the
 * path handed to the Codex SDK is swapped. `normalizeComparablePath` resolves
 * symlinks so sessions Codex records under the symlink cwd still associate to the
 * real project.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Anything outside printable ASCII would break the HTTP header.
export function pathIsHeaderSafe(p) {
  return typeof p === 'string' && !/[^\x00-\x7F]/.test(p);
}

// Prefer a stable home location; fall back to the temp dir if HOME itself is
// non-ASCII (which would defeat the purpose).
function getShadowRoot() {
  const homeShadow = path.join(os.homedir(), '.dr-claw', 'codex-cwd');
  if (pathIsHeaderSafe(homeShadow)) {
    return homeShadow;
  }
  return path.join(os.tmpdir(), 'dr-claw-codex-cwd');
}

function asciiSlug(name) {
  const slug = (name || '').replace(/[^a-zA-Z0-9._-]/g, '');
  return slug || 'project';
}

/**
 * Returns a working-directory path safe to send to the Codex CLI.
 * - ASCII paths are returned unchanged (no symlink, zero behaviour change).
 * - Non-ASCII paths get an ASCII symlink under the shadow root; the symlink path
 *   is returned. On any failure the real path is returned (no worse than today).
 */
export async function resolveCodexWorkingDirectory(realPath) {
  if (!realPath || pathIsHeaderSafe(realPath)) {
    return realPath;
  }

  const resolvedReal = path.resolve(realPath);
  const shadowRoot = getShadowRoot();
  const hash = crypto.createHash('sha1').update(resolvedReal).digest('hex').slice(0, 12);
  const linkPath = path.join(shadowRoot, `${asciiSlug(path.basename(resolvedReal))}-${hash}`);

  // If even the shadow root can't be made ASCII, there's nothing we can do.
  if (!pathIsHeaderSafe(linkPath)) {
    return realPath;
  }

  try {
    await fs.mkdir(shadowRoot, { recursive: true });

    // Reuse an existing, correct symlink; replace anything stale.
    try {
      const current = await fs.readlink(linkPath);
      if (path.resolve(shadowRoot, current) === resolvedReal) {
        return linkPath;
      }
      await fs.rm(linkPath, { force: true });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        await fs.rm(linkPath, { force: true }).catch(() => {});
      }
    }

    await fs.symlink(resolvedReal, linkPath);
    return linkPath;
  } catch (err) {
    if (err.code === 'EEXIST') {
      return linkPath;
    }
    console.warn('[codex] Failed to create ASCII shadow working dir, using real path:', err.message);
    return realPath;
  }
}
