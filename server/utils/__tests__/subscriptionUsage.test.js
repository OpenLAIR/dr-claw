import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildClaudeEntry,
  buildCodexEntry,
  buildGeminiEntry,
  buildSubscriptionUsageSummary,
  formatWindowLabel,
  normalizeClaudeUsageResponse,
  parseCodexRateLimitsFromJsonl,
  readLatestCodexRateLimits,
} from '../subscriptionUsage.js';

const NOW = new Date('2026-11-05T06:00:00Z');

function codexTokenCount(timestamp, rateLimits) {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 10 } }, rate_limits: rateLimits },
  });
}

describe('formatWindowLabel', () => {
  it('renders minutes as the largest whole unit', () => {
    expect(formatWindowLabel(300)).toBe('5h');
    expect(formatWindowLabel(10080)).toBe('7d');
    expect(formatWindowLabel(45)).toBe('45m');
    expect(formatWindowLabel(null)).toBeNull();
  });
});

describe('normalizeClaudeUsageResponse', () => {
  it('reads typed plan windows and model-scoped windows', () => {
    const result = normalizeClaudeUsageResponse({
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 40, resets_at: '2026-11-05T08:00:00Z' },
        seven_day: { utilization: 12, resets_at: '2026-11-11T14:00:00Z' },
        seven_day_opus: null,
        model_scoped: [{ display_name: 'Fable', utilization: 1, resets_at: '2026-11-11T14:00:00Z' }],
        some_future_field: { utilization: 99 },
      },
    }, { now: NOW });

    expect(result.plan).toBe('max');
    expect(result.available).toBe(true);
    expect(result.windows.map(w => [w.label, w.usedPercent, w.remainingPercent])).toEqual([
      ['5h', 40, 60],
      ['7d', 12, 88],
      ['7d Fable', 1, 99],
    ]);
    expect(result.windows[0].resetsAt).toBe('2026-11-05T08:00:00.000Z');
  });

  it('reports no plan limits for API-key sessions', () => {
    expect(normalizeClaudeUsageResponse({ subscription_type: null, rate_limits_available: false, rate_limits: null }))
      .toEqual({ plan: null, windows: [], available: false });
  });

  it('skips windows without a numeric utilization', () => {
    const result = normalizeClaudeUsageResponse({
      rate_limits_available: true,
      rate_limits: { five_hour: { utilization: null, resets_at: null } },
    }, { now: NOW });
    expect(result.windows).toEqual([]);
  });
});

describe('buildClaudeEntry', () => {
  it('marks a failed probe as an error instead of inventing numbers', () => {
    const entry = buildClaudeEntry({ auth: { authenticated: true, email: 'a@b.c' }, probe: { ok: false, reasonCode: 'probe_failed', error: 'timeout' }, now: NOW });
    expect(entry).toMatchObject({ status: 'error', reasonCode: 'probe_failed', windows: [], account: 'a@b.c' });
  });

  it('treats a custom API key as having no plan limits', () => {
    const entry = buildClaudeEntry({ auth: { authenticated: true, method: 'custom_api' }, probe: null, now: NOW });
    expect(entry).toMatchObject({ status: 'unavailable', reasonCode: 'api_key_no_plan_limits' });
  });

  it('reports a signed-out account', () => {
    expect(buildClaudeEntry({ auth: { authenticated: false }, probe: null, now: NOW }).reasonCode).toBe('not_signed_in');
  });
});

describe('parseCodexRateLimitsFromJsonl', () => {
  it('returns the newest snapshot with absolute reset times', () => {
    const text = [
      codexTokenCount('2026-11-04T05:00:00Z', { primary: { used_percent: 43, window_minutes: 10080, resets_at: 1793828995 }, plan_type: 'plus' }),
      codexTokenCount('2026-11-05T05:35:30Z', {
        primary: { used_percent: 20, window_minutes: 300, resets_at: Date.parse('2026-11-05T09:00:00Z') / 1000 },
        secondary: { used_percent: 7, window_minutes: 10080, resets_at: Date.parse('2026-11-11T21:59:51Z') / 1000 },
        plan_type: 'prolite',
        rate_limit_reached_type: null,
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }),
    ].join('\n');

    const snapshot = parseCodexRateLimitsFromJsonl(text, { now: NOW });
    expect(snapshot.observedAt).toBe('2026-11-05T05:35:30.000Z');
    expect(snapshot.plan).toBe('prolite');
    expect(snapshot.windows.map(w => [w.id, w.label, w.remainingPercent, w.resetsAt])).toEqual([
      ['primary', '5h', 80, '2026-11-05T09:00:00.000Z'],
      ['secondary', '7d', 93, '2026-11-11T21:59:51.000Z'],
    ]);
  });

  it('supports the older relative resets_in_seconds field', () => {
    const text = codexTokenCount('2026-11-05T05:00:00Z', { primary: { used_percent: 50, window_minutes: 300, resets_in_seconds: 3600 } });
    expect(parseCodexRateLimitsFromJsonl(text, { now: NOW }).windows[0].resetsAt).toBe('2026-11-05T06:00:00.000Z');
  });

  it('does not report old usage for a window that has since reset', () => {
    const text = codexTokenCount('2026-11-01T00:00:00Z', { primary: { used_percent: 90, window_minutes: 300, resets_at: Date.parse('2026-11-01T05:00:00Z') / 1000 } });
    const [window] = parseCodexRateLimitsFromJsonl(text, { now: NOW }).windows;
    expect(window).toMatchObject({ resetSinceObserved: true, usedPercent: null, remainingPercent: null });
  });

  it('skips null rate limits, truncated lines and API-key sessions', () => {
    const text = [
      '{"partial line from a tail read", "rate_limits": {',
      codexTokenCount('2026-11-05T05:00:00Z', null),
      codexTokenCount('2026-11-05T05:01:00Z', { primary: null, secondary: null }),
    ].join('\n');
    expect(parseCodexRateLimitsFromJsonl(text, { now: NOW })).toBeNull();
  });
});

describe('readLatestCodexRateLimits', () => {
  let tmpDir;
  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('falls back to older session files when the newest has no snapshot', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rl-'));
    const nested = path.join(tmpDir, 'a', 'b');
    await fs.mkdir(nested, { recursive: true });
    const older = path.join(nested, 'older.jsonl');
    const newer = path.join(tmpDir, 'newer.jsonl');
    await fs.writeFile(older, codexTokenCount('2026-11-05T04:00:00Z', { primary: { used_percent: 30, window_minutes: 10080, resets_at: Date.parse('2026-11-10T00:00:00Z') / 1000 } }) + '\n');
    await fs.writeFile(newer, JSON.stringify({ type: 'session_meta', payload: {} }) + '\n');
    await fs.utimes(older, new Date('2026-11-05T04:00:00Z'), new Date('2026-11-05T04:00:00Z'));
    await fs.utimes(newer, new Date('2026-11-05T05:00:00Z'), new Date('2026-11-05T05:00:00Z'));

    const snapshot = await readLatestCodexRateLimits({ sessionsDir: tmpDir, now: NOW });
    expect(snapshot.windows[0].remainingPercent).toBe(70);
  });

  it('only reads the tail of large files', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rl-'));
    const file = path.join(tmpDir, 's.jsonl');
    const filler = JSON.stringify({ type: 'response_item', payload: { text: 'x'.repeat(2000) } });
    const lines = [codexTokenCount('2026-11-05T05:00:00Z', { primary: { used_percent: 10, window_minutes: 300 } })];
    for (let i = 0; i < 20; i += 1) lines.push(filler);
    await fs.writeFile(file, lines.join('\n') + '\n');

    expect(await readLatestCodexRateLimits({ sessionsDir: tmpDir, now: NOW, tailBytes: 4096 })).toBeNull();
    expect(await readLatestCodexRateLimits({ sessionsDir: tmpDir, now: NOW })).not.toBeNull();
  });

  it('returns null when the sessions directory does not exist', async () => {
    expect(await readLatestCodexRateLimits({ sessionsDir: path.join(os.tmpdir(), 'does-not-exist-codex-rl') })).toBeNull();
  });
});

describe('provider entries and summary', () => {
  it('Codex API-key logins have no plan limits even if old snapshots exist', () => {
    const entry = buildCodexEntry({ auth: { authenticated: true, method: 'custom_api' }, snapshot: { windows: [{}] } });
    expect(entry).toMatchObject({ status: 'unavailable', reasonCode: 'api_key_no_plan_limits' });
  });

  it('Codex without any snapshot says so', () => {
    expect(buildCodexEntry({ auth: { authenticated: true, email: 'x@y.z' }, snapshot: null }).reasonCode).toBe('no_codex_snapshot');
  });

  it('Gemini is always reported as unavailable', () => {
    expect(buildGeminiEntry({ auth: { authenticated: true, email: 'API Key Connected' } }))
      .toMatchObject({ status: 'unavailable', reasonCode: 'gemini_no_quota_source', windows: [] });
    expect(buildGeminiEntry({ auth: { authenticated: false } }).reasonCode).toBe('not_signed_in');
  });

  it('assembles all providers and skips the Claude probe when signed out', async () => {
    let probed = false;
    const summary = await buildSubscriptionUsageSummary({
      checkClaudeAuth: async () => ({ authenticated: false }),
      checkCodexAuth: async () => { throw new Error('boom'); },
      checkGeminiAuth: async () => ({ authenticated: true, email: 'g' }),
      probeClaude: async () => { probed = true; return { ok: true, response: {} }; },
      readCodexSnapshot: async () => null,
      now: NOW,
    });
    expect(probed).toBe(false);
    expect(summary.generatedAt).toBe(NOW.toISOString());
    expect(summary.providers.map(p => [p.provider, p.status, p.reasonCode])).toEqual([
      ['claude', 'unavailable', 'not_signed_in'],
      ['codex', 'unavailable', 'not_signed_in'],
      ['gemini', 'unavailable', 'gemini_no_quota_source'],
    ]);
  });
});
