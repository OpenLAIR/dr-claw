import { describe, expect, it } from 'vitest';

import { shouldPreserveOptimisticMessagesOnSessionSelect } from '../chatSessionTransition';

describe('shouldPreserveOptimisticMessagesOnSessionSelect', () => {
  it('preserves optimistic messages for explicit system-driven session changes', () => {
    expect(shouldPreserveOptimisticMessagesOnSessionSelect({
      currentSessionId: null,
      nextSelectedSessionId: 'session-123',
      pendingViewSessionId: null,
      deferredLoadSessionId: null,
      chatMessageCount: 1,
      isSystemSessionChange: true,
    })).toBe(true);
  });

  it('preserves optimistic messages when a pending new session is promoted to a real id', () => {
    expect(shouldPreserveOptimisticMessagesOnSessionSelect({
      currentSessionId: null,
      nextSelectedSessionId: 'session-123',
      pendingViewSessionId: 'session-123',
      deferredLoadSessionId: null,
      chatMessageCount: 1,
      isSystemSessionChange: false,
    })).toBe(true);
  });

  it('preserves optimistic messages when a temporary new-session id is replaced', () => {
    expect(shouldPreserveOptimisticMessagesOnSessionSelect({
      currentSessionId: 'new-session-123',
      nextSelectedSessionId: 'session-123',
      pendingViewSessionId: 'session-123',
      deferredLoadSessionId: null,
      chatMessageCount: 1,
      isSystemSessionChange: false,
    })).toBe(true);
  });

  it('preserves optimistic messages while hydration is intentionally deferred for the promoted session', () => {
    expect(shouldPreserveOptimisticMessagesOnSessionSelect({
      currentSessionId: 'session-123',
      nextSelectedSessionId: 'session-123',
      pendingViewSessionId: null,
      deferredLoadSessionId: 'session-123',
      chatMessageCount: 1,
      isSystemSessionChange: false,
    })).toBe(true);
  });

  it('does not preserve messages for a normal user-initiated session switch', () => {
    expect(shouldPreserveOptimisticMessagesOnSessionSelect({
      currentSessionId: 'session-111',
      nextSelectedSessionId: 'session-222',
      pendingViewSessionId: null,
      deferredLoadSessionId: null,
      chatMessageCount: 1,
      isSystemSessionChange: false,
    })).toBe(false);
  });
});
