import { describe, expect, it } from 'vitest';

import { isSideQuestionCommand } from '../composerSubmit';

describe('isSideQuestionCommand', () => {
  it('matches /btw with or without a question', () => {
    expect(isSideQuestionCommand('/btw what does this flag do?')).toBe(true);
    expect(isSideQuestionCommand('  /btw  ')).toBe(true);
  });

  it('does not match other input', () => {
    expect(isSideQuestionCommand('/btwx')).toBe(false);
    expect(isSideQuestionCommand('please /btw later')).toBe(false);
    expect(isSideQuestionCommand('/compact')).toBe(false);
  });
});
