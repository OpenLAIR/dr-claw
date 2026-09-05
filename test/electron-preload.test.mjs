import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');
const mainProcessSource = fs.readFileSync(
  path.join(projectRoot, 'electron', 'main.mjs'),
  'utf8',
);
const preloadSource = fs.readFileSync(
  path.join(projectRoot, 'electron', 'preload.cjs'),
  'utf8',
);

test('sandboxed Electron window uses a CommonJS preload script', () => {
  assert.match(mainProcessSource, /sandbox:\s*true/);
  assert.match(mainProcessSource, /path\.join\(__dirname, ['"]preload\.cjs['"]\)/);
  assert.ok(fs.existsSync(path.join(projectRoot, 'electron', 'preload.cjs')));
  assert.ok(!fs.existsSync(path.join(projectRoot, 'electron', 'preload.mjs')));
});

test('preload does not synchronously access the DOM before it exists', () => {
  assert.doesNotMatch(preloadSource, /document\.documentElement/);
});
