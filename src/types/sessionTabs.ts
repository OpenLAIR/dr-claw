import type { ChatMessage, TokenBudget } from '../components/chat/types/types';
import type { ProjectSession, SessionProvider } from './app';

export interface SessionTab {
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
