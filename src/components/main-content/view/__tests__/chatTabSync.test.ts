import { describe, expect, it } from 'vitest';

import { resolveChatTabSyncAction } from '../chatTabSync';

describe('resolveChatTabSyncAction', () => {
  it('updates the active tab when a system-created session replaces a temporary id', () => {
    expect(resolveChatTabSyncAction({
      activeAppTab: 'chat',
      hasSelectedProject: true,
      nextSessionId: 'session-123',
      activeChatTabSessionId: 'new-session-123',
      tabCount: 1,
      navigationSource: 'system',
    })).toBe('update-active-tab-session');
  });

  it('opens a different tab when the user navigates to another session', () => {
    expect(resolveChatTabSyncAction({
      activeAppTab: 'chat',
      hasSelectedProject: true,
      nextSessionId: 'session-456',
      activeChatTabSessionId: 'session-123',
      tabCount: 2,
      navigationSource: 'user',
    })).toBe('open-tab');
  });

  it('does nothing when the active tab already points at the selected session', () => {
    expect(resolveChatTabSyncAction({
      activeAppTab: 'chat',
      hasSelectedProject: true,
      nextSessionId: 'session-123',
      activeChatTabSessionId: 'session-123',
      tabCount: 1,
      navigationSource: 'user',
    })).toBe('noop');
  });

  it('opens a blank tab when the selected session is cleared and tabs already exist', () => {
    expect(resolveChatTabSyncAction({
      activeAppTab: 'chat',
      hasSelectedProject: true,
      nextSessionId: null,
      activeChatTabSessionId: 'session-123',
      tabCount: 1,
      navigationSource: 'user',
    })).toBe('open-new-tab');
  });
});
