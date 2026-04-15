import type { SessionMode, SessionProvider } from '../types/app';

export const OPTIMISTIC_SESSION_CREATED_EVENT = 'dr-claw:optimistic-session-created';

export interface OptimisticSessionCreatedDetail {
  sessionId: string;
  projectName: string;
  provider: SessionProvider;
  mode: SessionMode;
  displayName?: string;
  summary?: string;
  createdAt?: string;
}
