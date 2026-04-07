import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import { safePath } from '../safePath.js';

const ROOT = '/tmp/test-project';

describe('safePath', () => {
  it('resolves relative paths within root', () => {
    const result = safePath('src/index.js', ROOT);
    assert.equal(result, path.resolve(ROOT, 'src/index.js'));
  });

  it('returns root when path is empty/null/undefined', () => {
    assert.equal(safePath('', ROOT), ROOT);
    assert.equal(safePath(null, ROOT), ROOT);
    assert.equal(safePath(undefined, ROOT), ROOT);
  });

  it('allows absolute paths that land inside root', () => {
    const absInside = path.join(ROOT, 'src/file.js');
    const result = safePath(absInside, ROOT);
    assert.ok(result.startsWith(ROOT));
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
    assert.equal(result, path.resolve(ROOT, 'lib/utils.js'));
  });

  it('blocks home directory references via traversal', () => {
    assert.throws(
      () => safePath(`../${path.relative(path.dirname(ROOT), os.homedir())}/.ssh/id_rsa`, ROOT),
      /Path traversal blocked/,
    );
  });

  it('blocks null bytes in path', () => {
    // Null bytes should not bypass the check
    assert.throws(
      () => safePath('src/\0/../../../etc/passwd', ROOT),
      // Either our check catches it or Node's fs throws
      (err) => err instanceof Error,
    );
  });
});
