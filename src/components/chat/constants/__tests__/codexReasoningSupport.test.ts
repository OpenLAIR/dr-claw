import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CODEX_REASONING_EFFORT,
  getSupportedCodexReasoningEfforts,
  normalizeCodexReasoningEffort,
} from '../codexReasoningSupport';

describe('Codex reasoning effort support', () => {
  it('exposes every GPT-5.6 reasoning effort', () => {
    expect(getSupportedCodexReasoningEfforts('gpt-5.6')).toEqual([
      'default',
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('keeps legacy models on their verified subset', () => {
    expect(getSupportedCodexReasoningEfforts('gpt-5.5')).toEqual([
      'default',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('prefers the efforts the Codex CLI reported for the model', () => {
    const reported = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
    expect(getSupportedCodexReasoningEfforts('gpt-5.6-sol', reported)).toEqual([
      'default',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
    // Names the UI cannot render are dropped rather than crashing the picker.
    expect(getSupportedCodexReasoningEfforts('some-new-model', ['low', 'galactic'])).toEqual(['default', 'low']);
  });

  it('falls back to the built-in table when the CLI reported nothing usable', () => {
    expect(getSupportedCodexReasoningEfforts('gpt-5.5', [])).toEqual(['default', 'low', 'medium', 'high', 'xhigh']);
    expect(getSupportedCodexReasoningEfforts('gpt-5.5', null)).toEqual(['default', 'low', 'medium', 'high', 'xhigh']);
    expect(getSupportedCodexReasoningEfforts('never-heard-of-it', ['galactic'])).toEqual(['default']);
  });

  it('keeps a saved effort the CLI says the model accepts, even if the table does not know it', () => {
    expect(normalizeCodexReasoningEffort('brand-new-model', 'ultra', ['low', 'ultra'])).toBe('ultra');
    expect(normalizeCodexReasoningEffort('brand-new-model', 'ultra', null)).toBe(DEFAULT_CODEX_REASONING_EFFORT);
  });

  it('falls back safely when a saved effort is unsupported by the selected model', () => {
    expect(normalizeCodexReasoningEffort('gpt-5.6', 'minimal')).toBe(
      DEFAULT_CODEX_REASONING_EFFORT,
    );
    expect(normalizeCodexReasoningEffort('gpt-5.5', 'max')).toBe(
      DEFAULT_CODEX_REASONING_EFFORT,
    );
  });
});
