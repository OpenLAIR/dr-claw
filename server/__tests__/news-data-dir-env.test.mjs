import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../database/db.js', () => ({ credentialsDb: {} }));

const { exposeNewsDataDirToAgents, NEWS_DATA_DIR } = await import('../routes/news.js');

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('exposeNewsDataDirToAgents', () => {
  it('points agents at the news data directory when nothing is set', () => {
    const env = {};
    expect(exposeNewsDataDirToAgents(env)).toBe(path.join(serverDir, 'data'));
    expect(env.DRCLAW_NEWS_DATA_DIR).toBe(NEWS_DATA_DIR);
  });

  it('keeps a directory the user already set', () => {
    const env = { DRCLAW_NEWS_DATA_DIR: '/custom/news' };
    expect(exposeNewsDataDirToAgents(env)).toBe('/custom/news');
    expect(env.DRCLAW_NEWS_DATA_DIR).toBe('/custom/news');
  });
});
