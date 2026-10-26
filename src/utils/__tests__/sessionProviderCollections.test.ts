import { describe, expect, it } from 'vitest';

import { getSessionCollectionKey } from '../sessionProviderCollections';

describe('getSessionCollectionKey', () => {
  it('routes Pi session-created events into piSessions', () => {
    expect(getSessionCollectionKey('pi')).toBe('piSessions');
  });

  it('keeps the provider mapping exhaustive', () => {
    expect([
      getSessionCollectionKey('claude'),
      getSessionCollectionKey('cursor'),
      getSessionCollectionKey('codex'),
      getSessionCollectionKey('gemini'),
      getSessionCollectionKey('openrouter'),
      getSessionCollectionKey('local'),
      getSessionCollectionKey('nano'),
      getSessionCollectionKey('pi'),
    ]).toEqual([
      'sessions',
      'cursorSessions',
      'codexSessions',
      'geminiSessions',
      'openrouterSessions',
      'localSessions',
      'nanoSessions',
      'piSessions',
    ]);
  });
});
