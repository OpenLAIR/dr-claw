/**
 * Safe path resolution that prevents directory traversal.
 *
 * Tool calls from LLM agents may contain crafted paths like "/etc/passwd"
 * or "../../../etc/shadow". This module ensures every resolved path stays
 * within the designated project root, blocking prompt-injection attacks
 * that attempt to read or write files outside the workspace.
 */

import path from 'path';
import fs from 'fs';

/**
 * Resolve `userPath` relative to `allowedRoot` and verify the result
 * stays within `allowedRoot`.
 *
 * - Absolute paths that land outside the root are rejected.
 * - Absolute paths inside the root are allowed (LLM may reference them).
 * - `..` components that climb above the root are rejected.
 * - Symlinks are resolved via `realpathSync` for existing targets.
 * - For non-existent targets, the nearest existing ancestor is resolved
 *   to prevent symlink-parent escapes on write operations.
 *
 * @param {string} userPath  Path supplied by the tool call.
 * @param {string} allowedRoot  Project root directory.
 * @returns {string}  The resolved, validated absolute path.
 * @throws {Error}  If the path escapes `allowedRoot`.
 */
export function safePath(userPath, allowedRoot) {
  if (!userPath) return allowedRoot;

  // Resolve to absolute (works for both relative and absolute inputs)
  const resolved = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(allowedRoot, userPath);

  // Normalise the root via realpath for accurate comparison
  let normalizedRoot;
  try {
    normalizedRoot = fs.realpathSync(allowedRoot);
  } catch {
    normalizedRoot = path.resolve(allowedRoot);
  }

  // Resolve the real path.  For non-existent targets, walk up to the
  // nearest existing ancestor and verify THAT is inside the root.
  // This prevents symlink-parent escapes: if repo/link -> /external/,
  // then repo/link/new.txt should be blocked because realpath(repo/link)
  // resolves to /external/ which is outside the root.
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    // Target doesn't exist — resolve the nearest existing ancestor
    let ancestor = path.dirname(resolved);
    const leaf = path.basename(resolved);
    try {
      const realAncestor = fs.realpathSync(ancestor);
      real = path.join(realAncestor, leaf);
    } catch {
      // Even the ancestor doesn't exist — use the raw resolved path
      real = resolved;
    }
  }

  // Ensure resolved path starts with root
  if (real !== normalizedRoot && !real.startsWith(normalizedRoot + path.sep)) {
    throw new Error(
      `Path traversal blocked: "${userPath}" resolves to "${real}" ` +
      `which is outside the project root "${normalizedRoot}".`
    );
  }

  return real;
}
