import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('desktop platform constants', () => {
  it('recognizes macOS Electron from the preload bridge', async () => {
    vi.stubGlobal('window', { isElectron: true, electronPlatform: 'darwin' });

    const { isElectron, isMacElectron } = await import('../useDesktop');

    expect(isElectron).toBe(true);
    expect(isMacElectron).toBe(true);
  });

  it('does not apply the macOS safe zone on Windows Electron', async () => {
    vi.stubGlobal('window', { isElectron: true, electronPlatform: 'win32' });

    const { isElectron, isMacElectron } = await import('../useDesktop');

    expect(isElectron).toBe(true);
    expect(isMacElectron).toBe(false);
  });
});
