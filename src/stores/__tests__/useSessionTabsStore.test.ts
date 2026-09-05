import { beforeEach, describe, expect, it } from 'vitest';

import { isSessionVisibleInTabs, useSessionTabsStore } from '../useSessionTabsStore';

describe('useSessionTabsStore', () => {
  beforeEach(() => {
    useSessionTabsStore.setState({
      tabs: [],
      activeTabId: null,
      splitMode: false,
      secondaryTabId: null,
      snapshots: {},
      backgroundStatus: {},
    });
  });

  it('opens a distinct temporary tab for a new conversation', () => {
    const store = useSessionTabsStore.getState();
    store.addTab({ id: 'existing', __provider: 'claude' }, 'project-a');

    const temporaryId = useSessionTabsStore.getState().addNewTab('project-a', 'workspace_qa');
    const state = useSessionTabsStore.getState();

    expect(temporaryId).toMatch(/^new-session-/);
    expect(state.activeTabId).toBe(temporaryId);
    expect(state.tabs.map((tab) => tab.id)).toEqual(['existing', temporaryId]);
    expect(state.tabs[1].session.mode).toBe('workspace_qa');
  });

  it('keeps the tab key stable when the server assigns the real session id', () => {
    const temporaryId = useSessionTabsStore.getState().addNewTab('project-a');
    const originalKey = useSessionTabsStore.getState().tabs[0].tabKey;

    useSessionTabsStore.getState().replaceTabSessionId(
      temporaryId,
      { id: 'real-session', __provider: 'codex' },
      'project-a',
    );

    expect(useSessionTabsStore.getState().tabs[0]).toMatchObject({
      id: 'real-session',
      tabKey: originalKey,
      provider: 'codex',
    });
  });

  it('treats both split panes as visible', () => {
    expect(isSessionVisibleInTabs({
      activeTabId: 'primary',
      splitMode: true,
      secondaryTabId: 'secondary',
    }, 'secondary')).toBe(true);

    expect(isSessionVisibleInTabs({
      activeTabId: 'primary',
      splitMode: false,
      secondaryTabId: 'secondary',
    }, 'secondary')).toBe(false);
  });

  it('clears unread without discarding a background loading state', () => {
    const store = useSessionTabsStore.getState();
    store.addTab({ id: 'one' }, 'project-a');
    store.addTab({ id: 'two' }, 'project-a');
    useSessionTabsStore.getState().setBackgroundStatus('one', {
      isLoading: true,
      hasUnread: true,
      statusText: 'Working',
    });

    useSessionTabsStore.getState().setActiveTab('one');

    expect(useSessionTabsStore.getState().backgroundStatus.one).toMatchObject({
      isLoading: true,
      hasUnread: false,
      statusText: 'Working',
    });
  });
});
