import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_DRCLAW_DEBUG = process.env.DRCLAW_DEBUG;
const ORIGINAL_VIBELAB_DEBUG = process.env.VIBELAB_DEBUG;

async function loadLogger(flag) {
  vi.resetModules();
  if (flag === undefined) {
    delete process.env.DRCLAW_DEBUG;
  } else {
    process.env.DRCLAW_DEBUG = flag;
  }
  delete process.env.VIBELAB_DEBUG;
  return import('../logger.js');
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.DRCLAW_DEBUG = ORIGINAL_DRCLAW_DEBUG;
  process.env.VIBELAB_DEBUG = ORIGINAL_VIBELAB_DEBUG;
  if (ORIGINAL_DRCLAW_DEBUG === undefined) delete process.env.DRCLAW_DEBUG;
  if (ORIGINAL_VIBELAB_DEBUG === undefined) delete process.env.VIBELAB_DEBUG;
});

describe('hot-path logging gate', () => {
  it('stays silent by default — this is what keeps per-event logging off', async () => {
    const { isVerboseLogging, debugLog } = await loadLogger(undefined);

    expect(isVerboseLogging('codex')).toBe(false);
    expect(isVerboseLogging()).toBe(false);

    debugLog('codex', 'should not print');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('enables every scope with DRCLAW_DEBUG=1', async () => {
    const { isVerboseLogging, debugLog } = await loadLogger('1');

    expect(isVerboseLogging('codex')).toBe(true);
    expect(isVerboseLogging('claude')).toBe(true);

    debugLog('claude', 'hello');
    expect(console.log).toHaveBeenCalledWith('hello');
  });

  it('scopes output when given a comma-separated list', async () => {
    const { isVerboseLogging, debugLog } = await loadLogger('codex, gemini');

    expect(isVerboseLogging('codex')).toBe(true);
    expect(isVerboseLogging('GEMINI')).toBe(true);
    expect(isVerboseLogging('claude')).toBe(false);

    debugLog('claude', 'suppressed');
    expect(console.log).not.toHaveBeenCalled();

    debugLog('codex', 'shown');
    expect(console.log).toHaveBeenCalledWith('shown');
  });

  it('accepts true and * as enable-all aliases', async () => {
    const asterisk = await loadLogger('*');
    expect(asterisk.isVerboseLogging('anything')).toBe(true);

    const truthy = await loadLogger('true');
    expect(truthy.isVerboseLogging('anything')).toBe(true);
  });
});
