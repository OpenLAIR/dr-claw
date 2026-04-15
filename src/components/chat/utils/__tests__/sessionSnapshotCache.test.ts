import { describe, expect, it } from 'vitest';

import {
  buildSessionSnapshotKey,
  cloneSessionSnapshot,
  createSessionSnapshot,
  normalizeSessionSnapshotProvider,
} from '../sessionSnapshotCache';
import { DEFAULT_PROVIDER } from '../../../../utils/providerPolicy';

describe('sessionSnapshotCache', () => {
  it('normalizes provider and builds stable cache keys', () => {
    expect(normalizeSessionSnapshotProvider(undefined)).toBe(DEFAULT_PROVIDER);
    expect(normalizeSessionSnapshotProvider('unknown-provider')).toBe(DEFAULT_PROVIDER);
    expect(buildSessionSnapshotKey('p1', 's1', undefined)).toBe(`p1::s1::${DEFAULT_PROVIDER}`);
    expect(buildSessionSnapshotKey('', 's1', DEFAULT_PROVIDER)).toBe('');
    expect(buildSessionSnapshotKey('p1', '', DEFAULT_PROVIDER)).toBe('');
  });

  it('creates snapshots without sharing source object references', () => {
    const rawSessionMessages = [{ id: 1, text: 'hello' }];
    const rawChatMessages = [{ type: 'assistant', content: 'world', timestamp: new Date().toISOString() }] as any;
    const snapshot = createSessionSnapshot(DEFAULT_PROVIDER, rawSessionMessages, rawChatMessages);

    rawSessionMessages[0].text = 'mutated';
    rawChatMessages[0].content = 'mutated';

    expect((snapshot.sessionMessages[0] as any).text).toBe('hello');
    expect((snapshot.chatMessages[0] as any).content).toBe('world');
  });

  it('clones stored snapshots so consumers cannot mutate cache by reference', () => {
    const original = createSessionSnapshot(
      DEFAULT_PROVIDER,
      [{ id: 'session-message' }],
      [{ type: 'assistant', content: 'cached', timestamp: new Date().toISOString() }] as any,
    );
    const cloned = cloneSessionSnapshot(original);

    (cloned.sessionMessages[0] as any).id = 'mutated-session';
    (cloned.chatMessages[0] as any).content = 'mutated-chat';

    expect((original.sessionMessages[0] as any).id).toBe('session-message');
    expect((original.chatMessages[0] as any).content).toBe('cached');
  });
});
