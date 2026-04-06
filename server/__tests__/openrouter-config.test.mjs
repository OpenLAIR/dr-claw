import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENROUTER_BASE_URL,
  getOpenRouterBaseUrl,
  getOpenRouterProviderHeaders,
  isOfficialOpenRouterBaseUrl,
  normalizeOpenRouterBaseUrl,
} from '../utils/openrouterConfig.js';

describe('openrouterConfig', () => {
  it('uses the official OpenRouter endpoint by default', () => {
    expect(normalizeOpenRouterBaseUrl()).toBe(DEFAULT_OPENROUTER_BASE_URL);
    expect(getOpenRouterBaseUrl({})).toBe(DEFAULT_OPENROUTER_BASE_URL);
  });

  it('normalizes custom relay URLs by trimming trailing slashes', () => {
    expect(normalizeOpenRouterBaseUrl('https://relay.example.com/v1/')).toBe('https://relay.example.com/v1');
  });

  it('falls back to the default URL when the configured env value is invalid', () => {
    expect(getOpenRouterBaseUrl({ OPENROUTER_BASE_URL: 'not-a-url' })).toBe(DEFAULT_OPENROUTER_BASE_URL);
  });

  it('detects official OpenRouter hosts', () => {
    expect(isOfficialOpenRouterBaseUrl('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOfficialOpenRouterBaseUrl('https://relay.example.com/v1')).toBe(false);
  });

  it('only attaches OpenRouter provider headers for the official endpoint', () => {
    expect(getOpenRouterProviderHeaders('https://openrouter.ai/api/v1', 'Dr. Claw')).toEqual({
      'HTTP-Referer': 'https://github.com/OpenLAIR/dr-claw',
      'X-Title': 'Dr. Claw',
    });
    expect(getOpenRouterProviderHeaders('https://relay.example.com/v1', 'Dr. Claw')).toEqual({});
  });
});
