import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceModule = { default: () => null };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../AuthenticatedWorkspace');
});

describe('authenticated workspace loading', () => {
  it('does not import the workspace until requested', async () => {
    const factory = vi.fn(() => workspaceModule);
    vi.doMock('../AuthenticatedWorkspace', factory);

    await import('../loadAuthenticatedWorkspace');

    expect(factory).not.toHaveBeenCalled();
  });

  it('shares an in-flight preload with the authenticated render', async () => {
    let resolveWorkspace!: (value: typeof workspaceModule) => void;
    vi.doMock('../AuthenticatedWorkspace', () => new Promise((resolve) => {
      resolveWorkspace = resolve;
    }));
    const { loadAuthenticatedWorkspace, preloadAuthenticatedWorkspace } =
      await import('../loadAuthenticatedWorkspace');

    preloadAuthenticatedWorkspace();
    const first = loadAuthenticatedWorkspace();
    expect(loadAuthenticatedWorkspace()).toBe(first);
    await vi.waitFor(() => expect(resolveWorkspace).toBeDefined());
    resolveWorkspace(workspaceModule);

    expect((await first).default).toBe(workspaceModule.default);
    expect(loadAuthenticatedWorkspace()).toBe(first);
  });

  it('ignores a failed speculative preload and retries on the next load', async () => {
    const importError = new TypeError('Failed to fetch dynamically imported module');
    vi.doMock('../AuthenticatedWorkspace', () => {
      throw importError;
    });
    const { loadAuthenticatedWorkspace, preloadAuthenticatedWorkspace } =
      await import('../loadAuthenticatedWorkspace');

    expect(preloadAuthenticatedWorkspace()).toBeUndefined();
    const failed = loadAuthenticatedWorkspace();
    // Vitest wraps a throwing module factory and preserves its original cause.
    await expect(failed).rejects.toMatchObject({ cause: importError });
    vi.doMock('../AuthenticatedWorkspace', () => workspaceModule);

    const retry = loadAuthenticatedWorkspace();
    expect(retry).not.toBe(failed);
    expect((await retry).default).toBe(workspaceModule.default);
  });
});
