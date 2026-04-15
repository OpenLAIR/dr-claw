import { describe, expect, it } from 'vitest';

import {
  hasPendingOptimisticSessionState,
  hasTemporaryProcessingSessionKeys,
} from '../useChatSessionState';

describe('useChatSessionState temporary session helpers', () => {
  it('treats temp sessions as pending optimistic sessions', () => {
    expect(hasPendingOptimisticSessionState(null, 'new-session-123')).toBe(true);
    expect(hasPendingOptimisticSessionState(null, 'temp-123')).toBe(true);
    expect(hasPendingOptimisticSessionState({ sessionId: null, startedAt: Date.now() }, null)).toBe(true);
    expect(hasPendingOptimisticSessionState(null, 'sess-123')).toBe(false);
  });

  it('detects temporary processing keys for both raw and scoped temp ids', () => {
    expect(hasTemporaryProcessingSessionKeys(new Set(['new-session-1']))).toBe(true);
    expect(hasTemporaryProcessingSessionKeys(new Set(['temp-1']))).toBe(true);
    expect(hasTemporaryProcessingSessionKeys(new Set(['proj-a::codex::new-session-2']))).toBe(true);
    expect(hasTemporaryProcessingSessionKeys(new Set(['proj-a::codex::temp-2']))).toBe(true);
    expect(hasTemporaryProcessingSessionKeys(new Set(['proj-a::codex::sess-2']))).toBe(false);
    expect(hasTemporaryProcessingSessionKeys(new Set(['sess-2']))).toBe(false);
  });
});
