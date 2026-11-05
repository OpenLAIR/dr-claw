import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import RetryingImage, { IMAGE_RETRY_DELAYS_MS, withRetryParam } from '../RetryingImage';

describe('RetryingImage', () => {
  it('renders the original src on the first attempt and passes props through', () => {
    const html = renderToStaticMarkup(
      <RetryingImage src="/icons/claude-ai-icon.svg" alt="Claude" className="w-5 h-5" />,
    );
    expect(html).toContain('src="/icons/claude-ai-icon.svg"');
    expect(html).toContain('alt="Claude"');
    expect(html).toContain('class="w-5 h-5"');
  });

  it('adds a cache-busting parameter for each retry', () => {
    expect(withRetryParam('/icons/codex.svg', 0)).toBe('/icons/codex.svg');
    expect(withRetryParam('/icons/codex.svg', 2)).toBe('/icons/codex.svg?retry=2');
    expect(withRetryParam('/icons/a.svg?v=1', 1)).toBe('/icons/a.svg?v=1&retry=1');
  });

  it('gives up after a bounded number of retries', () => {
    expect(IMAGE_RETRY_DELAYS_MS.length).toBeGreaterThan(0);
    expect(IMAGE_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(10_000);
  });
});
