import { describe, expect, it } from 'vitest';

import type { AttachedPrompt } from '../../types/types';
import {
  hasUnsavedComposerDraft,
  normalizeProgrammaticDraft,
  resolveLineHeightPx,
} from '../composerUtils';

const attachedPrompt: AttachedPrompt = {
  scenarioId: 'draft-review',
  scenarioIcon: 'P',
  scenarioTitle: 'Review a draft',
  promptText: 'Please review the attached draft before responding.',
};

describe('normalizeProgrammaticDraft', () => {
  it('preserves attachedPrompt when loading a draft into the composer', () => {
    expect(
      normalizeProgrammaticDraft({
        content: 'Please revise paragraph two.',
        attachedPrompt,
      }),
    ).toEqual({
      content: 'Please revise paragraph two.',
      attachedPrompt,
    });
  });
});

describe('hasUnsavedComposerDraft', () => {
  it('detects non-empty input, attachments, or prompt state before replacing a draft', () => {
    expect(hasUnsavedComposerDraft('', 0, null)).toBe(false);
    expect(hasUnsavedComposerDraft('Follow-up question', 0, null)).toBe(true);
    expect(hasUnsavedComposerDraft('', 1, null)).toBe(true);
    expect(hasUnsavedComposerDraft('', 0, attachedPrompt)).toBe(true);
  });
});

describe('resolveLineHeightPx', () => {
  it('handles unitless and percentage line-height values', () => {
    expect(resolveLineHeightPx('1.5', '16px')).toBe(24);
    expect(resolveLineHeightPx('150%', '16px')).toBe(24);
  });
});
