import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../utils/cliArgs.js';

describe('cli parseArgs', () => {
  it('parses OpenRouter relay base URL for chat sessions', () => {
    expect(parseCliArgs([
      'chat',
      '--model',
      'deepseek/deepseek-r1',
      '--key',
      'sk-or-test',
      '--base-url',
      'https://relay.example.com/v1',
    ])).toEqual({
      command: 'chat',
      options: {
        model: 'deepseek/deepseek-r1',
        key: 'sk-or-test',
        baseUrl: 'https://relay.example.com/v1',
      },
    });
  });

  it('parses inline base-url arguments', () => {
    expect(parseCliArgs([
      'chat',
      '--base-url=https://relay.example.com/v1',
    ])).toEqual({
      command: 'chat',
      options: {
        baseUrl: 'https://relay.example.com/v1',
      },
    });
  });
});
