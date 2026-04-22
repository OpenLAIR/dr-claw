import type { ChatMessage, TokenBudget } from '../components/chat/types/types';
import type { ProjectSession, SessionProvider } from './app';

export interface SessionTab {
  /** Stable identity for this tab slot — never changes, even when the real session
   *  ID is assigned (replacing the initial `new-session-*` placeholder). Use this
   *  as the React `key` so the ChatInterface instance stays mounted through ID swaps. */
  tabKey: string;
  id: string;
  session: ProjectSession;
  projectName: string;
  provider: SessionProvider;
  openedAt: number;
}

export interface SessionSnapshot {
  messages: ChatMessage[];
  isLoading: boolean;
  statusText: string | null;
  tokenCount: number;
  tokenBudget: TokenBudget | null;
  scrollTop: number;
  canAbort: boolean;
}

export interface BackgroundSessionStatus {
  isLoading: boolean;
  statusText: string | null;
  tokenCount: number;
  /** True when the session completed in the background and hasn't been viewed yet */
  hasUnread: boolean;
  /** Incremented every time a background message arrives so UI can react */
  messageSeq: number;
}
