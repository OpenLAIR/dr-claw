import { describe, expect, it } from 'vitest';

import {
  resolveSessionLoadProvider,
  shouldApplySessionLoadResult,
  shouldSkipSessionMessageLoad,
} from '../sessionLoadGuards';
import { DEFAULT_PROVIDER } from '../../../../utils/providerPolicy';

describe('session load guards', () => {
  it('keeps the selected session provider when valid', () => {
    expect(resolveSessionLoadProvider(DEFAULT_PROVIDER)).toBe(DEFAULT_PROVIDER);
  });

  it('falls back to default provider when provider is missing or invalid', () => {
    expect(resolveSessionLoadProvider(undefined)).toBe(DEFAULT_PROVIDER);
    expect(resolveSessionLoadProvider(null)).toBe(DEFAULT_PROVIDER);
    expect(resolveSessionLoadProvider('unknown-provider')).toBe(DEFAULT_PROVIDER);
  });

  it('only applies load results for the active, non-cancelled request', () => {
    expect(shouldApplySessionLoadResult(1, 1, false)).toBe(true);
    expect(shouldApplySessionLoadResult(1, 2, false)).toBe(false);
    expect(shouldApplySessionLoadResult(2, 2, true)).toBe(false);
  });

  it('skips history fetch for temporary session ids', () => {
    expect(shouldSkipSessionMessageLoad('new-session-123')).toBe(true);
    expect(shouldSkipSessionMessageLoad('temp-abc')).toBe(true);
    expect(shouldSkipSessionMessageLoad('019d82e8-1ee3-7860-baa1-24603f424ade')).toBe(false);
    expect(shouldSkipSessionMessageLoad('')).toBe(false);
    expect(shouldSkipSessionMessageLoad(null)).toBe(false);
  });

  it('prevents stale request overwrite after a fast session switch', () => {
    const requestA = 1;
    const requestB = 2;

    // Request A started first, then B replaced it.
    expect(shouldApplySessionLoadResult(requestA, requestB, false)).toBe(false);
    expect(shouldApplySessionLoadResult(requestB, requestB, false)).toBe(true);
  });

  it('prevents older async loads from overwriting a newer session payload', async () => {
    let activeRequestId = 0;
    const appliedPayloads: string[] = [];

    const runLoad = (payload: string, delayMs: number) => {
      activeRequestId += 1;
      const requestId = activeRequestId;

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (shouldApplySessionLoadResult(requestId, activeRequestId, false)) {
            appliedPayloads.push(payload);
          }
          resolve();
        }, delayMs);
      });
    };

    // A starts first but finishes later; B starts later but finishes first.
    const loadA = runLoad('session-A', 40);
    const loadB = runLoad('session-B', 5);
    await Promise.all([loadA, loadB]);

    expect(appliedPayloads).toEqual(['session-B']);
  });
});

