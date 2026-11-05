import { describe, expect, it, vi } from 'vitest';

vi.mock('../../constants/config', () => ({ IS_PLATFORM: false }));

const { fetchWithNetworkRetry } = await import('../api.js');

const noWait = () => Promise.resolve();

describe('fetchWithNetworkRetry', () => {
  it('retries a GET that failed before any response, then returns the response', async () => {
    const response = new Response('[]', { status: 200 });
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response);

    await expect(fetchWithNetworkRetry('/api/projects', {}, { fetchImpl, wait: noWait })).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up after the configured retries', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      fetchWithNetworkRetry('/api/projects', {}, { fetchImpl, wait: noWait, delays: [1, 1] }),
    ).rejects.toThrow('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry HTTP error responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('busy', { status: 503 }));

    const response = await fetchWithNetworkRetry('/api/projects', {}, { fetchImpl, wait: noWait });
    expect(response.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry requests that change state', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      fetchWithNetworkRetry('/api/projects', { method: 'POST' }, { fetchImpl, wait: noWait }),
    ).rejects.toThrow('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry aborted requests', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      fetchWithNetworkRetry('/api/projects', { signal: controller.signal }, { fetchImpl, wait: noWait }),
    ).rejects.toThrow('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the request is aborted while waiting', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const wait = () => {
      controller.abort();
      return Promise.resolve();
    };

    await expect(
      fetchWithNetworkRetry('/api/projects', { signal: controller.signal }, { fetchImpl, wait }),
    ).rejects.toThrow('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
