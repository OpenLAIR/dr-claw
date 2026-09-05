import { describe, expect, it } from 'vitest';

import {
  GEMINI_SESSION_MODEL_ALIAS,
  buildGeminiSystemSettingsOverride,
} from '../utils/geminiSystemSettings.js';

describe('Gemini system settings override', () => {
  it('returns nothing when there is nothing to override', () => {
    expect(buildGeminiSystemSettingsOverride({ model: 'gemini-3.5-flash' })).toBeNull();
    expect(buildGeminiSystemSettingsOverride({})).toBeNull();
  });

  it('wraps the model in an alias carrying the thinking config', () => {
    const built = buildGeminiSystemSettingsOverride({
      model: 'gemini-3.5-flash',
      thinkingConfig: { thinkingLevel: 'HIGH' },
    });
    expect(built.cliModel).toBe(GEMINI_SESSION_MODEL_ALIAS);
    expect(built.override.modelConfigs.customAliases[GEMINI_SESSION_MODEL_ALIAS]).toEqual({
      extends: 'gemini-3.5-flash',
      modelConfig: { model: 'gemini-3.5-flash', generateContentConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } } },
    });
    expect(built.override.security).toBeUndefined();
  });

  it('selects API-key auth whenever a key is available, so a retired OAuth login cannot get in the way', () => {
    const built = buildGeminiSystemSettingsOverride({ model: 'gemini-3.5-flash', apiKey: 'k' });
    expect(built.cliModel).toBeNull();
    expect(built.override).toEqual({ security: { auth: { selectedType: 'gemini-api-key' } } });
  });

  it('combines both when a key and a thinking config are present', () => {
    const built = buildGeminiSystemSettingsOverride({
      model: 'gemini-2.5-pro',
      thinkingConfig: { thinkingBudget: 8192 },
      apiKey: 'k',
    });
    expect(built.cliModel).toBe(GEMINI_SESSION_MODEL_ALIAS);
    expect(built.override.security.auth.selectedType).toBe('gemini-api-key');
    expect(built.override.modelConfigs).toBeDefined();
  });
});
