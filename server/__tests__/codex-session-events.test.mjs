import { describe, expect, it } from 'vitest';

import { buildCodexSessionCreatedEvent } from '../utils/codexSessionEvents.js';

describe('codex session event payloads', () => {
  it('includes projectName when provided', () => {
    const event = buildCodexSessionCreatedEvent({
      sessionId: '019d82e8-1ee3-7860-baa1-24603f424ade',
      sessionMode: 'research',
      projectName: 'C--Users-Xingjian-Hu-dr-claw-jyw',
    });

    expect(event).toEqual({
      type: 'session-created',
      sessionId: '019d82e8-1ee3-7860-baa1-24603f424ade',
      provider: 'codex',
      mode: 'research',
      projectName: 'C--Users-Xingjian-Hu-dr-claw-jyw',
    });
  });

  it('keeps backward-compatible payload shape when projectName is missing', () => {
    const event = buildCodexSessionCreatedEvent({
      sessionId: 'session-no-project',
      sessionMode: 'workspace_qa',
    });

    expect(event).toEqual({
      type: 'session-created',
      sessionId: 'session-no-project',
      provider: 'codex',
      mode: 'workspace_qa',
    });
  });
});
