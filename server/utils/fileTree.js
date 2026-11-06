import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';

// Heavy build and VCS directories that the project file tree never lists
// (the directory browser still shows them).
const SKIPPED_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '.git', '.svn', '.hg']);

export function permToRwx(perm) {
    const r = perm & 4 ? 'r' : '-';
    const w = perm & 2 ? 'w' : '-';
    const x = perm & 1 ? 'x' : '-';
    return r + w + x;
}

/**
 * List a directory tree for the file tree panel.
 *
 * Directories are walked up to `maxDepth`. A directory that is not walked
 * gets `children: null`, which tells the client to fetch it on expand
 * (`GET /api/projects/:name/files?path=<dir>&maxDepth=2`). That applies to
 * directories below `maxDepth` and to every symlinked directory: projects link
 * ~170 shared skill folders into each of .claude/skills, .agents/skills,
 * .cursor/skills and .gemini/skills, and following them made a project with a
 * few hundred files of its own return thousands of entries. A symlink is still
 * listed as a directory, so it looks and expands as before.
 */
export async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true, isBrowsing = false) {
    const items = [];

    try {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!showHidden && entry.name.startsWith('.')) continue;

            // Skip heavy build directories and VCS directories unless we are browsing
            if (!isBrowsing && SKIPPED_DIR_NAMES.has(entry.name)) continue;

            const itemPath = path.join(dirPath, entry.name);
            const isSymlink = entry.isSymbolicLink();
            let isDirectory = entry.isDirectory();

            // stat() follows the link, so a symlinked directory (e.g. .claude/skills/*)
            // is listed as a directory and reports its target's metadata.
            let stats = null;
            try {
                stats = await fsPromises.stat(itemPath);
                if (isSymlink) isDirectory = stats.isDirectory();
            } catch (_) {
                // Broken symlink or inaccessible target; keep as file.
            }

            const item = {
                name: entry.name,
                path: itemPath,
                type: isDirectory ? 'directory' : 'file'
            };
            if (isSymlink) item.isSymlink = true;

            if (stats) {
                item.size = stats.size;
                item.modified = stats.mtime.toISOString();

                // Convert permissions to rwx format
                const mode = stats.mode;
                const ownerPerm = (mode >> 6) & 7;
                const groupPerm = (mode >> 3) & 7;
                const otherPerm = mode & 7;
                item.permissions = ownerPerm.toString() + groupPerm.toString() + otherPerm.toString();
                item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
            } else {
                item.size = 0;
                item.modified = null;
                item.permissions = '000';
                item.permissionsRwx = '---------';
            }

            if (isDirectory) {
                if (isSymlink || currentDepth >= maxDepth) {
                    // Not walked here; the client loads it when the folder is expanded.
                    item.children = null;
                } else {
                    try {
                        // Check if we can access the directory before trying to read it
                        await fsPromises.access(item.path, fs.constants.R_OK);
                        item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
                    } catch (e) {
                        // Silently skip directories we can't access (permission denied, etc.)
                        item.children = [];
                    }
                }
            }

            items.push(item);
        }
    } catch (error) {
        // Only log non-permission errors to avoid spam
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
            console.error('Error reading directory:', error);
        }
    }

    return items.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}
