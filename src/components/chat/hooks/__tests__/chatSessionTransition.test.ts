import { describe, expect, it } from 'vitest';

import {
  decideSessionMessageLoad,
  isNewExternalMessageUpdate,
  shouldPreserveOptimisticMessagesOnSessionSelect,
} from '../chatSessionTransition';

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

describe('decideSessionMessageLoad', () => {
  const ws = {};

  it('adopts a session our own send just created instead of fetching it', () => {
    expect(decideSessionMessageLoad({
      selectedSessionId: 'session-123',
      isSystemSessionChange: true,
      displayed: null,
      ws,
    })).toBe('adopt');
  });

  it('keeps the first message when the effect re-runs right after adopting', () => {
    // The system-change flag resets, which re-runs the load effect for the
    // same session. Fetching here replaced the question with an empty transcript.
    expect(decideSessionMessageLoad({
      selectedSessionId: 'session-123',
      isSystemSessionChange: false,
      displayed: { sessionId: 'session-123', ws },
      ws,
    })).toBe('keep');
  });

  it('loads a session the view is not showing yet', () => {
    expect(decideSessionMessageLoad({
      selectedSessionId: 'session-456',
      isSystemSessionChange: false,
      displayed: { sessionId: 'session-123', ws },
      ws,
    })).toBe('load');
    expect(decideSessionMessageLoad({
      selectedSessionId: 'session-456',
      isSystemSessionChange: false,
      displayed: null,
      ws,
    })).toBe('load');
  });

  it('reloads the shown session after the socket reconnects', () => {
    expect(decideSessionMessageLoad({
      selectedSessionId: 'session-123',
      isSystemSessionChange: false,
      displayed: { sessionId: 'session-123', ws },
      ws: {},
    })).toBe('load');
  });
});

describe('isNewExternalMessageUpdate', () => {
  it('fires only when the counter moves', () => {
    expect(isNewExternalMessageUpdate(0, 0)).toBe(false);
    expect(isNewExternalMessageUpdate(undefined, 0)).toBe(false);
    expect(isNewExternalMessageUpdate(3, 3)).toBe(false);
    expect(isNewExternalMessageUpdate(4, 3)).toBe(true);
  });
});
