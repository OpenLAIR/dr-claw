import { describe, expect, it } from 'vitest';

import { RECENTLY_ACTIVE_GRACE_MS, isRecentlyActiveSession, updateSessionActivity } from '../sessionRetention';

describe('session retention', () => {
  it('keeps a running session and one that just finished', () => {
    const activity = new Map<string, number>();
    updateSessionActivity(activity, ['thread-1'], 0);
    expect(isRecentlyActiveSession(activity, 'thread-1', 10 * 60_000)).toBe(true);

    updateSessionActivity(activity, [], 10 * 60_000);
    expect(isRecentlyActiveSession(activity, 'thread-1', 10 * 60_000 + 5_000)).toBe(true);
  });

  it('lets a session go once the grace period has passed', () => {
    const activity = new Map<string, number>();
    updateSessionActivity(activity, ['thread-1'], 0);
    updateSessionActivity(activity, [], 1_000);
    expect(isRecentlyActiveSession(activity, 'thread-1', 1_000 + RECENTLY_ACTIVE_GRACE_MS + 1)).toBe(false);
    updateSessionActivity(activity, [], 1_000 + RECENTLY_ACTIVE_GRACE_MS + 1);
    expect(activity.has('thread-1')).toBe(false);
  });

  it('never keeps a session that was not active in this window', () => {
    expect(isRecentlyActiveSession(new Map(), 'old-session', 0)).toBe(false);
    expect(isRecentlyActiveSession(new Map(), null, 0)).toBe(false);
  });
});
