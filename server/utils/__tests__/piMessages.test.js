import { describe, expect, it } from 'vitest';

import { extractPiTextContent } from '../piMessages.js';

describe('extractPiTextContent', () => {
  it('joins text blocks and ignores non-text content', () => {
    expect(extractPiTextContent([
      { type: 'text', text: 'hello ' },
      { type: 'thinking', thinking: 'hidden' },
      { type: 'text', text: 'world' },
    ])).toBe('hello world');
  });

  it('accepts string content and rejects malformed values', () => {
    expect(extractPiTextContent('plain')).toBe('plain');
    expect(extractPiTextContent(null)).toBe('');
  });
});
