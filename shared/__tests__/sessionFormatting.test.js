import { expect, it } from 'vitest';
import { stripInternalContextPrefix } from '../sessionFormatting.js';

it.each([
  ['[Context: session-mode=workspace_qa]', 'Workspace Q&A', null],
  ['[Context: session-mode=research]', 'Research Session', null],
  ['[Context: truncated', 'New Session', null],
  ['[Context: internal] [Context: second] actual question', 'actual question', 'actual question'],
  ['<command-name>/skill</command-name>\nBase directory for this skill: /tmp/skill', 'New Session', null],
])('cleans shared session content %s', (input, title, content) => {
  expect(stripInternalContextPrefix(input)).toBe(title);
  expect(stripInternalContextPrefix(input, false)).toBe(content);
});
