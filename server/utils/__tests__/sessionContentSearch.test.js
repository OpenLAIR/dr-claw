import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import {
  MAX_QUERY_TERMS,
  buildSnippet,
  createSessionMatcher,
  extractEntryText,
  lineMayMatch,
  matchMessages,
  scanJsonlTranscript,
  titleFromMessage,
  tokenizeSearchQuery,
} from '../sessionContentSearch.js';

describe('tokenizeSearchQuery', () => {
  it('lower-cases, splits on whitespace and drops duplicates', () => {
    expect(tokenizeSearchQuery('  Attention   attention  HEADS ')).toEqual(['attention', 'heads']);
  });

  it('returns nothing for blank or non-string input', () => {
    expect(tokenizeSearchQuery('   ')).toEqual([]);
    expect(tokenizeSearchQuery(undefined)).toEqual([]);
  });

  it('caps the number of terms', () => {
    const query = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    expect(tokenizeSearchQuery(query)).toHaveLength(MAX_QUERY_TERMS);
  });
});

describe('lineMayMatch', () => {
  it('keeps lines containing any term, case-insensitively', () => {
    expect(lineMayMatch('{"text":"Learning RATE schedule"}', ['rate'])).toBe(true);
    expect(lineMayMatch('{"text":"nothing here"}', ['rate'])).toBe(false);
  });

  it('keeps lines with unicode escapes, which could hide a term', () => {
    expect(lineMayMatch('{"text":"\\u5b9e\\u9a8c"}', ['实验'])).toBe(true);
  });
});

describe('extractEntryText', () => {
  it('reads Claude user strings and assistant text parts, skipping tools and thinking', () => {
    expect(extractEntryText('claude', {
      type: 'user', sessionId: 's1', message: { role: 'user', content: 'Plot the loss curve' },
    })).toEqual({ sessionId: 's1', text: 'Plot the loss curve' });

    expect(extractEntryText('claude', {
      type: 'assistant',
      sessionId: 's1',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'secret plan' },
          { type: 'text', text: 'Here is the plot.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    })).toEqual({ sessionId: 's1', text: 'Here is the plot.' });

    expect(extractEntryText('claude', {
      type: 'user', sessionId: 's1', message: { role: 'user', content: [{ type: 'tool_result', content: 'file.txt' }] },
    })).toBeNull();
  });

  it('skips Claude meta entries, summaries and injected command output', () => {
    expect(extractEntryText('claude', { type: 'summary', summary: 'Loss curve' })).toBeNull();
    expect(extractEntryText('claude', {
      type: 'user', isMeta: true, sessionId: 's1', message: { content: 'Caveat: hidden' },
    })).toBeNull();
    expect(extractEntryText('claude', {
      type: 'user', sessionId: 's1', message: { content: '<local-command-stdout>ok</local-command-stdout>' },
    })).toBeNull();
  });

  it('strips the internal [Context: ...] prefix from user text', () => {
    expect(extractEntryText('claude', {
      type: 'user', sessionId: 's1', message: { content: '[Context: session-mode=research] Find datasets' },
    })).toEqual({ sessionId: 's1', text: 'Find datasets' });
  });

  it('reads Gemini messages and ignores tool entries', () => {
    expect(extractEntryText('gemini', { type: 'message', role: 'assistant', content: 'Gemini answer' }))
      .toEqual({ sessionId: null, text: 'Gemini answer' });
    expect(extractEntryText('gemini', { type: 'tool_result', role: 'user', content: 'out' })).toBeNull();
  });

  it('reads Codex response messages and skips environment context', () => {
    expect(extractEntryText('codex', {
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Codex answer' }] },
    })).toEqual({ sessionId: null, text: 'Codex answer' });

    expect(extractEntryText('codex', {
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] },
    })).toBeNull();

    expect(extractEntryText('codex', { type: 'response_item', payload: { type: 'function_call_output', output: 'x' } })).toBeNull();
  });

  it('reads plain role/content entries for OpenRouter, local and Nano', () => {
    expect(extractEntryText('openrouter', { role: 'user', content: 'hello there' })).toEqual({ sessionId: null, text: 'hello there' });
    expect(extractEntryText('local', { role: 'tool', content: 'ignored' })).toBeNull();
    expect(extractEntryText('nano', { role: 'assistant', content: [{ type: 'text', text: 'nano reply' }] }))
      .toEqual({ sessionId: null, text: 'nano reply' });
  });
});

describe('buildSnippet', () => {
  it('returns short text whole, with whitespace collapsed', () => {
    expect(buildSnippet('Tune   the\nlearning rate', ['learning'])).toBe('Tune the learning rate');
  });

  it('centres on the earliest term and marks both cuts', () => {
    const text = `${'alpha '.repeat(40)}the KEYWORD appears here ${'omega '.repeat(40)}`;
    const snippet = buildSnippet(text, ['keyword'], { before: 20, after: 20 });
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('KEYWORD');
    expect(snippet.length).toBeLessThan(70);
  });

  it('keeps the hit near the start by default, so a narrow row still shows it', () => {
    const text = `${'lorem ipsum '.repeat(30)}the quokka line ${'dolor sit '.repeat(30)}`;
    const snippet = buildSnippet(text, ['quokka']);
    expect(snippet.indexOf('quokka')).toBeLessThan(30);
  });

  it('does not add a leading ellipsis when the hit is at the start', () => {
    const snippet = buildSnippet(`keyword ${'x '.repeat(200)}`, ['keyword'], { before: 20, after: 20 });
    expect(snippet.startsWith('keyword')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('handles CJK text without word boundaries', () => {
    const text = `${'前文'.repeat(50)}消融实验的结果${'后文'.repeat(50)}`;
    const snippet = buildSnippet(text, ['消融实验'], { before: 10, after: 10 });
    expect(snippet).toContain('消融实验');
    expect(snippet.startsWith('…')).toBe(true);
  });

  it('never splits a surrogate pair', () => {
    const text = `${'😀'.repeat(40)}target${'😀'.repeat(40)}`;
    const snippet = buildSnippet(text, ['target'], { before: 7, after: 7 });
    expect(snippet).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe('titleFromMessage', () => {
  it('uses the first non-empty line without markdown markers', () => {
    expect(titleFromMessage('\n## **Plan** the run\nmore')).toBe('Plan the run');
  });

  it('shortens long lines', () => {
    const title = titleFromMessage('a'.repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('createSessionMatcher', () => {
  it('matches when the terms are spread over several messages', () => {
    const matcher = createSessionMatcher(['dataset', 'baseline']);
    matcher.add('Which dataset should we use?');
    expect(matcher.isMatch()).toBe(false);
    matcher.add('Compare against the baseline.');
    expect(matcher.isMatch()).toBe(true);
    expect(matcher.snippet()).toBe('Which dataset should we use?');
  });

  it('prefers a message that contains more of the terms', () => {
    const matcher = createSessionMatcher(['dataset', 'baseline']);
    matcher.add('dataset only');
    matcher.add('the baseline on this dataset');
    expect(matcher.snippet()).toBe('the baseline on this dataset');
    expect(matcher.isSettled()).toBe(true);
  });

  it('does not match when a term never appears', () => {
    const matcher = createSessionMatcher(['dataset', 'missing']);
    matcher.add('dataset');
    expect(matcher.isMatch()).toBe(false);
  });
});

describe('matchMessages', () => {
  it('returns a snippet for a matching message list, or null', () => {
    const messages = [{ role: 'user', content: 'Summarise the Nano notes' }, { role: 'assistant', content: 'Done' }];
    expect(matchMessages('nano', messages, ['nano'])).toBe('Summarise the Nano notes');
    expect(matchMessages('nano', messages, ['absent'])).toBeNull();
  });
});

describe('scanJsonlTranscript', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drclaw-content-search-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const writeJsonl = async (name, entries) => {
    const filePath = path.join(tmpDir, name);
    await fs.writeFile(filePath, entries.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n'));
    return filePath;
  };

  it('groups Claude hits by the sessionId on each line', async () => {
    const filePath = await writeJsonl('a.jsonl', [
      { type: 'user', sessionId: 'one', message: { content: 'Tell me about zebrafish' } },
      { type: 'assistant', sessionId: 'two', message: { content: [{ type: 'text', text: 'Nothing on fish here' }] } },
      'not json at all zebrafish',
      { type: 'assistant', sessionId: 'one', message: { content: [{ type: 'text', text: 'Zebrafish regenerate fins.' }] } },
    ]);

    const { results } = await scanJsonlTranscript(filePath, { provider: 'claude', terms: ['zebrafish'] });
    expect(results).toEqual([{ sessionId: 'one', snippet: 'Tell me about zebrafish', title: 'Tell me about zebrafish' }]);
  });

  it('uses the given sessionId for single-session providers', async () => {
    const filePath = await writeJsonl('g.jsonl', [
      { type: 'message', role: 'user', content: 'What is a transformer?' },
      { type: 'message', role: 'assistant', content: 'A transformer uses attention.' },
    ]);
    const { results } = await scanJsonlTranscript(filePath, {
      provider: 'gemini', terms: ['transformer', 'attention'], sessionId: 'gem-1',
    });
    expect(results).toEqual([{ sessionId: 'gem-1', snippet: 'A transformer uses attention.', title: 'What is a transformer?' }]);
  });

  it('names a session after its first user message even when that line has no hit', async () => {
    const filePath = await writeJsonl('title.jsonl', [
      { type: 'user', sessionId: 's', message: { content: 'Plan the ablation study' } },
      { type: 'assistant', sessionId: 's', message: { content: [{ type: 'text', text: 'Start with the quokka baseline.' }] } },
    ]);
    const { results } = await scanJsonlTranscript(filePath, { provider: 'claude', terms: ['quokka'] });
    expect(results).toEqual([{ sessionId: 's', snippet: 'Start with the quokka baseline.', title: 'Plan the ablation study' }]);
  });

  it('does not search tool output', async () => {
    const filePath = await writeJsonl('t.jsonl', [
      { type: 'user', sessionId: 's', message: { content: [{ type: 'tool_result', content: 'secretword in a file' }] } },
    ]);
    const { results } = await scanJsonlTranscript(filePath, { provider: 'claude', terms: ['secretword'] });
    expect(results).toEqual([]);
  });

  it('reads only the first maxBytes of a large file', async () => {
    const filler = { type: 'user', sessionId: 's', message: { content: 'x'.repeat(200) } };
    const filePath = await writeJsonl('big.jsonl', [
      ...Array.from({ length: 50 }, () => filler),
      { type: 'user', sessionId: 's', message: { content: 'needle at the end' } },
    ]);
    const { results } = await scanJsonlTranscript(filePath, { provider: 'claude', terms: ['needle'], maxBytes: 4096 });
    expect(results).toEqual([]);
  });

  it('stops when asked to and reports it', async () => {
    const filePath = await writeJsonl('stop.jsonl', [
      { type: 'user', sessionId: 's', message: { content: 'needle' } },
    ]);
    const outcome = await scanJsonlTranscript(filePath, { provider: 'claude', terms: ['needle'], shouldStop: () => true });
    expect(outcome).toEqual({ results: [], truncated: true });
  });

  it('applies acceptText to drop unwanted messages', async () => {
    const filePath = await writeJsonl('c.jsonl', [
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS rules needle' }] } },
    ]);
    const { results } = await scanJsonlTranscript(filePath, {
      provider: 'codex', terms: ['needle'], sessionId: 'c1', acceptText: (text) => !text.startsWith('# AGENTS'),
    });
    expect(results).toEqual([]);
  });
});
