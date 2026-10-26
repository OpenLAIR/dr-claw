import { describe, expect, it } from 'vitest';

import { applyPiToolEvent } from '../piToolEvents';

describe('applyPiToolEvent', () => {
  it('creates the tool card shape consumed by the live chat UI', () => {
    const timestamp = new Date('2026-09-05T00:00:00Z');
    const messages = applyPiToolEvent([], {
      type: 'tool_use',
      toolName: 'read',
      toolInput: { path: '/tmp/example.ts' },
      toolCallId: 'call-1',
    }, timestamp);

    expect(messages).toEqual([{
      type: 'assistant',
      content: '',
      timestamp,
      isToolUse: true,
      toolName: 'read',
      toolInput: { path: '/tmp/example.ts' },
      toolId: 'call-1',
      toolResult: null,
    }]);
  });

  it('attaches a result to the matching tool card instead of appending a standalone message', () => {
    const started = applyPiToolEvent([], {
      type: 'tool_use',
      toolName: 'read',
      toolCallId: 'call-1',
    });
    const timestamp = new Date('2026-09-05T00:00:01Z');
    const completed = applyPiToolEvent(started, {
      type: 'tool_result',
      output: 'file contents',
      isError: false,
      toolCallId: 'call-1',
    }, timestamp);

    expect(completed).toHaveLength(1);
    expect(completed[0].toolResult).toEqual({
      content: 'file contents',
      isError: false,
      timestamp,
    });
  });

  it('leaves messages unchanged when the result has no matching live tool card', () => {
    const messages = [{ type: 'assistant', content: 'hello', timestamp: new Date() }];
    expect(applyPiToolEvent(messages, {
      type: 'tool_result',
      output: 'orphaned',
      toolCallId: 'missing',
    })).toBe(messages);
  });
});
