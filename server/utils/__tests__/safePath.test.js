import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { safePath } from '../safePath.js';

// Use a real temporary directory so realpathSync works correctly
let ROOT;

before(() => {
  // Use realpathSync to normalize macOS /var -> /private/var symlink
  ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'safepath-test-')));
  fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'src', 'index.js'), '');
  fs.writeFileSync(path.join(ROOT, 'lib', 'utils.js'), '');
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('safePath', () => {
  it('resolves relative paths within root', () => {
    const result = safePath('src/index.js', ROOT);
    assert.equal(result, path.join(ROOT, 'src', 'index.js'));
  });

  it('returns root when path is empty/null/undefined', () => {
    assert.equal(safePath('', ROOT), ROOT);
    assert.equal(safePath(null, ROOT), ROOT);
    assert.equal(safePath(undefined, ROOT), ROOT);
  });

  it('allows absolute paths that land inside root', () => {
    const absInside = path.join(ROOT, 'src', 'index.js');
    const result = safePath(absInside, ROOT);
    assert.equal(result, absInside);
  });

  it('blocks absolute paths outside root', () => {
    assert.throws(
      () => safePath('/etc/passwd', ROOT),
      /Path traversal blocked/,
    );
  });

  it('blocks .. traversal above root', () => {
    assert.throws(
      () => safePath('../../../etc/shadow', ROOT),
      /Path traversal blocked/,
    );
  });

  it('blocks .. traversal disguised in deeper path', () => {
    assert.throws(
      () => safePath('src/../../../../../../etc/passwd', ROOT),
      /Path traversal blocked/,
    );
  });

  it('allows .. that stays within root', () => {
    const result = safePath('src/../lib/utils.js', ROOT);
    assert.equal(result, path.join(ROOT, 'lib', 'utils.js'));
  });

  it('handles non-existent target gracefully', () => {
    // Non-existent file in existing directory — should work
    const result = safePath('src/newfile.js', ROOT);
    assert.equal(result, path.join(ROOT, 'src', 'newfile.js'));
  });

  it('handles non-existent nested path gracefully', () => {
    // Non-existent nested path — should still resolve within root
    const result = safePath('deep/nested/new/file.js', ROOT);
    assert.ok(result.startsWith(ROOT + path.sep));
  });
});
