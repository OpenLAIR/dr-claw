import { describe, expect, it, vi } from 'vitest';

vi.mock('../../pi-cli.js', () => ({
  isPiSessionActive: vi.fn((sessionId) => sessionId === 'active-pi'),
  getPiSessionStartTime: vi.fn((sessionId) => sessionId === 'active-pi' ? 1234 : undefined),
  getActivePiSessions: vi.fn(() => [{ sessionId: 'active-pi', startTime: 1234 }]),
}));

import {
  getAllActiveProviderSessions,
  getProviderSessionStatus,
  getTrackedSessionProviders,
} from '../sessionProviderState.js';

describe('session provider state registry', () => {
  it('tracks Pi alongside every other chat provider', () => {
    expect(getTrackedSessionProviders()).toEqual([
      'claude',
      'cursor',
      'codex',
      'gemini',
      'openrouter',
      'local',
      'nano',
      'pi',
    ]);
    expect(getAllActiveProviderSessions()).toHaveProperty('pi');
  });

  it('queries Pi without falling through to Claude', () => {
    expect(getProviderSessionStatus('pi', 'active-pi')).toEqual({
      isActive: true,
      startTime: 1234,
    });
    expect(getAllActiveProviderSessions().pi).toEqual([{ sessionId: 'active-pi', startTime: 1234 }]);
  });
});
