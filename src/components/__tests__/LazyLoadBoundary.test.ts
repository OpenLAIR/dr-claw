import { describe, expect, it } from 'vitest';

import { isChunkLoadError } from '../LazyLoadBoundary';

describe('isChunkLoadError', () => {
  it.each([
    ['Chromium / Vite', new TypeError('Failed to fetch dynamically imported module: https://x/assets/Settings-abc.js')],
    ['Firefox', new TypeError('error loading dynamically imported module: https://x/assets/Settings-abc.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['webpack-style', Object.assign(new Error('Loading chunk 42 failed.'), { name: 'ChunkLoadError' })],
    ['plain string', 'ChunkLoadError: Loading chunk vendors failed'],
  ])('recognises a %s chunk-load failure', (_label, error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it.each([
    ['a runtime TypeError', new TypeError("Cannot read properties of undefined (reading 'map')")],
    ['a thrown string', 'render exploded'],
    ['a network error unrelated to modules', new TypeError('Failed to fetch')],
    ['null', null],
    ['undefined', undefined],
  ])('does not classify %s as a chunk-load failure', (_label, error) => {
    expect(isChunkLoadError(error)).toBe(false);
  });
});
