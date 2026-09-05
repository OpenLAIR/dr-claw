import { describe, expect, it } from 'vitest';

import { shouldHandleCreatedSession } from '../useChatRealtimeHandlers';

describe('shouldHandleCreatedSession', () => {
  it('routes a correlated session-created event only to its originating temporary tab', () => {
    expect(shouldHandleCreatedSession({
      currentSessionId: 'new-session-a',
      clientSessionId: 'new-session-b',
      activeTabId: 'new-session-b',
    })).toBe(false);

    expect(shouldHandleCreatedSession({
      currentSessionId: 'new-session-b',
      clientSessionId: 'new-session-b',
      activeTabId: 'new-session-a',
    })).toBe(true);
  });

  it('falls back to the active temporary tab for legacy server events', () => {
    expect(shouldHandleCreatedSession({
      currentSessionId: 'new-session-a',
      activeTabId: 'new-session-b',
    })).toBe(false);
    expect(shouldHandleCreatedSession({
      currentSessionId: 'new-session-b',
      activeTabId: 'new-session-b',
    })).toBe(true);
  });
});
