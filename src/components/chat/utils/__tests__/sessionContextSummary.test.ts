import { describe, expect, it } from 'vitest';

import {
  deriveSessionContextSummary,
  mergeDistinctChatMessages,
  resolveSessionContextProjectRoot,
} from '../sessionContextSummary';

describe('deriveSessionContextSummary', () => {
  const projectRoot = '/workspace/demo';

  it('extracts context files, outputs, tasks, and unread review state', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:00:00.000Z',
        isToolUse: true,
        toolName: 'Read',
        toolInput: JSON.stringify({ file_path: '/workspace/demo/src/app.ts' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:01:00.000Z',
        isToolUse: true,
        toolName: 'Grep',
        toolInput: JSON.stringify({ pattern: 'build' }),
        toolResult: {
          content: 'ok',
          isError: false,
          toolUseResult: {
            filenames: ['src/app.ts', 'docs/plan.md'],
          },
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:02:00.000Z',
        isToolUse: true,
        toolName: 'TodoWrite',
        toolInput: JSON.stringify({
          todos: [
            { content: 'Review draft', status: 'in_progress', priority: 'high' },
          ],
        }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:03:00.000Z',
        isToolUse: true,
        toolName: 'Write',
        toolInput: JSON.stringify({ file_path: 'outputs/report.md', content: '# report' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:04:00.000Z',
        isTaskNotification: true,
        taskId: '42',
        taskOutputFile: 'outputs/notes.txt',
        content: 'Background task finished',
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot, {
      'outputs/report.md': {
        reviewedAt: '2026-03-26T10:05:00.000Z',
      },
    });

    expect(summary.contextFiles.map((item) => item.relativePath).sort()).toEqual([
      'docs/plan.md',
      'src/app.ts',
    ]);
    expect(summary.tasks.some((item) => item.label === 'Review draft')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'Task 42')).toBe(true);
    expect(summary.outputFiles.map((item) => ({ path: item.relativePath, unread: item.unread }))).toEqual([
      { path: 'outputs/notes.txt', unread: true },
      { path: 'outputs/report.md', unread: false },
    ]);
    expect(summary.unreadCount).toBe(1);
  });

  it('marks an output unread again when it changes after review', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:00:00.000Z',
        isToolUse: true,
        toolName: 'Edit',
        toolInput: JSON.stringify({ file_path: 'outputs/report.md' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-26T10:06:00.000Z',
        isToolUse: true,
        toolName: 'Edit',
        toolInput: JSON.stringify({ file_path: 'outputs/report.md' }),
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot, {
      'outputs/report.md': {
        reviewedAt: '2026-03-26T10:05:00.000Z',
      },
    });

    expect(summary.outputFiles[0].relativePath).toBe('outputs/report.md');
    expect(summary.outputFiles[0].unread).toBe(true);
  });

  it('recognizes Codex shell reads, plans, patch outputs, and web actions', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:18:28.000Z',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: JSON.stringify({
          command: "sed -n '1,200p' src/components/chat/utils/sessionContextSummary.ts",
          workdir: projectRoot,
        }),
        toolResult: {
          content: 'const summary = true;',
          isError: false,
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:19:00.000Z',
        isToolUse: true,
        toolName: 'UpdatePlan',
        toolInput: JSON.stringify({
          plan: [
            { step: 'Normalize Codex history', status: 'in_progress' },
            { step: 'Expand session summary', status: 'pending' },
          ],
        }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:20:00.000Z',
        isToolUse: true,
        toolName: 'Edit',
        toolInput: JSON.stringify({
          file_path: 'src/components/chat/utils/sessionContextSummary.ts',
          file_paths: [
            'src/components/chat/utils/sessionContextSummary.ts',
            'docs/plan.md',
          ],
        }),
        toolResult: {
          content: 'Success',
          isError: false,
          toolUseResult: {
            changes: {
              'src/components/chat/utils/sessionContextSummary.ts': { type: 'update' },
              'docs/plan.md': { type: 'add' },
            },
          },
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:21:00.000Z',
        isToolUse: true,
        toolName: 'WebSearch',
        toolInput: JSON.stringify({ query: 'Codex session context panel' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:21:30.000Z',
        isToolUse: true,
        toolName: 'OpenPage',
        toolInput: JSON.stringify({ url: 'https://developers.openai.com/api/docs' }),
      },
      {
        type: 'assistant',
        timestamp: '2026-03-30T05:22:00.000Z',
        isToolUse: true,
        toolName: 'FindInPage',
        toolInput: JSON.stringify({
          url: 'https://developers.openai.com/api/docs',
          pattern: 'session',
        }),
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot);

    expect(summary.contextFiles.some((item) => item.relativePath === 'src/components/chat/utils/sessionContextSummary.ts')).toBe(true);
    expect(summary.outputFiles.map((item) => item.relativePath).sort()).toEqual([
      'docs/plan.md',
      'src/components/chat/utils/sessionContextSummary.ts',
    ]);
    expect(summary.tasks.some((item) => item.label === 'Normalize Codex history' && item.kind === 'todo')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'Codex session context panel')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'https://developers.openai.com/api/docs')).toBe(true);
    expect(summary.tasks.some((item) => item.label === 'session')).toBe(true);
  });

  it('ignores dotted shell fragments that are not real file paths', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-31T12:00:00.000Z',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: JSON.stringify({
          command: "jq '.sections.survey.synthesis_summary, .sections.survey.open_gaps' pipeline/docs/research_brief.json",
          workdir: projectRoot,
        }),
        toolResult: {
          content: '',
          isError: false,
        },
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot);
    const contextPaths = summary.contextFiles.map((item) => item.relativePath);

    expect(contextPaths).toContain('pipeline/docs/research_brief.json');
    expect(contextPaths.some((path) => path.includes('sections.survey'))).toBe(false);
    expect(contextPaths.some((path) => path.includes('open_gaps'))).toBe(false);
  });

  it('strips trailing punctuation from real paths and rejects slash-delimited prose fragments', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-31T12:05:00.000Z',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: JSON.stringify({
          command: 'cat ./pipeline/docs/research_brief.json. ./Survey/reports/model_dataset_inventory.json. 3.0/GPT-5.3.',
          workdir: projectRoot,
        }),
        toolResult: {
          content: 'Wrote ./pipeline/tasks/tasks.json.',
          isError: false,
        },
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot);
    const contextPaths = summary.contextFiles.map((item) => item.relativePath).sort();

    expect(contextPaths).toContain('pipeline/docs/research_brief.json');
    expect(contextPaths).toContain('Survey/reports/model_dataset_inventory.json');
    expect(contextPaths).toContain('pipeline/tasks/tasks.json');
    expect(contextPaths.some((path) => path.endsWith('.'))).toBe(false);
    expect(contextPaths).not.toContain('3.0/GPT-5.3.');
    expect(contextPaths).not.toContain('3.0/GPT-5.3');
  });

  it('does not turn slash-delimited prose into shell directories', () => {
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-31T12:10:00.000Z',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: JSON.stringify({
          command: 'python analyze.py cost/latency GeneAgent/BioAgents/GeneGPT HealthBench/MedAgentBench ./Survey/reports',
          workdir: projectRoot,
        }),
        toolResult: {
          content: 'Compared GPT-5.3. with cost/latency tradeoffs.',
          isError: false,
        },
      },
    ] as any;

    const summary = deriveSessionContextSummary(messages, projectRoot);
    const directoryLabels = summary.directories.map((item) => item.label);
    const contextPaths = summary.contextFiles.map((item) => item.relativePath);

    expect(directoryLabels).toContain('Survey/reports');
    expect(directoryLabels).not.toContain('cost/latency');
    expect(directoryLabels).not.toContain('GeneAgent/BioAgents/GeneGPT');
    expect(directoryLabels).not.toContain('HealthBench/MedAgentBench');
    expect(contextPaths).not.toContain('cost/latency');
    expect(contextPaths).not.toContain('GeneAgent/BioAgents/GeneGPT');
    expect(contextPaths).not.toContain('HealthBench/MedAgentBench');
    expect(contextPaths).not.toContain('GPT-5.3.');
    expect(contextPaths).not.toContain('GPT-5.3');
  });

  it('prefers session workdir over an unrelated project root when normalizing paths', () => {
    const wrongProjectRoot = '/workspace/demo';
    const sessionRoot = '/home/testuser/projects/experiment-2026';
    const messages = [
      {
        type: 'assistant',
        timestamp: '2026-03-31T12:15:00.000Z',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: JSON.stringify({
          command: `cat ${sessionRoot}/instance.json ./instance.json`,
          workdir: sessionRoot,
        }),
        toolResult: {
          content: '',
          isError: false,
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-03-31T12:16:00.000Z',
        isToolUse: true,
        toolName: 'LS',
        toolInput: JSON.stringify({
          path: `${sessionRoot}/analysis`,
        }),
      },
    ] as any;

    expect(resolveSessionContextProjectRoot(messages, wrongProjectRoot)).toBe(sessionRoot);

    const summary = deriveSessionContextSummary(messages, wrongProjectRoot);
    const contextPaths = summary.contextFiles.map((item) => item.relativePath);
    const directoryLabels = summary.directories.map((item) => item.label);

    expect(contextPaths).toEqual(['instance.json']);
    expect(directoryLabels).toEqual(['analysis']);
    expect(contextPaths.some((path) => path.startsWith('/Users/'))).toBe(false);
    expect(directoryLabels.some((label) => label.startsWith('/Users/'))).toBe(false);
  });
});

describe('mergeDistinctChatMessages', () => {
  it('keeps one copy of duplicated tool events and sorts by timestamp', () => {
    const merged = mergeDistinctChatMessages(
      [
        {
          type: 'assistant',
          timestamp: '2026-03-26T10:00:00.000Z',
          isToolUse: true,
          toolId: 'tool-1',
          toolName: 'Read',
          toolInput: JSON.stringify({ file_path: 'src/app.ts' }),
        },
      ] as any,
      [
        {
          type: 'assistant',
          timestamp: '2026-03-26T10:00:00.000Z',
          isToolUse: true,
          toolId: 'tool-1',
          toolName: 'Read',
          toolInput: JSON.stringify({ file_path: 'src/app.ts' }),
        },
        {
          type: 'assistant',
          timestamp: '2026-03-26T10:01:00.000Z',
          content: 'Done',
        },
      ] as any,
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].timestamp).toBe('2026-03-26T10:00:00.000Z');
    expect(merged[1].timestamp).toBe('2026-03-26T10:01:00.000Z');
  });
});


describe('context trace identity', () => {
  it('counts a history/live tool event once and keeps the completed result', () => {
    const history = { type: 'assistant', isToolUse: true, toolName: 'Read', toolId: 'shared-tool', timestamp: '2026-10-23T10:00:00Z', toolInput: '{"file_path":"src/app.ts"}', toolResult: { content: 'source', isError: false } };
    const live = { ...history, messageId: 'local-message-id', toolInput: JSON.stringify({ file_path: 'src/app.ts' }, null, 2), toolResult: undefined };
    const next = { ...history, toolId: 'next-tool', timestamp: '2026-10-23T10:01:00Z' };
    const merged = mergeDistinctChatMessages([history], [live, next] as any);
    expect(merged).toHaveLength(2);
    expect(merged[0].toolResult?.content).toBe('source');
    expect(deriveSessionContextSummary(merged, '/workspace').contextFiles[0].count).toBe(2);
  });
});
