import { describe, expect, it } from 'vitest';

import {
  inferProviderFromMessageType,
  resolveProjectName,
  enrichSessionEventPayload,
  buildLifecycleMessageFromPayload,
} from '../utils/sessionLifecycle.js';

describe('inferProviderFromMessageType', () => {
  it.each([
    ['claude-complete', 'claude'],
    ['cursor-result', 'cursor'],
    ['codex-complete', 'codex'],
    ['gemini-complete', 'gemini'],
    ['openrouter-complete', 'openrouter'],
    ['localgpu-complete', 'local'],
    ['nano-complete', 'nano'],
  ])('infers %s → %s', (type, expected) => {
    expect(inferProviderFromMessageType(type)).toBe(expected);
  });

  it('returns fallbackProvider when prefix is unknown', () => {
    expect(inferProviderFromMessageType('unknown-type', 'codex')).toBe('codex');
  });

  it('returns null when no prefix matches and no fallback', () => {
    expect(inferProviderFromMessageType('unknown-type')).toBeNull();
  });

  it('handles null/undefined type gracefully', () => {
    expect(inferProviderFromMessageType(null)).toBeNull();
    expect(inferProviderFromMessageType(undefined)).toBeNull();
  });
});

describe('resolveProjectName', () => {
  it('returns explicit projectName when provided', () => {
    expect(resolveProjectName('my-project', null)).toBe('my-project');
  });

  it('returns null for empty projectName and no path', () => {
    expect(resolveProjectName(null, null)).toBeNull();
    expect(resolveProjectName('', '')).toBeNull();
    expect(resolveProjectName('  ', null)).toBeNull();
  });

  it('resolves from projectPath via deps when projectName is missing', () => {
    const deps = {
      isKnownPath: () => true,
      encodePath: (p) => `encoded-${p}`,
    };
    expect(resolveProjectName(null, '/some/path', deps)).toBe('encoded-/some/path');
  });

  it('returns null when isKnownPath returns false', () => {
    const deps = {
      isKnownPath: () => false,
      encodePath: () => 'should-not-be-called',
    };
    expect(resolveProjectName(null, '/unknown/path', deps)).toBeNull();
  });

  it('returns null when encodePath throws', () => {
    const deps = {
      isKnownPath: () => true,
      encodePath: () => { throw new Error('encode failed'); },
    };
    expect(resolveProjectName(null, '/bad/path', deps)).toBeNull();
  });

  it('returns null when deps are not provided and projectName is missing', () => {
    expect(resolveProjectName(null, '/some/path')).toBeNull();
  });
});

describe('enrichSessionEventPayload', () => {
  const deps = {
    isKnownPath: () => true,
    encodePath: (p) => `encoded-${p}`,
  };

  it('returns non-object payloads unchanged', () => {
    expect(enrichSessionEventPayload(null)).toBeNull();
    expect(enrichSessionEventPayload(undefined)).toBeUndefined();
    expect(enrichSessionEventPayload('string')).toBe('string');
  });

  it('ignores non-session message types', () => {
    const payload = { type: 'claude-complete', projectPath: '/p' };
    expect(enrichSessionEventPayload(payload, null, deps)).toBe(payload);
  });

  it('enriches session payload with resolved projectName from projectPath', () => {
    const payload = { type: 'session-created', projectPath: '/my/project' };
    const result = enrichSessionEventPayload(payload, null, deps);
    expect(result.projectName).toBe('encoded-/my/project');
    expect(result.type).toBe('session-created');
  });

  it('uses fallbackProjectPath when payload has no projectPath', () => {
    const payload = { type: 'session-created' };
    const result = enrichSessionEventPayload(payload, '/fallback/path', deps);
    expect(result.projectName).toBe('encoded-/fallback/path');
  });

  it('does not overwrite existing projectName', () => {
    const payload = { type: 'session-created', projectName: 'already-set' };
    const result = enrichSessionEventPayload(payload, null, deps);
    expect(result).toBe(payload);
  });

  it('returns original payload when resolved name matches existing', () => {
    const depsMatch = {
      isKnownPath: () => true,
      encodePath: () => 'same-name',
    };
    const payload = { type: 'session-created', projectName: 'same-name' };
    expect(enrichSessionEventPayload(payload, null, depsMatch)).toBe(payload);
  });
});

describe('buildLifecycleMessageFromPayload', () => {
  it('returns null for non-object payloads', () => {
    expect(buildLifecycleMessageFromPayload(null)).toBeNull();
    expect(buildLifecycleMessageFromPayload(undefined)).toBeNull();
    expect(buildLifecycleMessageFromPayload(42)).toBeNull();
  });

  it('returns null for non-terminal message types', () => {
    expect(buildLifecycleMessageFromPayload({ type: 'claude-chunk' })).toBeNull();
    expect(buildLifecycleMessageFromPayload({ type: 'session-created' })).toBeNull();
  });

  it('builds completed lifecycle for -complete suffix', () => {
    const now = Date.now();
    const result = buildLifecycleMessageFromPayload({
      type: 'claude-complete',
      sessionId: 'sess-1',
    });
    expect(result).toMatchObject({
      type: 'session-state-changed',
      provider: 'claude',
      sessionId: 'sess-1',
      state: 'completed',
      reason: 'claude-complete',
    });
    expect(result.changedAt).toBeGreaterThanOrEqual(now);
  });

  it('builds completed lifecycle for cursor-result', () => {
    const result = buildLifecycleMessageFromPayload({
      type: 'cursor-result',
      sessionId: 'cursor-sess',
    });
    expect(result.state).toBe('completed');
    expect(result.provider).toBe('cursor');
  });

  it('builds failed lifecycle for -error suffix', () => {
    const result = buildLifecycleMessageFromPayload({
      type: 'codex-error',
      sessionId: 'codex-sess',
    });
    expect(result).toMatchObject({
      state: 'failed',
      provider: 'codex',
      reason: 'codex-error',
    });
  });

  it('prefers actualSessionId over sessionId', () => {
    const result = buildLifecycleMessageFromPayload({
      type: 'gemini-complete',
      sessionId: 'old-id',
      actualSessionId: 'real-id',
    });
    expect(result.sessionId).toBe('real-id');
  });

  it('uses fallbackProvider when type prefix is unknown', () => {
    const result = buildLifecycleMessageFromPayload(
      { type: 'custom-complete', sessionId: 's1' },
      'openrouter',
    );
    expect(result.provider).toBe('openrouter');
  });

  it('uses payload.provider over fallbackProvider', () => {
    const result = buildLifecycleMessageFromPayload(
      { type: 'custom-complete', sessionId: 's1', provider: 'nano' },
      'openrouter',
    );
    expect(result.provider).toBe('nano');
  });

  it('includes projectName from fallbackProjectName', () => {
    const result = buildLifecycleMessageFromPayload(
      { type: 'claude-complete', sessionId: 's1' },
      null,
      'my-project',
    );
    expect(result.projectName).toBe('my-project');
  });

  it('omits projectName when not resolvable', () => {
    const result = buildLifecycleMessageFromPayload(
      { type: 'claude-complete', sessionId: 's1' },
      null,
      null,
    );
    expect(result).not.toHaveProperty('projectName');
  });

  it('resolves projectName from projectPath via deps', () => {
    const deps = {
      isKnownPath: () => true,
      encodePath: (p) => `encoded-${p}`,
    };
    const result = buildLifecycleMessageFromPayload(
      { type: 'claude-error', sessionId: 's1', projectPath: '/proj' },
      null,
      null,
      deps,
    );
    expect(result.projectName).toBe('encoded-/proj');
    expect(result.state).toBe('failed');
  });
});
