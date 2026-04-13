import type { AttachedPrompt } from '../types/types';

export interface ProgrammaticDraftSnapshot {
  content: string;
  attachedPrompt: AttachedPrompt | null;
}

export const normalizeProgrammaticDraft = (draft: {
  content?: string;
  attachedPrompt?: AttachedPrompt | null;
}): ProgrammaticDraftSnapshot => ({
  content: draft.content || '',
  attachedPrompt: draft.attachedPrompt ?? null,
});

export const hasUnsavedComposerDraft = (
  input: string,
  attachedFilesOrCount: number | { length: number },
  attachedPrompt: AttachedPrompt | null,
): boolean => {
  const attachedFilesCount =
    typeof attachedFilesOrCount === 'number'
      ? attachedFilesOrCount
      : attachedFilesOrCount.length;

  return input.trim().length > 0 || attachedFilesCount > 0 || Boolean(attachedPrompt);
};

export const resolveLineHeightPx = (
  lineHeightValue: string | null | undefined,
  fontSizeValue: string | null | undefined,
): number => {
  const fontSize = Number.parseFloat(fontSizeValue || '');
  const fallback = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.2 : 19.2;

  if (!lineHeightValue || lineHeightValue === 'normal') {
    return fallback;
  }

  const numericValue = Number.parseFloat(lineHeightValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }

  if (lineHeightValue.endsWith('px')) {
    return numericValue;
  }

  if (lineHeightValue.endsWith('%')) {
    return Number.isFinite(fontSize) && fontSize > 0
      ? (numericValue / 100) * fontSize
      : fallback;
  }

  if (/^[\d.]+$/.test(lineHeightValue.trim())) {
    return Number.isFinite(fontSize) && fontSize > 0
      ? numericValue * fontSize
      : fallback;
  }

  return numericValue;
};
