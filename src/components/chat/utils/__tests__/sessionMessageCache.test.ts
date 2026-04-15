import { describe, expect, it } from 'vitest';

import { buildSessionMessageCacheCandidateKeys } from '../sessionMessageCache';

describe('sessionMessageCache', () => {
  it('returns only provider/session scoped key by default', () => {
    const keys = buildSessionMessageCacheCandidateKeys('proj-a', 'sess-1', 'codex');

    expect(keys).toEqual(['chat_messages_proj-a_codex_sess-1']);
  });

  it('includes migration fallback keys only when explicitly requested', () => {
    const keys = buildSessionMessageCacheCandidateKeys('proj-a', 'sess-1', 'codex', {
      allowLegacyFallback: true,
    });

    expect(keys).toEqual(
      expect.arrayContaining([
        'chat_messages_proj-a_codex_sess-1',
        'chat_messages_proj-a_claude_sess-1',
        'chat_messages_proj-a_sess-1',
      ]),
    );
  });

  it('deduplicates keys when provider already resolves to default in migration mode', () => {
    const keys = buildSessionMessageCacheCandidateKeys('proj-a', 'sess-1', 'claude', {
      allowLegacyFallback: true,
    });

    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});
