import { describe, expect, it } from 'vitest';

import {
  buildGeminiThinkingConfig,
  getSupportedGeminiThinkingModes,
  supportsExplicitGeminiThinkingMode,
} from '../../shared/geminiThinkingSupport.js';

describe('Gemini thinking support for models the table has not seen', () => {
  it('gives an unknown Gemini 3 flash model the thinking levels of its family', () => {
    expect(getSupportedGeminiThinkingModes('gemini-3.8-flash')).toEqual([
      'default', 'minimal', 'low', 'medium', 'high',
    ]);
    expect(buildGeminiThinkingConfig('gemini-3.8-flash', 'high')).toEqual({ thinkingLevel: 'HIGH' });
  });

  it('withholds minimal from an unknown Gemini 3 pro model, as for the known one', () => {
    expect(getSupportedGeminiThinkingModes('gemini-3.9-pro-preview')).toEqual([
      'default', 'low', 'medium', 'high',
    ]);
  });

  it('gives an unknown Gemini 2.5 model the budgets of its closest sibling', () => {
    expect(getSupportedGeminiThinkingModes('gemini-2.5-flash-8b')).toEqual([
      'default', 'dynamic', 'off', 'light', 'balanced', 'deep',
    ]);
    expect(buildGeminiThinkingConfig('gemini-2.5-flash-8b', 'balanced')).toEqual({ thinkingBudget: 8192 });
    expect(buildGeminiThinkingConfig('gemini-2.5-pro-exp', 'max')).toEqual({ thinkingBudget: 32768 });
  });

  it('still offers only default for models outside both families', () => {
    expect(supportsExplicitGeminiThinkingMode('gemini-1.5-pro')).toBe(false);
    expect(buildGeminiThinkingConfig('gemini-1.5-pro', 'high')).toBeNull();
  });
});
