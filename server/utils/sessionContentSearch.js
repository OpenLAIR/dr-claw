/**
 * Full-text search over session transcripts.
 *
 * Transcripts are not stored in the database; each provider writes its own
 * JSONL (or JSON) file. This module holds the provider-independent parts:
 * query tokenizing, pulling the user/assistant text out of one transcript
 * entry, matching and snippet building, and streaming one file. Locating the
 * files for a user's projects lives in projects.js.
 */

import fsSync from 'fs';
import readline from 'readline';

import { stripInternalContextPrefix } from './sessionFormatting.js';

export const MAX_QUERY_TERMS = 8;
export const MAX_TERM_LENGTH = 100;
/** Context kept before and after the first hit; the sidebar shows one short line. */
export const SNIPPET_BEFORE = 24;
export const SNIPPET_AFTER = 100;
export const TITLE_MAX_LENGTH = 80;
/** Lines longer than this are tool output or inline images, not chat text. */
export const MAX_LINE_LENGTH = 512 * 1024;

/** Lower-cased, de-duplicated words of a query; every one has to match. */
export function tokenizeSearchQuery(query) {
  if (typeof query !== 'string') return [];
  const terms = [];
  for (const raw of query.trim().toLowerCase().split(/\s+/)) {
    const term = raw.slice(0, MAX_TERM_LENGTH);
    if (term && !terms.includes(term)) terms.push(term);
    if (terms.length >= MAX_QUERY_TERMS) break;
  }
  return terms;
}

/**
 * Cheap check on the raw JSON line before parsing it: skip lines that contain
 * none of the terms. A `\u` escape could hide a term, so such lines are kept.
 */
export function lineMayMatch(line, terms) {
  const lower = line.toLowerCase();
  return lower.includes('\\u') || terms.some((term) => lower.includes(term));
}

function joinTextParts(content, textTypes) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && textTypes.includes(part.type) && typeof part.text === 'string') return part.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

const CLAUDE_NOISE_PREFIXES = ['Caveat: The messages below', '<system-reminder>', '<local-command-'];

/** Text a user would recognise as the conversation, without injected context. */
function cleanMessageText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const cleaned = stripInternalContextPrefix(text, false);
  if (!cleaned || !cleaned.trim()) return null;
  if (CLAUDE_NOISE_PREFIXES.some((prefix) => cleaned.startsWith(prefix))) return null;
  return cleaned;
}

/**
 * Pull the chat text out of one parsed transcript entry. Returns
 * `{ sessionId, text }` (sessionId only for Claude, whose files may hold
 * several sessions) or null for tool calls, tool output and metadata.
 */
export function extractEntryText(provider, entry) {
  if (!entry || typeof entry !== 'object') return null;

  switch (provider) {
    case 'claude': {
      if ((entry.type !== 'user' && entry.type !== 'assistant') || entry.isMeta) return null;
      const text = cleanMessageText(joinTextParts(entry.message?.content, ['text']));
      return text ? { sessionId: entry.sessionId || null, text } : null;
    }
    case 'gemini': {
      if (entry.type === 'tool_use' || entry.type === 'tool_result') return null;
      const role = entry.role || entry.message?.role;
      if (role !== 'user' && role !== 'assistant' && role !== 'model') return null;
      const content = entry.content || entry.message?.content;
      const text = cleanMessageText(joinTextParts(content, ['text']));
      return text ? { sessionId: null, text } : null;
    }
    case 'codex': {
      if (entry.type !== 'response_item' || entry.payload?.type !== 'message') return null;
      const role = entry.payload.role;
      if (role !== 'user' && role !== 'assistant') return null;
      const raw = joinTextParts(entry.payload.content, ['input_text', 'output_text', 'text']);
      if (raw.includes('<environment_context>') || raw.includes('<user_instructions>')) return null;
      const text = cleanMessageText(raw);
      return text ? { sessionId: null, text } : null;
    }
    case 'openrouter':
    case 'local':
    case 'nano': {
      if (entry.role !== 'user' && entry.role !== 'assistant') return null;
      const text = cleanMessageText(joinTextParts(entry.content, ['text']));
      return text ? { sessionId: null, text } : null;
    }
    default:
      return null;
  }
}

function isUserEntry(provider, entry) {
  if (provider === 'claude') return entry.type === 'user';
  if (provider === 'codex') return entry.payload?.role === 'user';
  return (entry.role || entry.message?.role) === 'user';
}

/** Index of the first code unit that is not the second half of a surrogate pair. */
function safeBoundary(text, index) {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff ? index + 1 : index;
}

/**
 * A short excerpt of `text` starting just before the earliest term (so the
 * hit stays visible in a narrow row), whitespace collapsed, with an ellipsis
 * on each side that was cut.
 */
export function buildSnippet(text, terms, { before = SNIPPET_BEFORE, after = SNIPPET_AFTER } = {}) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const lower = flat.toLowerCase();

  let hitIndex = -1;
  let hitLength = 0;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (hitIndex === -1 || index < hitIndex)) {
      hitIndex = index;
      hitLength = term.length;
    }
  }
  if (hitIndex === -1) {
    hitIndex = 0;
  }
  // toLowerCase can change the length of a few characters; stay in range.
  hitIndex = Math.min(hitIndex, flat.length);

  let start = Math.max(0, hitIndex - before);
  let end = Math.min(flat.length, hitIndex + hitLength + after);

  // Prefer not to start or end in the middle of a word when there is one nearby.
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space !== -1 && space < hitIndex && space - start <= 12) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > hitIndex + hitLength && end - space <= 15) end = space;
  }

  start = safeBoundary(flat, start);
  end = safeBoundary(flat, end);

  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

/** First line of a user message, shortened, for sessions the index has no title for. */
export function titleFromMessage(text) {
  const line = String(text || '').split('\n').map((part) => part.trim()).find(Boolean) || '';
  const plain = line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
  return plain.length > TITLE_MAX_LENGTH ? `${plain.slice(0, TITLE_MAX_LENGTH - 1)}…` : plain;
}

/**
 * Collects the messages of one session. The session matches once every term
 * has been seen in some message; the snippet comes from the message that
 * holds the most terms (the earliest such message).
 */
export function createSessionMatcher(terms) {
  const found = new Set();
  let best = null;

  return {
    add(text) {
      if (best && best.count === terms.length) return;
      const lower = text.toLowerCase();
      const present = terms.filter((term) => lower.includes(term));
      if (present.length === 0) return;
      present.forEach((term) => found.add(term));
      if (!best || present.length > best.count) {
        best = { text, count: present.length };
      }
    },
    /** Every term found in a single message, so nothing better can come. */
    isSettled() {
      return Boolean(best && best.count === terms.length);
    },
    isMatch() {
      return terms.length > 0 && found.size === terms.length;
    },
    snippet() {
      return best ? buildSnippet(best.text, terms) : '';
    },
  };
}

/** Matches for a list of messages, for transcripts that are read whole. */
export function matchMessages(provider, entries, terms) {
  const matcher = createSessionMatcher(terms);
  for (const entry of entries) {
    const extracted = extractEntryText(provider, entry);
    if (extracted) matcher.add(extracted.text);
    if (matcher.isSettled()) break;
  }
  return matcher.isMatch() ? matcher.snippet() : null;
}

/**
 * Stream a JSONL transcript and return `[{ sessionId, snippet }]` for the
 * sessions in it that match. `sessionId` is the file's own id unless the
 * provider records it per line (Claude).
 *
 * Reads at most `maxBytes` (the rest of a huge file is skipped), drops lines
 * longer than MAX_LINE_LENGTH, and stops as soon as `shouldStop()` is true.
 */
export async function scanJsonlTranscript(filePath, {
  provider,
  terms,
  sessionId = null,
  maxBytes = 16 * 1024 * 1024,
  shouldStop = () => false,
  acceptText = () => true,
}) {
  const matchers = new Map();
  const matcherFor = (id) => {
    if (!matchers.has(id)) matchers.set(id, createSessionMatcher(terms));
    return matchers.get(id);
  };
  // The first user message names the session when the index has no title.
  // Lines are parsed without the term pre-check until one is found.
  const titles = new Map();

  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8', start: 0, end: Math.max(0, maxBytes - 1) });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let truncated = false;

  try {
    for await (const line of rl) {
      if (shouldStop()) {
        truncated = true;
        break;
      }
      if (!line || line.length > MAX_LINE_LENGTH) continue;
      if (titles.size > 0 && !lineMayMatch(line, terms)) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const extracted = extractEntryText(provider, entry);
      if (!extracted || !acceptText(extracted.text)) continue;
      const id = extracted.sessionId || sessionId;
      if (!id) continue;
      if (!titles.has(id) && isUserEntry(provider, entry)) {
        titles.set(id, titleFromMessage(extracted.text));
      }
      const matcher = matcherFor(id);
      matcher.add(extracted.text);

      // A single-session file can stop once its best snippet is settled.
      if (sessionId && provider !== 'claude' && matcher.isSettled()) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  const results = [];
  for (const [id, matcher] of matchers) {
    if (matcher.isMatch()) results.push({ sessionId: id, snippet: matcher.snippet(), title: titles.get(id) || '' });
  }
  return { results, truncated };
}
