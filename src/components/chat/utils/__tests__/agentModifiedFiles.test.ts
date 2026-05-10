import { describe, it, expect } from 'vitest';
import { getAgentModifiedFiles } from '../agentModifiedFiles';
import type { AgentTurnItem } from '../groupAgentTurns';
import type { ChatMessage } from '../../types/types';

function makeTurn(messages: ChatMessage[]): AgentTurnItem {
  return {
    kind: 'agent-turn',
    textMessages: [],
    intermediateMessages: [],
    allMessages: messages,
    toolCount: 0,
    toolNames: [],
    isActivelyStreaming: false,
  };
}

/** Successful tool call — has a non-error toolResult (required to count). */
function toolMsg(
  toolName: string,
  toolInput: unknown,
  opts: { isError?: boolean; omitResult?: boolean } = {},
): ChatMessage {
  return {
    type: 'assistant',
    timestamp: new Date(),
    isToolUse: true,
    toolName,
    toolInput,
    toolResult: opts.omitResult ? null : opts.isError ? { isError: true } : { content: 'ok' },
  };
}

describe('getAgentModifiedFiles', () => {
  it('returns empty list for a turn with no tool calls', () => {
    const turn = makeTurn([
      { type: 'assistant', timestamp: new Date(), content: 'just text' },
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual([]);
  });

  it('collects file paths from Edit/Write/ApplyPatch object toolInput', () => {
    const turn = makeTurn([
      toolMsg('Edit', { file_path: 'src/a.ts' }),
      toolMsg('Write', { file_path: 'src/b.ts' }),
      toolMsg('ApplyPatch', { file_path: 'src/c.ts' }),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('parses stringified JSON toolInput (production shape from messageTransforms)', () => {
    const turn = makeTurn([
      toolMsg('Edit', JSON.stringify({ file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts']);
  });

  it('collects multi-file file_paths array (ApplyPatch pattern)', () => {
    const turn = makeTurn([
      toolMsg('ApplyPatch', { file_paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'] }),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('collects paths from toolResult.toolUseResult.changes (patch result)', () => {
    const msg: ChatMessage = {
      type: 'assistant',
      timestamp: new Date(),
      isToolUse: true,
      toolName: 'ApplyPatch',
      toolInput: {},
      toolResult: {
        toolUseResult: {
          changes: [
            { file_path: 'src/a.ts' },
            { file_path: 'src/b.ts' },
          ],
        },
      },
    };
    const turn = makeTurn([msg]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('deduplicates repeated file paths while preserving first-seen order', () => {
    const turn = makeTurn([
      toolMsg('Edit', { file_path: 'src/a.ts' }),
      toolMsg('Edit', { file_path: 'src/b.ts' }),
      toolMsg('Edit', { file_path: 'src/a.ts' }), // duplicate
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('ignores non-file-modifying tools', () => {
    const turn = makeTurn([
      toolMsg('Read', { file_path: 'src/a.ts' }),
      toolMsg('Bash', { command: 'ls' }),
      toolMsg('Grep', { pattern: 'x', path: 'src/b.ts' }),
      toolMsg('Edit', { file_path: 'src/c.ts' }),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/c.ts']);
  });

  it('skips tool calls that returned an error', () => {
    const turn = makeTurn([
      toolMsg('Edit', { file_path: 'src/a.ts' }, { isError: true }),
      toolMsg('Edit', { file_path: 'src/b.ts' }),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/b.ts']);
  });

  it('skips tool calls without a result (still streaming / aborted)', () => {
    const turn = makeTurn([
      toolMsg('Edit', { file_path: 'src/pending.ts' }, { omitResult: true }),
      toolMsg('Edit', { file_path: 'src/done.ts' }),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/done.ts']);
  });

  it('skips tool calls without a file_path', () => {
    const turn = makeTurn([
      toolMsg('Edit', {}),
      toolMsg('Write', { file_path: 'src/a.ts' }),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts']);
  });

  it('accepts aliases (MultiEdit, write_file, replace)', () => {
    const turn = makeTurn([
      toolMsg('MultiEdit', { file_path: 'src/a.ts' }),
      toolMsg('write_file', { file_path: 'src/b.ts' }),
      toolMsg('replace', { file_path: 'src/c.ts' }),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('also extracts from subagent child tools', () => {
    const container: ChatMessage = {
      type: 'assistant',
      timestamp: new Date(),
      isSubagentContainer: true,
      subagentState: {
        childTools: [
          {
            toolId: 't1',
            toolName: 'Edit',
            toolInput: { file_path: 'src/sub.ts' },
            toolResult: { content: 'ok' },
            timestamp: new Date(),
          },
          {
            toolId: 't2',
            toolName: 'Write',
            toolInput: { file_path: 'src/other.ts' },
            toolResult: { isError: true },
            timestamp: new Date(),
          },
        ],
        currentToolIndex: 0,
        isComplete: true,
      },
    };
    const turn = makeTurn([container]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/sub.ts']);
  });

  it('handles malformed stringified JSON gracefully', () => {
    const turn = makeTurn([
      toolMsg('Edit', '{ this is not: "valid json" '),
      toolMsg('Edit', { file_path: 'src/ok.ts' }),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/ok.ts']);
  });

  it('parses Codex FileChanges toolInput as newline-delimited "kind: path"', () => {
    const turn = makeTurn([
      toolMsg('FileChanges', 'update: src/a.ts\nadd: src/b.ts\ndelete: src/c.ts'),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('extracts paths from object-map changes (Codex patch-apply shape)', () => {
    const msg: ChatMessage = {
      type: 'assistant',
      timestamp: new Date(),
      isToolUse: true,
      toolName: 'FileChanges',
      toolInput: '',
      toolResult: {
        toolUseResult: {
          changes: {
            'src/a.ts': { type: 'update' },
            'src/b.ts': { type: 'add' },
          },
        },
      },
    };
    const turn = makeTurn([msg]);
    expect(getAgentModifiedFiles(turn).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('ignores FileChanges with malformed lines', () => {
    const turn = makeTurn([
      toolMsg('FileChanges', 'malformed line with no colon\nupdate: src/a.ts\n   '),
    ]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts']);
  });

  it('accepts changes as a plain string[] (edge shape)', () => {
    const msg: ChatMessage = {
      type: 'assistant',
      timestamp: new Date(),
      isToolUse: true,
      toolName: 'ApplyPatch',
      toolInput: {},
      toolResult: {
        toolUseResult: {
          changes: ['src/a.ts', 'src/b.ts'],
        },
      },
    };
    const turn = makeTurn([msg]);
    expect(getAgentModifiedFiles(turn)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
