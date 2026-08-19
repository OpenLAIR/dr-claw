import { describe, expect, it } from 'vitest';
import path from 'path';
import { resolveCodexHome } from '../codexHome.js';

describe('resolveCodexHome', () => {
  it('uses the default home-scoped state directory', () => {
    expect(resolveCodexHome({}, '/srv/users/alice')).toBe(path.join('/srv/users/alice', '.codex'));
  });

  it('honors an absolute CODEX_HOME', () => {
    expect(resolveCodexHome({ CODEX_HOME: '/shared/alice/codex' }, '/srv/users/alice'))
      .toBe(path.resolve('/shared/alice/codex'));
  });

  it('expands a home-relative CODEX_HOME', () => {
    expect(resolveCodexHome({ CODEX_HOME: '~/.state/codex' }, '/srv/users/alice'))
      .toBe(path.resolve('/srv/users/alice/.state/codex'));
  });
});
