import { describe, expect, it } from 'vitest';

import { resolveConversationSessionIds } from '../useChatComposerState';

describe('resolveConversationSessionIds', () => {
  it('lets a selected temporary tab override the previously mounted session', () => {
    expect(resolveConversationSessionIds({
      selectedSessionId: 'new-session-client-1',
      currentSessionId: 'existing-session',
      routedSessionId: null,
      pendingViewSessionId: null,
      providerSessionId: null,
    })).toEqual({
      effectiveSessionId: 'new-session-client-1',
      temporarySessionId: 'new-session-client-1',
      serverSessionId: null,
    });
  });

  it('resumes a real selected session', () => {
    expect(resolveConversationSessionIds({
      selectedSessionId: 'real-session',
      currentSessionId: 'stale-session',
    })).toEqual({
      effectiveSessionId: 'real-session',
      temporarySessionId: null,
      serverSessionId: 'real-session',
    });
  });
});
