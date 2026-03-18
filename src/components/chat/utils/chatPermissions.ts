import { safeJsonParse } from '../../../lib/utils.js';
import type { ChatMessage, PermissionSuggestion, PermissionGrantResult } from '../types/types.js';
import { getProviderSettings, getProviderSettingsKey, safeLocalStorage } from './chatStorage';

export function buildToolPermissionEntry(toolName?: string, toolInput?: unknown) {
  if (!toolName) return null;
  if (toolName !== 'Bash') return toolName;

  const parsed = safeJsonParse(toolInput);
  const command = typeof parsed?.command === 'string' ? parsed.command.trim() : '';
  if (!command) return toolName;

  const tokens = command.split(/\s+/);
  if (tokens.length === 0) return toolName;

  if (tokens[0] === 'git' && tokens[1]) {
    return `Bash(${tokens[0]} ${tokens[1]}:*)`;
  }
  return `Bash(${tokens[0]}:*)`;
}

export function formatToolInputForDisplay(input: unknown) {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function getPermissionSuggestion(
  message: ChatMessage | null | undefined,
  provider: string,
): PermissionSuggestion | null {
  if (provider !== 'claude' && provider !== 'gemini') return null;
  if (!message?.toolResult?.isError) return null;

  const toolName = message?.toolName;
  const entry = buildToolPermissionEntry(toolName, message.toolInput);
  if (!entry) return null;

  const settings = getProviderSettings(provider);
  const isAllowed = settings.allowedTools.includes(entry);
  return { toolName: toolName || 'UnknownTool', entry, isAllowed };
}

export function grantToolPermission(entry: string | null, provider?: string): PermissionGrantResult {
  if (!entry) return { success: false };

  const settings = getProviderSettings(provider);
  const alreadyAllowed = settings.allowedTools.includes(entry);
  const nextAllowed = alreadyAllowed ? settings.allowedTools : [...settings.allowedTools, entry];
  const nextDisallowed = settings.disallowedTools.filter((tool) => tool !== entry);
  const updatedSettings = {
    ...settings,
    allowedTools: nextAllowed,
    disallowedTools: nextDisallowed,
    lastUpdated: new Date().toISOString(),
  };

  safeLocalStorage.setItem(getProviderSettingsKey(provider), JSON.stringify(updatedSettings));
  return { success: true, alreadyAllowed, updatedSettings };
}
