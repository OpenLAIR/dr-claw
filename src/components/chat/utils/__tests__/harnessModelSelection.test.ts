import { describe, expect, it } from 'vitest';

import { shouldRescueHarnessModel } from '../harnessModelSelection';

describe('shouldRescueHarnessModel', () => {
  it('rescues a Pi model that belongs to an unauthenticated provider', () => {
    expect(shouldRescueHarnessModel({
      provider: 'pi',
      allowsCustom: true,
      currentModel: 'anthropic/claude-sonnet-4-6',
      discoveredDefault: 'openai/gpt-5.5',
      options: [
        { value: 'openai/gpt-5.5', label: 'GPT-5.5' },
        { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', builtIn: true },
      ],
    })).toBe(true);
  });

  it('keeps a Pi model the authenticated catalogue reports', () => {
    expect(shouldRescueHarnessModel({
      provider: 'pi',
      allowsCustom: true,
      currentModel: 'openai/gpt-5.5',
      discoveredDefault: 'openai/gpt-5-mini',
      options: [{ value: 'openai/gpt-5.5', label: 'GPT-5.5' }],
    })).toBe(false);
  });

  it('does not rescue custom values for open-ended providers', () => {
    expect(shouldRescueHarnessModel({
      provider: 'openrouter',
      allowsCustom: true,
      currentModel: 'relay/private-model',
      discoveredDefault: 'openai/gpt-5.5',
      options: [{ value: 'openai/gpt-5.5', label: 'GPT-5.5' }],
    })).toBe(false);
  });
});
