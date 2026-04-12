import { describe, expect, it } from 'vitest';

import { buildSessionMessageCacheCandidateKeys } from '../sessionMessageCache';

describe('sessionMessageCache', () => {
  it('returns provider/session scoped keys plus legacy project+session key', () => {
    const keys = buildSessionMessageCacheCandidateKeys('proj-a', 'sess-1', 'codex');

    expect(keys).toEqual(
      expect.arrayContaining([
        'chat_messages_proj-a_codex_sess-1',
        'chat_messages_proj-a_claude_sess-1',
        'chat_messages_proj-a_sess-1',
      ]),
    );
  });

  it('does not include project-only legacy key to avoid cross-session replay', () => {
    const keys = buildSessionMessageCacheCandidateKeys('proj-a', 'sess-1', 'codex');

    expect(keys).not.toContain('chat_messages_proj-a');
  });

  it('deduplicates keys when provider already resolves to default', () => {
    const keys = buildSessionMessageCacheCandidateKeys('proj-a', 'sess-1', 'claude');

    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});
