import type { CodexReasoningEffortId } from './codexReasoningEfforts';

const DEFAULT_ONLY: CodexReasoningEffortId[] = ['default'];
const LOW_TO_XHIGH: CodexReasoningEffortId[] = ['default', 'low', 'medium', 'high', 'xhigh'];

const MODEL_REASONING_SUPPORT: Record<string, CodexReasoningEffortId[]> = {
  'gpt-5.5': LOW_TO_XHIGH,
  'gpt-5.4': LOW_TO_XHIGH,
  'gpt-5.3-codex': LOW_TO_XHIGH,
  'gpt-5.2-codex': LOW_TO_XHIGH,
  'gpt-5.2': LOW_TO_XHIGH,
  // Keep unknown / unverified models on default only instead of over-claiming support.
  'gpt-5.1-codex-max': DEFAULT_ONLY,
  'o3': DEFAULT_ONLY,
  'o4-mini': DEFAULT_ONLY,
};

export function getSupportedCodexReasoningEfforts(model: string): CodexReasoningEffortId[] {
  return MODEL_REASONING_SUPPORT[model] || DEFAULT_ONLY;
}

export function supportsExplicitCodexReasoningEffort(model: string): boolean {
  return getSupportedCodexReasoningEfforts(model).length > 1;
}
