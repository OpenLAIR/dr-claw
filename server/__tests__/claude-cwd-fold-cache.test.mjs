import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { applyCwdLine, createClaudeCwdFoldCache } from '../utils/claudeCwdFoldCache.js';

let tempRoot = null;
let projectDir = null;

// The original extractProjectDirectory() statistics: one pass over every line
// of every file, in directory order.
async function fullScan(dir, fileNames) {
  const fold = { counts: new Map(), latestTimestamp: 0, latestCwd: null };
  for (const name of fileNames) {
    const text = await readFile(path.join(dir, name), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim()) applyCwdLine(fold, line);
    }
  }
  return fold;
}

function line(cwd, timestamp, extra = {}) {
  return `${JSON.stringify({ type: 'user', cwd, timestamp, ...extra })}\n`;
}

function asPlain(fold) {
  return { counts: [...fold.counts], latestTimestamp: fold.latestTimestamp, latestCwd: fold.latestCwd };
}

describe('Claude cwd fold cache', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-cwd-cache-'));
    projectDir = path.join(tempRoot, 'projects', '-repo');
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('matches a full scan across files, including tie order and the latest cwd', async () => {
    await writeFile(path.join(projectDir, 'a.jsonl'),
      line('/repo', '2026-01-01T00:00:00Z')
      + 'not json\n'
      + line('/repo/sub', '2026-01-03T00:00:00Z')
      + line('/repo', '2026-01-02T00:00:00Z'));
    await writeFile(path.join(projectDir, 'b.jsonl'),
      line('/other', '2026-01-03T00:00:00Z') // same timestamp as a.jsonl: first one wins
      + JSON.stringify({ type: 'summary' }) + '\n'
      + line('/repo/sub', null));

    const files = ['a.jsonl', 'b.jsonl'];
    const cache = createClaudeCwdFoldCache({ cacheFile: null });
    const result = await cache.foldDirectory(projectDir, files);

    expect(asPlain(result)).toEqual(asPlain(await fullScan(projectDir, files)));
    expect([...result.counts.keys()]).toEqual(['/repo', '/repo/sub', '/other']);
    expect(result.latestCwd).toBe('/repo/sub');
  });

  it('reuses unchanged files and resumes appended ones from the stored offset', async () => {
    const file = path.join(projectDir, 's.jsonl');
    await writeFile(file, line('/repo', '2026-01-01T00:00:00Z'));
    const cache = createClaudeCwdFoldCache({ cacheFile: null });

    await cache.foldDirectory(projectDir, ['s.jsonl']);
    expect(cache.stats).toMatchObject({ rescanned: 1, resumed: 0, reused: 0 });

    await cache.foldDirectory(projectDir, ['s.jsonl']);
    expect(cache.stats).toMatchObject({ rescanned: 1, resumed: 0, reused: 1 });

    await appendFile(file, line('/repo/deep', '2026-02-01T00:00:00Z'));
    const result = await cache.foldDirectory(projectDir, ['s.jsonl']);
    expect(cache.stats).toMatchObject({ rescanned: 1, resumed: 1, reused: 1 });
    expect(asPlain(result)).toEqual(asPlain(await fullScan(projectDir, ['s.jsonl'])));
  });

  it('rescans a file that was rewritten instead of appended to', async () => {
    const file = path.join(projectDir, 's.jsonl');
    await writeFile(file, line('/first', '2026-01-01T00:00:00Z'));
    const cache = createClaudeCwdFoldCache({ cacheFile: null });
    await cache.foldDirectory(projectDir, ['s.jsonl']);

    await writeFile(file, line('/second', '2026-01-01T00:00:00Z') + line('/second', '2026-01-02T00:00:00Z'));
    const result = await cache.foldDirectory(projectDir, ['s.jsonl']);

    expect(cache.stats.rescanned).toBe(2);
    expect([...result.counts]).toEqual([['/second', 2]]);
  });

  it('counts an unterminated last line without storing it twice', async () => {
    const file = path.join(projectDir, 's.jsonl');
    const partial = line('/repo/tail', '2026-03-01T00:00:00Z').trimEnd();
    await writeFile(file, line('/repo', '2026-01-01T00:00:00Z') + partial);
    const cache = createClaudeCwdFoldCache({ cacheFile: null });

    const first = await cache.foldDirectory(projectDir, ['s.jsonl']);
    expect([...first.counts]).toEqual([['/repo', 1], ['/repo/tail', 1]]);
    expect(first.latestCwd).toBe('/repo/tail');

    // The writer finishes the line; it must still count once.
    await appendFile(file, '\n');
    const second = await cache.foldDirectory(projectDir, ['s.jsonl']);
    expect([...second.counts]).toEqual([['/repo', 1], ['/repo/tail', 1]]);
    expect(cache.stats.resumed).toBe(1);
  });

  it('persists to disk so a new server process reuses the work', async () => {
    const cacheFile = path.join(tempRoot, 'cache', 'cwds.json');
    await writeFile(path.join(projectDir, 's.jsonl'), line('/repo', '2026-01-01T00:00:00Z'));

    const first = createClaudeCwdFoldCache({ cacheFile });
    await first.foldDirectory(projectDir, ['s.jsonl']);
    await first.flush();

    const second = createClaudeCwdFoldCache({ cacheFile });
    const result = await second.foldDirectory(projectDir, ['s.jsonl']);
    expect(second.stats).toMatchObject({ reused: 1, rescanned: 0 });
    expect([...result.counts]).toEqual([['/repo', 1]]);
  });

  it('ignores a corrupt cache file and forgets transcripts that were deleted', async () => {
    const cacheFile = path.join(tempRoot, 'cache', 'cwds.json');
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, '{not json');
    await writeFile(path.join(projectDir, 'a.jsonl'), line('/a', '2026-01-01T00:00:00Z'));
    await writeFile(path.join(projectDir, 'b.jsonl'), line('/b', '2026-01-01T00:00:00Z'));

    const cache = createClaudeCwdFoldCache({ cacheFile });
    await cache.foldDirectory(projectDir, ['a.jsonl', 'b.jsonl']);
    await rm(path.join(projectDir, 'b.jsonl'));
    const result = await cache.foldDirectory(projectDir, ['a.jsonl']);
    await cache.flush();

    expect([...result.counts]).toEqual([['/a', 1]]);
    const saved = JSON.parse(await readFile(cacheFile, 'utf8'));
    expect(Object.keys(saved.files)).toEqual([path.join(projectDir, 'a.jsonl')]);
  });
});
