import type { AppTab, SessionNavigationSource } from '../../../types/app';

export type ChatTabSyncAction =
  | 'noop'
  | 'open-new-tab'
  | 'open-tab'
  | 'update-active-tab-session';

type ResolveChatTabSyncActionArgs = {
  activeAppTab: AppTab;
  hasSelectedProject: boolean;
  nextSessionId: string | null;
  activeChatTabSessionId?: string | null;
  tabCount: number;
  navigationSource: SessionNavigationSource;
};

const isTemporarySessionId = (sessionId?: string | null) =>
  typeof sessionId === 'string' && sessionId.startsWith('new-session-');

export function resolveChatTabSyncAction({
  activeAppTab,
  hasSelectedProject,
  nextSessionId,
  activeChatTabSessionId,
  tabCount,
  navigationSource,
}: ResolveChatTabSyncActionArgs): ChatTabSyncAction {
  if (activeAppTab !== 'chat' || !hasSelectedProject) {
    return 'noop';
  }

  if (!nextSessionId) {
    return tabCount > 0 ? 'open-new-tab' : 'noop';
  }

  if (activeChatTabSessionId === nextSessionId) {
    return 'noop';
  }

  if (
    navigationSource === 'system'
    && activeChatTabSessionId !== undefined
    && (activeChatTabSessionId === null || isTemporarySessionId(activeChatTabSessionId))
  ) {
    return 'update-active-tab-session';
  }

  return 'open-tab';
}
