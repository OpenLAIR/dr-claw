import { describe, expect, it, vi } from 'vitest';

import { loadWithRetry } from '../lazyWithRetry';

const component = { default: () => null };

describe('loadWithRetry', () => {
  it('resolves on the first attempt without retrying', async () => {
    const loader = vi.fn().mockResolvedValue(component);

    await expect(loadWithRetry(loader, 2, 0)).resolves.toBe(component);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures until the loader succeeds', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValue(component);

    await expect(loadWithRetry(loader, 2, 0)).resolves.toBe(component);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('gives up with the last error once the retry budget is spent', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('third'))
      .mockResolvedValue(component);

    await expect(loadWithRetry(loader, 2, 0)).rejects.toThrow('third');
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('does not retry when the budget is zero', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(loadWithRetry(loader, 0, 0)).rejects.toThrow('boom');
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
