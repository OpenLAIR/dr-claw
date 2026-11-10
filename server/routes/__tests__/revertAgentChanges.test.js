import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import { revertFilesAtProjectPath } from '../git.js';

let REPO;

function run(cmd, args, opts = {}) {
  execSync(`${cmd} ${args.map(a => JSON.stringify(a)).join(' ')}`, {
    cwd: REPO,
    stdio: 'pipe',
    ...opts,
  });
}

beforeEach(() => {
  // Resolve symlinks (e.g. macOS /var -> /private/var) so git paths match.
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'revert-test-')));
  run('git', ['init', '-q', '-b', 'main']);
  run('git', ['config', 'user.email', 'test@example.com']);
  run('git', ['config', 'user.name', 'Test']);
  run('git', ['config', 'commit.gpgsign', 'false']);

  fs.writeFileSync(path.join(REPO, 'a.txt'), 'original-a\n');
  fs.writeFileSync(path.join(REPO, 'b.txt'), 'original-b\n');
  run('git', ['add', '.']);
  run('git', ['commit', '-q', '-m', 'initial']);
});

afterEach(() => {
  fs.rmSync(REPO, { recursive: true, force: true });
});

describe('revertFilesAtProjectPath', () => {
  it('restores a modified tracked file', async () => {
    fs.writeFileSync(path.join(REPO, 'a.txt'), 'agent-modified\n');

    const result = await revertFilesAtProjectPath(REPO, ['a.txt']);

    expect(result.success).toBe(true);
    expect(result.reverted).toEqual(['a.txt']);
    expect(result.errors).toEqual([]);
    expect(fs.readFileSync(path.join(REPO, 'a.txt'), 'utf8')).toBe('original-a\n');
  });

  it('deletes an untracked file (agent created new)', async () => {
    fs.writeFileSync(path.join(REPO, 'new.txt'), 'agent-new\n');

    const result = await revertFilesAtProjectPath(REPO, ['new.txt']);

    expect(result.success).toBe(true);
    expect(result.reverted).toEqual(['new.txt']);
    expect(fs.existsSync(path.join(REPO, 'new.txt'))).toBe(false);
  });

  it('unstages and removes a staged-added file', async () => {
    fs.writeFileSync(path.join(REPO, 'staged.txt'), 'staged-add\n');
    run('git', ['add', 'staged.txt']);

    const result = await revertFilesAtProjectPath(REPO, ['staged.txt']);

    expect(result.success).toBe(true);
    expect(result.reverted).toEqual(['staged.txt']);
    expect(fs.existsSync(path.join(REPO, 'staged.txt'))).toBe(false);
  });

  it('leaves untouched files alone (preserves user manual edits)', async () => {
    // Agent modifies a.txt; user separately modifies b.txt.
    fs.writeFileSync(path.join(REPO, 'a.txt'), 'agent-edit\n');
    fs.writeFileSync(path.join(REPO, 'b.txt'), 'user-edit\n');

    const result = await revertFilesAtProjectPath(REPO, ['a.txt']);

    expect(result.success).toBe(true);
    expect(result.reverted).toEqual(['a.txt']);
    // User's manual edit to b.txt must be preserved.
    expect(fs.readFileSync(path.join(REPO, 'b.txt'), 'utf8')).toBe('user-edit\n');
  });

  it('skips files with no changes', async () => {
    const result = await revertFilesAtProjectPath(REPO, ['a.txt']);

    expect(result.success).toBe(true);
    expect(result.reverted).toEqual([]);
    expect(result.skipped).toEqual(['a.txt']);
  });

  it('handles multiple files with mixed states in one call', async () => {
    fs.writeFileSync(path.join(REPO, 'a.txt'), 'mod-a\n');
    fs.writeFileSync(path.join(REPO, 'created.txt'), 'new\n');
    // b.txt has no changes

    const result = await revertFilesAtProjectPath(REPO, ['a.txt', 'created.txt', 'b.txt']);

    expect(result.reverted.sort()).toEqual(['a.txt', 'created.txt']);
    expect(result.skipped).toEqual(['b.txt']);
    expect(result.errors).toEqual([]);
  });

  it('rejects paths that escape the project root', async () => {
    const result = await revertFilesAtProjectPath(REPO, ['../outside.txt']);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe('../outside.txt');
    // safePath throws with "Path traversal blocked"
    expect(result.errors[0].reason).toMatch(/traversal/i);
  });

  it('deduplicates repeated file entries', async () => {
    fs.writeFileSync(path.join(REPO, 'a.txt'), 'mod\n');

    const result = await revertFilesAtProjectPath(REPO, ['a.txt', 'a.txt', 'a.txt']);

    expect(result.reverted).toEqual(['a.txt']);
  });

  it('returns empty result for empty files array', async () => {
    const result = await revertFilesAtProjectPath(REPO, []);
    expect(result).toEqual({ success: true, reverted: [], skipped: [], errors: [] });
  });

  it('restores a tracked file that the agent deleted', async () => {
    fs.unlinkSync(path.join(REPO, 'a.txt'));

    const result = await revertFilesAtProjectPath(REPO, ['a.txt']);

    expect(result.success).toBe(true);
    expect(result.reverted).toEqual(['a.txt']);
    expect(fs.readFileSync(path.join(REPO, 'a.txt'), 'utf8')).toBe('original-a\n');
  });

  it('refuses to recursively delete an untracked directory', async () => {
    const dirPath = path.join(REPO, 'agent-dir');
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, 'inner.txt'), 'inner\n');

    const result = await revertFilesAtProjectPath(REPO, ['agent-dir']);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/directory/i);
    // Directory must still exist
    expect(fs.existsSync(dirPath)).toBe(true);
  });

  it('deletes a symlink itself rather than following it out of the repo', async () => {
    // Create an external target the symlink would point to
    const externalFile = fs.mkdtempSync(path.join(os.tmpdir(), 'external-target-'));
    const externalPath = path.join(externalFile, 'outside.txt');
    fs.writeFileSync(externalPath, 'do-not-touch\n');

    // Symlink inside the repo pointing out
    const linkPath = path.join(REPO, 'agent-link');
    fs.symlinkSync(externalPath, linkPath);

    const result = await revertFilesAtProjectPath(REPO, ['agent-link']);

    expect(result.success).toBe(true);
    expect(result.reverted).toEqual(['agent-link']);
    // Symlink removed
    expect(fs.existsSync(linkPath)).toBe(false);
    // External file untouched — critical safety guarantee
    expect(fs.existsSync(externalPath)).toBe(true);
    expect(fs.readFileSync(externalPath, 'utf8')).toBe('do-not-touch\n');

    fs.rmSync(externalFile, { recursive: true, force: true });
  });

  it('handles renamed files by skipping (explicitly not auto-guessed)', async () => {
    run('git', ['mv', 'a.txt', 'a-renamed.txt']);

    const result = await revertFilesAtProjectPath(REPO, ['a-renamed.txt']);

    expect(result.success).toBe(true);
    expect(result.skipped).toEqual(['a-renamed.txt']);
    expect(result.reverted).toEqual([]);
    // Rename must be left intact — user can resolve manually.
    expect(fs.existsSync(path.join(REPO, 'a-renamed.txt'))).toBe(true);
  });

  it('skips rename-with-modification (RM status)', async () => {
    run('git', ['mv', 'a.txt', 'a-renamed.txt']);
    // Now modify the renamed file so git status shows RM
    fs.writeFileSync(path.join(REPO, 'a-renamed.txt'), 'renamed-and-modified\n');

    const result = await revertFilesAtProjectPath(REPO, ['a-renamed.txt']);

    expect(result.skipped).toEqual(['a-renamed.txt']);
    expect(result.reverted).toEqual([]);
    // Both sides of the rename remain intact.
    expect(fs.readFileSync(path.join(REPO, 'a-renamed.txt'), 'utf8')).toBe('renamed-and-modified\n');
  });

  it('handles filenames containing a literal " -> " sequence', async () => {
    // NUL-delimited porcelain parsing should not confuse this with rename output.
    const weirdName = 'weird -> name.txt';
    fs.writeFileSync(path.join(REPO, weirdName), 'original\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-q', '-m', 'add weird']);

    fs.writeFileSync(path.join(REPO, weirdName), 'agent-edit\n');

    const result = await revertFilesAtProjectPath(REPO, [weirdName]);

    expect(result.success).toBe(true);
    expect(result.reverted).toEqual([weirdName]);
    expect(fs.readFileSync(path.join(REPO, weirdName), 'utf8')).toBe('original\n');
  });

  it('fully restores a file with both staged and worktree modifications (MM)', async () => {
    // First edit staged
    fs.writeFileSync(path.join(REPO, 'a.txt'), 'staged-edit\n');
    run('git', ['add', 'a.txt']);
    // Second edit unstaged — yields MM status
    fs.writeFileSync(path.join(REPO, 'a.txt'), 'worktree-edit\n');

    const result = await revertFilesAtProjectPath(REPO, ['a.txt']);

    expect(result.success).toBe(true);
    expect(result.reverted).toEqual(['a.txt']);
    // Both staged and worktree must be back at HEAD.
    expect(fs.readFileSync(path.join(REPO, 'a.txt'), 'utf8')).toBe('original-a\n');
    const diff = execSync('git diff HEAD -- a.txt', { cwd: REPO, encoding: 'utf8' });
    expect(diff).toBe('');
    const staged = execSync('git diff --cached -- a.txt', { cwd: REPO, encoding: 'utf8' });
    expect(staged).toBe('');
  });
});
