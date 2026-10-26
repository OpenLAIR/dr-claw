import {
  getActiveClaudeSDKSessions,
  getClaudeSDKSessionStartTime,
  isClaudeSDKSessionActive,
} from '../claude-sdk.js';
import {
  getActiveCursorSessions,
  getCursorSessionStartTime,
  isCursorSessionActive,
} from '../cursor-cli.js';
import {
  getActiveCodexSessions,
  getCodexSessionStartTime,
  isCodexSessionActive,
} from '../openai-codex.js';
import {
  getActiveGeminiSessions,
  getGeminiSessionStartTime,
  isGeminiSessionActive,
} from '../gemini-cli.js';
import {
  getActiveOpenRouterSessions,
  getOpenRouterSessionStartTime,
  isOpenRouterSessionActive,
} from '../openrouter.js';
import {
  getActiveLocalGPUSessions,
  getLocalGPUSessionStartTime,
  isLocalGPUSessionActive,
} from '../local-gpu.js';
import {
  getActiveNanoClaudeCodeSessions,
  getNanoClaudeCodeSessionStartTime,
  isNanoClaudeCodeSessionActive,
} from '../nano-claude-code.js';
import {
  getActivePiSessions,
  getPiSessionStartTime,
  isPiSessionActive,
} from '../pi-cli.js';

const SESSION_STATE_PROVIDERS = {
  claude: {
    isActive: isClaudeSDKSessionActive,
    getStartTime: getClaudeSDKSessionStartTime,
    getActive: getActiveClaudeSDKSessions,
  },
  cursor: {
    isActive: isCursorSessionActive,
    getStartTime: getCursorSessionStartTime,
    getActive: getActiveCursorSessions,
  },
  codex: {
    isActive: isCodexSessionActive,
    getStartTime: getCodexSessionStartTime,
    getActive: getActiveCodexSessions,
  },
  gemini: {
    isActive: isGeminiSessionActive,
    getStartTime: getGeminiSessionStartTime,
    getActive: getActiveGeminiSessions,
  },
  openrouter: {
    isActive: isOpenRouterSessionActive,
    getStartTime: getOpenRouterSessionStartTime,
    getActive: getActiveOpenRouterSessions,
  },
  local: {
    isActive: isLocalGPUSessionActive,
    getStartTime: getLocalGPUSessionStartTime,
    getActive: getActiveLocalGPUSessions,
  },
  nano: {
    isActive: isNanoClaudeCodeSessionActive,
    getStartTime: getNanoClaudeCodeSessionStartTime,
    getActive: getActiveNanoClaudeCodeSessions,
  },
  pi: {
    isActive: isPiSessionActive,
    getStartTime: getPiSessionStartTime,
    getActive: getActivePiSessions,
  },
};

export const getTrackedSessionProviders = () => Object.keys(SESSION_STATE_PROVIDERS);

export function getProviderSessionStatus(provider, sessionId) {
  const handler = SESSION_STATE_PROVIDERS[provider] || SESSION_STATE_PROVIDERS.claude;
  return {
    isActive: handler.isActive(sessionId),
    startTime: handler.getStartTime(sessionId) ?? null,
  };
}

export function getAllActiveProviderSessions() {
  return Object.fromEntries(
    Object.entries(SESSION_STATE_PROVIDERS).map(([provider, handler]) => [provider, handler.getActive()]),
  );
}
