import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { safePath } from '../safePath.js';

// Use a real temporary directory so realpathSync works correctly
let ROOT;

beforeAll(() => {
  // Use realpathSync to normalize macOS /var -> /private/var symlink
  ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'safepath-test-')));
  fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'src', 'index.js'), '');
  fs.writeFileSync(path.join(ROOT, 'lib', 'utils.js'), '');
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('safePath', () => {
  it('resolves relative paths within root', () => {
    const result = safePath('src/index.js', ROOT);
    expect(result).toBe(path.join(ROOT, 'src', 'index.js'));
  });

  it('returns root when path is empty/null/undefined', () => {
    expect(safePath('', ROOT)).toBe(ROOT);
    expect(safePath(null, ROOT)).toBe(ROOT);
    expect(safePath(undefined, ROOT)).toBe(ROOT);
  });

  it('allows absolute paths that land inside root', () => {
    const absInside = path.join(ROOT, 'src', 'index.js');
    const result = safePath(absInside, ROOT);
    expect(result).toBe(absInside);
  });

  it('blocks absolute paths outside root', () => {
    expect(() => safePath('/etc/passwd', ROOT)).toThrow(/Path traversal blocked/);
  });

  it('blocks .. traversal above root', () => {
    expect(() => safePath('../../../etc/shadow', ROOT)).toThrow(/Path traversal blocked/);
  });

  it('blocks .. traversal disguised in deeper path', () => {
    expect(() => safePath('src/../../../../../../etc/passwd', ROOT)).toThrow(
      /Path traversal blocked/,
    );
  });

  it('allows .. that stays within root', () => {
    const result = safePath('src/../lib/utils.js', ROOT);
    expect(result).toBe(path.join(ROOT, 'lib', 'utils.js'));
  });

  it('handles non-existent target gracefully', () => {
    // Non-existent file in existing directory â€?should work
    const result = safePath('src/newfile.js', ROOT);
    expect(result).toBe(path.join(ROOT, 'src', 'newfile.js'));
  });

  it('handles non-existent nested path gracefully', () => {
    // Non-existent nested path â€?should still resolve within root
    const result = safePath('deep/nested/new/file.js', ROOT);
    expect(result.startsWith(ROOT + path.sep)).toBe(true);
  });

  it('normalizes allowedRoot for falsy input', () => {
    // Pass a non-normalized root (with trailing segments) to verify
    // the falsy-input path returns path.resolve(allowedRoot), not the raw string.
    const nonNormalized = ROOT + path.sep + 'src' + path.sep + '..';
    const result = safePath('', nonNormalized);
    expect(result).toBe(ROOT);
  });

  it('allows symlinks inside the project that point outside the root', () => {
    // Simulate: project/data -> /tmp (an external location).
    // This should not be blocked (legitimate workflow: shared datasets, etc.).
    const linkPath = path.join(ROOT, 'external-data');
    let created = false;
    try {
      fs.symlinkSync(os.tmpdir(), linkPath);
      created = true;
      // Logical path is inside root, so safePath should allow it
      const result = safePath('external-data/some-file.csv', ROOT);
      expect(result).toBe(path.join(ROOT, 'external-data', 'some-file.csv'));
    } catch (error) {
      // Some Windows environments deny symlink creation without admin/dev mode.
      const code = typeof error?.code === 'string' ? error.code : '';
      if (code === 'EPERM' || code === 'EACCES') {
        expect(true).toBe(true);
        return;
      }
      throw error;
    } finally {
      if (created) {
        try { fs.unlinkSync(linkPath); } catch { /* ignore cleanup errors */ }
      }
    }
  });
});

