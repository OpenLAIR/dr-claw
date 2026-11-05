/**
 * Persistent, incremental cache of the `cwd` statistics that
 * `extractProjectDirectory()` derives from Claude CLI transcripts
 * (`~/.claude/projects/<dir>/*.jsonl`).
 *
 * Why: the project a transcript directory belongs to is recovered by reading
 * every line of every transcript in it. That result only lived in memory, so
 * every server start (every desktop app launch) re-read the whole history. On a
 * machine with ~6 GB of transcripts the first `/api/projects` and session
 * message requests after a launch took 15-35 s, and the UI showed empty panels
 * and fetch errors in the meantime.
 *
 * Transcripts are append-only, so the per-file statistics are a fold over lines:
 * we store the fold state together with the byte offset it covers and, on the
 * next start, skip unchanged files entirely and resume changed ones from that
 * offset. Results are identical to a full read:
 * - counts keep first-seen order (the caller breaks ties by Map order);
 * - the latest timestamp uses a strict `>`, so merging per-file results in
 *   directory order picks the same line as one pass over all files;
 * - an unterminated final line is applied to a throwaway copy of the state,
 *   exactly like `readline` would have parsed it, but is never stored.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { readJsonlLinesFrom } from './jsonlTailReader.js';

const CACHE_VERSION = 1;
const HEAD_SIGNATURE_BYTES = 256;
const DEFAULT_FLUSH_DELAY_MS = 2000;

function createEmptyFold() {
  return { counts: new Map(), latestTimestamp: 0, latestCwd: null };
}

function cloneFold(fold) {
  return {
    counts: new Map(fold.counts),
    latestTimestamp: fold.latestTimestamp,
    latestCwd: fold.latestCwd,
  };
}

/** Same per-line rule as the original full scan in extractProjectDirectory(). */
export function applyCwdLine(fold, line) {
  try {
    const entry = JSON.parse(line);
    if (entry.cwd) {
      fold.counts.set(entry.cwd, (fold.counts.get(entry.cwd) || 0) + 1);
      const timestamp = new Date(entry.timestamp || 0).getTime();
      if (timestamp > fold.latestTimestamp) {
        fold.latestTimestamp = timestamp;
        fold.latestCwd = entry.cwd;
      }
    }
  } catch {
    // Skip malformed lines, like the original scan.
  }
}

/**
 * Merge per-file folds (in directory listing order) into the statistics a
 * single pass over all those files would have produced.
 */
export function mergeCwdFolds(folds) {
  const merged = createEmptyFold();
  for (const fold of folds) {
    for (const [cwd, count] of fold.counts) {
      merged.counts.set(cwd, (merged.counts.get(cwd) || 0) + count);
    }
    if (fold.latestTimestamp > merged.latestTimestamp) {
      merged.latestTimestamp = fold.latestTimestamp;
      merged.latestCwd = fold.latestCwd;
    }
  }
  return merged;
}

async function readHeadSignature(filePath, length) {
  if (length <= 0) return '';
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString('base64');
  } finally {
    await handle.close();
  }
}

function serializeEntry(entry) {
  return {
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    offset: entry.offset,
    head: entry.head,
    counts: [...entry.fold.counts],
    latestTimestamp: entry.fold.latestTimestamp,
    latestCwd: entry.fold.latestCwd,
    trailing: entry.trailing,
  };
}

function deserializeEntry(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.counts)) return null;
  if (!Number.isFinite(raw.size) || !Number.isFinite(raw.offset) || !Number.isFinite(raw.mtimeMs)) return null;
  return {
    size: raw.size,
    mtimeMs: raw.mtimeMs,
    offset: raw.offset,
    head: typeof raw.head === 'string' ? raw.head : '',
    fold: {
      counts: new Map(raw.counts),
      latestTimestamp: Number.isFinite(raw.latestTimestamp) ? raw.latestTimestamp : 0,
      latestCwd: raw.latestCwd ?? null,
    },
    trailing: typeof raw.trailing === 'string' ? raw.trailing : null,
  };
}

/**
 * @param {object} options
 * @param {string|null} options.cacheFile JSON file to persist to; null keeps the cache in memory only.
 * @param {number} [options.flushDelayMs]
 */
export function createClaudeCwdFoldCache({ cacheFile, flushDelayMs = DEFAULT_FLUSH_DELAY_MS } = {}) {
  let entries = null; // Map<absolute file path, entry>
  let loadPromise = null;
  let dirty = false;
  let flushTimer = null;
  let flushPromise = null;
  const stats = { reused: 0, resumed: 0, rescanned: 0 };

  async function load() {
    if (entries) return entries;
    if (!loadPromise) {
      loadPromise = (async () => {
        const loaded = new Map();
        if (cacheFile) {
          try {
            const raw = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
            if (raw?.version === CACHE_VERSION && raw.files && typeof raw.files === 'object') {
              for (const [filePath, value] of Object.entries(raw.files)) {
                const entry = deserializeEntry(value);
                if (entry) loaded.set(filePath, entry);
              }
            }
          } catch (error) {
            if (error.code !== 'ENOENT') {
              console.warn('[projects] Ignoring unreadable Claude cwd cache:', error.message);
            }
          }
        }
        entries = loaded;
        return entries;
      })();
    }
    return loadPromise;
  }

  function scheduleFlush() {
    dirty = true;
    if (!cacheFile || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, flushDelayMs);
    flushTimer.unref?.();
  }

  async function flush() {
    if (!cacheFile || !entries || !dirty) return;
    if (flushPromise) {
      await flushPromise;
      if (!dirty) return;
    }
    dirty = false;
    const payload = { version: CACHE_VERSION, files: {} };
    for (const [filePath, entry] of entries) {
      payload.files[filePath] = serializeEntry(entry);
    }
    flushPromise = (async () => {
      const tmpFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(tmpFile, JSON.stringify(payload), 'utf8');
        await fs.rename(tmpFile, cacheFile);
      } catch (error) {
        console.warn('[projects] Could not save Claude cwd cache:', error.message);
        await fs.rm(tmpFile, { force: true }).catch(() => {});
      }
    })();
    try {
      await flushPromise;
    } finally {
      flushPromise = null;
    }
  }

  async function canResume(filePath, cached, stat) {
    if (stat.size < cached.offset) return false;
    const headLength = Math.min(HEAD_SIGNATURE_BYTES, cached.offset);
    if (headLength === 0) return cached.offset === 0;
    return (await readHeadSignature(filePath, headLength)) === cached.head;
  }

  /**
   * Fold one transcript, reusing or resuming the cached state when possible.
   * Returns null when the file disappeared.
   */
  async function foldFile(filePath) {
    const cache = await load();
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (cache.delete(filePath)) scheduleFlush();
        return null;
      }
      throw error;
    }

    const cached = cache.get(filePath);
    let fold;
    let startOffset = 0;

    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      stats.reused += 1;
      const result = cloneFold(cached.fold);
      if (cached.trailing) applyCwdLine(result, cached.trailing);
      return result;
    }

    if (cached && await canResume(filePath, cached, stat)) {
      stats.resumed += 1;
      fold = cloneFold(cached.fold);
      startOffset = cached.offset;
    } else {
      stats.rescanned += 1;
      fold = createEmptyFold();
    }

    const { consumedBytes, trailingLine } = await readJsonlLinesFrom(filePath, startOffset, (line) => {
      applyCwdLine(fold, line);
    });

    const entry = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      offset: consumedBytes,
      head: await readHeadSignature(filePath, Math.min(HEAD_SIGNATURE_BYTES, consumedBytes)),
      fold,
      trailing: trailingLine,
    };
    cache.set(filePath, entry);
    scheduleFlush();

    const result = cloneFold(fold);
    if (trailingLine) applyCwdLine(result, trailingLine);
    return result;
  }

  /**
   * Fold every transcript of a directory (in the given order) into one result,
   * and forget cached files of that directory that no longer exist.
   */
  async function foldDirectory(projectDir, jsonlFileNames) {
    const cache = await load();
    const present = new Set(jsonlFileNames.map((name) => path.join(projectDir, name)));
    for (const filePath of cache.keys()) {
      if (path.dirname(filePath) === projectDir && !present.has(filePath)) {
        cache.delete(filePath);
        dirty = true;
      }
    }

    const folds = [];
    for (const name of jsonlFileNames) {
      const fold = await foldFile(path.join(projectDir, name));
      if (fold) folds.push(fold);
    }
    return mergeCwdFolds(folds);
  }

  return {
    foldFile,
    foldDirectory,
    flush,
    stats,
  };
}
