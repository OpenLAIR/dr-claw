import type { CodexReasoningEffortId } from './codexReasoningEfforts';

export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffortId = 'default';

/** Display order for every effort the UI knows how to render. */
const EFFORT_ORDER: CodexReasoningEffortId[] = [
  'default',
  'minimal',
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

const DEFAULT_ONLY: CodexReasoningEffortId[] = [DEFAULT_CODEX_REASONING_EFFORT];
const LOW_TO_XHIGH: CodexReasoningEffortId[] = ['default', 'low', 'medium', 'high', 'xhigh'];
const LOW_TO_MAX: CodexReasoningEffortId[] = ['default', 'low', 'medium', 'high', 'xhigh', 'max'];
const LOW_TO_ULTRA: CodexReasoningEffortId[] = ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const GPT_56_REASONING_EFFORTS: CodexReasoningEffortId[] = [
  'default',
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/**
 * Fallback only. The authoritative list comes from the Codex CLI itself
 * (`model/list` reports `supportedReasoningEfforts` per model) and reaches the
 * UI through harness model discovery; this table covers the case where
 * discovery is unavailable and the built-in model list is in use.
 */
const MODEL_REASONING_SUPPORT: Record<string, CodexReasoningEffortId[]> = {
  'gpt-5.6': GPT_56_REASONING_EFFORTS,
  'gpt-5.6-sol': LOW_TO_ULTRA,
  'gpt-5.6-terra': LOW_TO_ULTRA,
  'gpt-5.6-luna': LOW_TO_MAX,
  'gpt-5.5': LOW_TO_XHIGH,
  'gpt-5.4': LOW_TO_XHIGH,
  'gpt-5.4-mini': LOW_TO_XHIGH,
  'gpt-5.3-codex': LOW_TO_XHIGH,
  'gpt-5.3-codex-spark': LOW_TO_XHIGH,
  'gpt-5.2-codex': LOW_TO_XHIGH,
  'gpt-5.2': LOW_TO_XHIGH,
  // Keep unknown / unverified models on default only instead of over-claiming support.
  'gpt-5.1-codex-max': DEFAULT_ONLY,
  'o3': DEFAULT_ONLY,
  'o4-mini': DEFAULT_ONLY,
};

function isKnownEffort(value: string): value is CodexReasoningEffortId {
  return (EFFORT_ORDER as string[]).includes(value);
}

/**
 * Efforts the picker should offer for `model`.
 *
 * `discovered` is what the Codex CLI reported for this model. When present it
 * wins outright: efforts the UI cannot render are dropped, and "default"
 * (let the model decide) is always offered first. Without it, fall back to
 * the built-in table.
 */
export function getSupportedCodexReasoningEfforts(
  model: string,
  discovered?: readonly string[] | null,
): CodexReasoningEffortId[] {
  if (discovered && discovered.length > 0) {
    const known = EFFORT_ORDER.filter(
      (effort) => effort !== DEFAULT_CODEX_REASONING_EFFORT && discovered.some((d) => d === effort),
    );
    if (known.length > 0) {
      return [DEFAULT_CODEX_REASONING_EFFORT, ...known];
    }
  }
  return MODEL_REASONING_SUPPORT[model] || DEFAULT_ONLY;
}

export function supportsExplicitCodexReasoningEffort(
  model: string,
  discovered?: readonly string[] | null,
): boolean {
  return getSupportedCodexReasoningEfforts(model, discovered).length > 1;
}

export function normalizeCodexReasoningEffort(
  model: string,
  effort: CodexReasoningEffortId,
  discovered?: readonly string[] | null,
): CodexReasoningEffortId {
  return getSupportedCodexReasoningEfforts(model, discovered).includes(effort)
    ? effort
    : DEFAULT_CODEX_REASONING_EFFORT;
}

export { isKnownEffort as isKnownCodexReasoningEffort };
