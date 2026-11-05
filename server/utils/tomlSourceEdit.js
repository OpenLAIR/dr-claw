import TOML from '@iarna/toml';
import TomlParser from '@iarna/toml/lib/toml-parser.js';
import { isDeepStrictEqual } from 'util';

// Record source ranges with the same parser that validates the configuration.
// Do not guess table boundaries from regexes: multiline strings can contain
// apparent headers, assignments and comment markers. These hooks are covered
// by syntax fixtures; the final parsed result must also match the intended edit.
class SourceParser extends TomlParser {
  constructor(source) { super(); this.source = source; this.assignments = []; this.headers = []; this.comments = []; }
  parseStart() {
    if (this.char === 91) this.headerStart = this.ii;
    return super.parseStart();
  }
  parseAssignStatement() {
    this.assignment = { start: this.ii, context: this.ctx };
    return super.parseAssignStatement();
  }
  parseAssignPreValue() {
    if (this.assignment && this.assignment.valueStart === undefined && ![32, 9].includes(this.char)) this.assignment.valueStart = this.ii;
    return super.parseAssignPreValue();
  }
  recordAssignStatement(pair) {
    this.assignments.push({ ...this.assignment, key: [...pair.key], end: Math.min(this.ii, this.source.length) });
    this.assignment = null;
    return super.recordAssignStatement(pair);
  }
  parseWhitespaceToEOL() {
    if (this.headerStart !== undefined) {
      this.headers.push({ start: this.headerStart, end: this.ii, context: this.ctx, array: this.source[this.headerStart + 1] === '[' });
      this.headerStart = undefined;
    }
    return super.parseWhitespaceToEOL();
  }
  parseComment() {
    const start = this.source[this.ii] === '#' ? this.ii : this.ii - 1;
    const result = super.parseComment();
    this.comments.push({ start, end: Math.min(this.ii, this.source.length) });
    return result;
  }
}

const prefix = (parent, child) => parent.length <= child.length && parent.every((part, index) => part === child[index]);
const at = (object, parts) => parts.reduce((value, part) => value != null && Object.prototype.hasOwnProperty.call(value, part) ? value[part] : undefined, object);
const keyText = parts => parts.filter(part => typeof part !== 'number').map(part => JSON.stringify(part)).join('.');
const comparable = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export function editTomlServerSource(source, desired, originalName, name) {
  const parser = new SourceParser(source);
  parser.parse(source);
  const original = parser.finish();
  const paths = new WeakMap();
  const visit = (value, parts) => {
    if (value === null || typeof value !== 'object') return;
    paths.set(value, parts);
    for (const [key, child] of Object.entries(value)) visit(child, [...parts, Array.isArray(value) ? Number(key) : key]);
  };
  visit(original, []);
  const before = ['mcp_servers', originalName], after = ['mcp_servers', name];
  const mapped = parts => prefix(before, parts) ? [...after, ...parts.slice(before.length)] : parts;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const patches = [];
  const assignments = parser.assignments.map(record => ({ ...record, contextPath: paths.get(record.context), path: [...paths.get(record.context), ...record.key] }));
  const headers = parser.headers.map(record => ({ ...record, path: paths.get(record.context) }));
  const commentsIn = (start, end) => parser.comments.filter(comment => comment.start >= start && comment.end <= end).map(comment => source.slice(comment.start, comment.end));
  const replacementValue = (value, start, end) => {
    const comments = commentsIn(start, end);
    return TOML.stringify.value(value) + (comments.length ? ` ${comments.join(newline)}${newline}` : '');
  };
  for (const record of assignments) {
    if (!prefix(before, record.path) && !prefix(record.path, before)) continue;
    const nextPath = mapped(record.path), value = at(desired, nextPath);
    if (value === undefined) {
      patches.push({ start: record.start, end: record.end, text: commentsIn(record.start, record.end).join(newline) });
      continue;
    }
    const relative = nextPath.slice(mapped(record.contextPath).length);
    if (!isDeepStrictEqual(relative, record.key)) {
      // A dotted or inline ancestor assignment can include the server name.
      const text = `${keyText(relative)} = ${replacementValue(value, record.valueStart, record.end)}`;
      patches.push({ start: record.start, end: record.end, text });
    } else if (!isDeepStrictEqual(comparable(at(original, record.path)), comparable(value))) {
      patches.push({ start: record.valueStart, end: record.end, text: replacementValue(value, record.valueStart, record.end) });
    }
  }
  for (const record of headers) {
    if (!prefix(before, record.path)) continue;
    const nextPath = mapped(record.path);
    if (at(desired, nextPath) === undefined) patches.push({ start: record.start, end: record.end, text: '' });
    else if (originalName !== name) patches.push({ start: record.start, end: record.end, text: `${record.array ? '[[' : '['}${keyText(nextPath)}${record.array ? ']]' : ']'}` });
  }
  // Add only values not already represented by an existing assignment (an
  // inline object owns its entire subtree). Use the deepest existing table.
  const additions = [];
  const gather = (value, parts) => {
    if (assignments.some(record => prefix(mapped(record.path), parts))) return;
    const previous = at(original, [...before, ...parts.slice(after.length)]);
    if (previous === undefined) { additions.push({ parts, value }); return; }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) gather(child, [...parts, key]);
    }
  };
  gather(at(desired, after), after);
  const contexts = [{ path: [], end: headers[0]?.start ?? source.length }, ...headers.map((header, index) => ({ path: mapped(header.path), end: headers[index + 1]?.start ?? source.length }))];
  const insertions = new Map();
  for (const { parts, value } of additions) {
    const context = contexts.filter(item => prefix(item.path, parts) && item.path.length < parts.length && at(desired, item.path) !== undefined).sort((a, b) => b.path.length - a.path.length)[0];
    const line = `${keyText(parts.slice(context.path.length))} = ${TOML.stringify.value(value)}${newline}`;
    insertions.set(context.end, (insertions.get(context.end) || '') + line);
  }
  for (const [position, text] of insertions) patches.push({ start: position, end: position, text: (position && !source.slice(0, position).endsWith('\n') ? newline : '') + text });
  let result = source;
  for (const patch of patches.sort((a, b) => b.start - a.start || b.end - a.end)) result = result.slice(0, patch.start) + patch.text + result.slice(patch.end);
  if (!isDeepStrictEqual(comparable(TOML.parse(result)), comparable(desired))) throw new Error('The formatted configuration did not match the requested edit. The original file was not changed.');
  return result;
}
