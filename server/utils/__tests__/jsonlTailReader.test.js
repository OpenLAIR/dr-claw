import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import { readJsonlLinesFrom } from '../jsonlTailReader.js';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drclaw-jsonl-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function collect(filePath, startOffset = 0) {
  const lines = [];
  const result = await readJsonlLinesFrom(filePath, startOffset, (line) => lines.push(line));
  return { lines, ...result };
}

describe('readJsonlLinesFrom', () => {
  it('reads every complete line and reports the end offset', async () => {
    const file = path.join(tmpDir, 'a.jsonl');
    const content = '{"a":1}\n{"a":2}\n{"a":3}\n';
    await fs.writeFile(file, content);

    const { lines, consumedBytes, lineCount } = await collect(file);

    expect(lines).toEqual(['{"a":1}', '{"a":2}', '{"a":3}']);
    expect(lineCount).toBe(3);
    expect(consumedBytes).toBe(Buffer.byteLength(content));
  });

  it('resumes from an offset so appended lines are read exactly once', async () => {
    const file = path.join(tmpDir, 'b.jsonl');
    await fs.writeFile(file, '{"n":1}\n{"n":2}\n');

    const first = await collect(file);
    expect(first.lines).toEqual(['{"n":1}', '{"n":2}']);

    await fs.appendFile(file, '{"n":3}\n{"n":4}\n');

    const second = await collect(file, first.consumedBytes);
    expect(second.lines).toEqual(['{"n":3}', '{"n":4}']);
    expect(second.consumedBytes).toBe((await fs.stat(file)).size);
  });

  it('does not consume a trailing line that has no newline yet', async () => {
    const file = path.join(tmpDir, 'c.jsonl');
    await fs.writeFile(file, '{"done":true}\n{"partial":');

    const first = await collect(file);
    expect(first.lines).toEqual(['{"done":true}']);
    expect(first.consumedBytes).toBe(Buffer.byteLength('{"done":true}\n'));

    // Writer finishes the line; resuming must yield the whole line, not the tail.
    await fs.appendFile(file, 'true}\n');
    const second = await collect(file, first.consumedBytes);
    expect(second.lines).toEqual(['{"partial":true}']);
  });

  it('surfaces an unterminated final line separately from consumed lines', async () => {
    // A file that simply ends without a newline still has a real final record.
    // It is reported via trailingLine so callers can use it, but excluded from
    // consumedBytes so a later resume re-reads it exactly once.
    const file = path.join(tmpDir, 'h.jsonl');
    await fs.writeFile(file, '{"a":1}\n{"a":2}');

    const { lines, consumedBytes, trailingLine } = await collect(file);

    expect(lines).toEqual(['{"a":1}']);
    expect(trailingLine).toBe('{"a":2}');
    expect(consumedBytes).toBe(Buffer.byteLength('{"a":1}\n'));

    // Resuming re-reads the previously trailing record, now terminated.
    await fs.appendFile(file, '\n');
    const second = await collect(file, consumedBytes);
    expect(second.lines).toEqual(['{"a":2}']);
    expect(second.trailingLine).toBeNull();
  });

  it('reports no trailing line when the file ends with a newline', async () => {
    const file = path.join(tmpDir, 'i.jsonl');
    await fs.writeFile(file, '{"a":1}\n');

    const { trailingLine } = await collect(file);
    expect(trailingLine).toBeNull();
  });

  it('keeps offsets byte-accurate for multi-byte UTF-8 content', async () => {
    const file = path.join(tmpDir, 'd.jsonl');
    const line1 = JSON.stringify({ msg: '请问大家有变卡的情况吗' });
    const line2 = JSON.stringify({ msg: '卡顿 🦞 emoji' });
    await fs.writeFile(file, `${line1}\n`);

    const first = await collect(file);
    expect(first.lines).toEqual([line1]);
    expect(first.consumedBytes).toBe(Buffer.byteLength(`${line1}\n`, 'utf8'));

    await fs.appendFile(file, `${line2}\n`);
    const second = await collect(file, first.consumedBytes);
    expect(second.lines).toEqual([line2]);
    expect(JSON.parse(second.lines[0]).msg).toBe('卡顿 🦞 emoji');
  });

  it('strips CRLF carriage returns while still counting their bytes', async () => {
    const file = path.join(tmpDir, 'e.jsonl');
    const content = '{"x":1}\r\n{"x":2}\r\n';
    await fs.writeFile(file, content);

    const { lines, consumedBytes } = await collect(file);

    expect(lines).toEqual(['{"x":1}', '{"x":2}']);
    expect(consumedBytes).toBe(Buffer.byteLength(content));
  });

  it('skips blank lines but still counts them toward the offset', async () => {
    const file = path.join(tmpDir, 'f.jsonl');
    const content = '{"x":1}\n\n   \n{"x":2}\n';
    await fs.writeFile(file, content);

    const { lines, consumedBytes } = await collect(file);

    expect(lines).toEqual(['{"x":1}', '{"x":2}']);
    expect(consumedBytes).toBe(Buffer.byteLength(content));
  });

  it('yields to the event loop while reading', async () => {
    const file = path.join(tmpDir, 'g.jsonl');
    const content = Array.from({ length: 500 }, (_, i) => `{"i":${i}}`).join('\n') + '\n';
    await fs.writeFile(file, content);

    let timerRan = false;
    const timer = setInterval(() => { timerRan = true; }, 1);

    const lines = [];
    await readJsonlLinesFrom(file, 0, (line) => lines.push(line), { yieldEvery: 10 });
    clearInterval(timer);

    expect(lines).toHaveLength(500);
    expect(timerRan).toBe(true);
  });
});
