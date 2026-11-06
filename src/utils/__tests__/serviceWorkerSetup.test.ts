import { describe, expect, it, vi } from 'vitest';

import { setupServiceWorker } from '../serviceWorkerSetup.js';

function fakeEnvironment() {
  const unregister = vi.fn().mockResolvedValue(true);
  const serviceWorker = {
    register: vi.fn().mockResolvedValue({}),
    getRegistrations: vi.fn().mockResolvedValue([{ unregister }, { unregister }]),
  };
  const cacheStorage = {
    keys: vi.fn().mockResolvedValue(['dr-claw-ui-v3', 'other-app-cache']),
    delete: vi.fn().mockResolvedValue(true),
  };
  const loadCallbacks: Array<() => void> = [];
  const onLoad = (callback: () => void) => { loadCallbacks.push(callback); };
  return { serviceWorker, cacheStorage, unregister, onLoad, loadCallbacks };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('setupServiceWorker', () => {
  it('registers the worker after load in a web production build', () => {
    const env = fakeEnvironment();
    expect(setupServiceWorker({ ...env, isProduction: true, isElectron: false })).toBe('register');
    expect(env.serviceWorker.register).not.toHaveBeenCalled();
    env.loadCallbacks.forEach((callback) => callback());
    expect(env.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
  });

  it('removes workers and UI caches left by an earlier install in the desktop app', async () => {
    const env = fakeEnvironment();
    expect(setupServiceWorker({ ...env, isProduction: true, isElectron: true })).toBe('remove');
    await flush();

    expect(env.serviceWorker.register).not.toHaveBeenCalled();
    expect(env.unregister).toHaveBeenCalledTimes(2);
    expect(env.cacheStorage.delete).toHaveBeenCalledTimes(1);
    expect(env.cacheStorage.delete).toHaveBeenCalledWith('dr-claw-ui-v3');
  });

  it('removes workers in development', async () => {
    const env = fakeEnvironment();
    expect(setupServiceWorker({ ...env, isProduction: false, isElectron: false })).toBe('remove');
    await flush();
    expect(env.unregister).toHaveBeenCalledTimes(2);
  });

  it('does nothing without service worker support', () => {
    expect(setupServiceWorker({
      isProduction: true,
      isElectron: false,
      serviceWorker: undefined,
      cacheStorage: undefined,
      onLoad: () => {},
    })).toBe('unsupported');
  });
});
